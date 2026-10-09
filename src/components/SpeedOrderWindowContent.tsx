import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { COMMANDS } from "../constants/commands";
import { EVENTS } from "../constants/events";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { invoke } from "@tauri-apps/api/core";
import { translateErrorMessage } from "../utils/i18nUtils";
import { DEFAULT_HOTKEYS, matchesHotkey } from "../utils/hotkeyUtils";
import { listen, emit } from "@tauri-apps/api/event";

import { CustomSelect } from "../CustomSelect";
import { useTheme } from "../hooks/useTheme";
import { getContractSizeLabel } from "../domain/contractUtils";
import { VirtualAccount, VirtualPosition } from "../types/trading";
import { ReplayProgressPayload } from "../types/replay";
import { PersistedSettings } from "../types/settings";
import {
  ReplayCommand,
  sendReplayCommand,
  setExecutionModels,
  getExecutionAuditLog,
} from "../utils/command";
import type { LatencyModel, SlippageModel, ExecutionAuditRecord } from "../types/replay";
import { getCachedEconomicAvailabilityMap, isEconomicSpreadActive } from "../utils/economicDataUtils";
import { formatJstTime, formatServerTime, splitShortDateTime } from "../utils/timeUtils";

export const SpeedOrderWindowContent: React.FC = () => {
  useTheme();

  const [status, setStatus] = useState<string>("DISCONNECTED");
  const [bid, setBid] = useState<number>(0);
  const [ask, setAsk] = useState<number>(0);
  const [bidFlash, setBidFlash] = useState<"up" | "down" | null>(null);
  const [askFlash, setAskFlash] = useState<"up" | "down" | null>(null);
  const bidFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const askFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showHistory, setShowHistory] = useState<boolean>(() => {
    return localStorage.getItem(STORAGE_KEYS.speedOrderShowHistory) === "true";
  });
  const [contractSize] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.speedOrderContractSize);
    return saved ? parseInt(saved, 10) : 10000;
  });
  const [orderColorStyle, setOrderColorStyle] = useState<"blue-red" | "red-green">(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.speedOrderColorStyle);
    if (saved === "red-primary") return "red-green";
    return (saved as "blue-red" | "red-green") || "blue-red";
  });
  const [plColorStyle, setPlColorStyle] = useState<"red-blue" | "green-red">(() => {
    return (localStorage.getItem(STORAGE_KEYS.plColorStyle) as "red-blue" | "green-red") || "red-blue";
  });
  const [hedging, setHedging] = useState<boolean>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.speedOrderHedging);
    return saved === "true";
  });
  const [lots, setLots] = useState<number>(() => {
    const savedLots = localStorage.getItem(STORAGE_KEYS.speedOrderLots);
    if (savedLots !== null) {
      const parsed = parseFloat(savedLots);
      if (!isNaN(parsed)) return parsed;
    }
    const savedContract = localStorage.getItem(STORAGE_KEYS.speedOrderContractSize);
    const contract = savedContract ? parseInt(savedContract, 10) : 10000;
    if (contract === 100000) return 0.1;
    if (contract === 1000) return 10;
    return 1;
  });
  const [slPoints, setSlPoints] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.speedOrderSlPoints);
    return saved ? Math.max(0, parseInt(saved, 10)) : 0;
  });
  const [slEnabled, setSlEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.speedOrderSlEnabled);
    return saved !== "false";
  });
  const [tpPoints, setTpPoints] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.speedOrderTpPoints);
    return saved ? Math.max(0, parseInt(saved, 10)) : 0;
  });
  const [tpEnabled, setTpEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.speedOrderTpEnabled);
    return saved !== "false";
  });
  const [maxSpreadPips, setMaxSpreadPips] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.speedOrderMaxSpreadPips);
    return saved !== null ? Math.max(0, parseFloat(saved) || 0) : 2.0;
  });
  const [maxSpreadEnabled, setMaxSpreadEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.speedOrderMaxSpreadEnabled);
    return saved === "true";
  });
  const [account, setAccount] = useState<VirtualAccount | null>(null);
  const [positions, setPositions] = useState<VirtualPosition[]>([]);
  const [showHoldingTime, setShowHoldingTime] = useState<boolean>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.speedOrderShowHoldingTime);
    return saved !== "false";
  });
  const [holdingTimeMode, setHoldingTimeMode] = useState<"pc" | "server">(
    () => (localStorage.getItem(STORAGE_KEYS.speedOrderHoldingTimeMode) as "pc" | "server") || "pc"
  );
  const [sourceSymbol, setSourceSymbol] = useState<string>(() => localStorage.getItem(STORAGE_KEYS.speedOrderSymbol) || "");
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [virtualTimeMsc, setVirtualTimeMsc] = useState<number>(0);
  const [timezoneMode, setTimezoneMode] = useState<"JST" | "SERVER">(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.replayTimezoneMode);
    return saved === "SERVER" ? "SERVER" : "JST";
  });
  const [economicMap, setEconomicMap] = useState<Record<string, boolean>>(() => getCachedEconomicAvailabilityMap());
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [jfxReal, setJfxReal] = useState<boolean | null>(null);
  const prevStatusRef = useRef<string>("DISCONNECTED");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [errorDisplayDuration, setErrorDisplayDuration] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.speedOrderErrorDisplayDuration);
    if (saved !== null) {
      const parsed = parseFloat(saved);
      if (!isNaN(parsed) && parsed >= 0) return Math.round(parsed * 10) / 10;
    }
    return 3.0;
  });

  const [orderLatencyMs, setOrderLatencyMs] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.speedOrderLatencyMs);
    if (saved !== null) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && parsed >= 0) return Math.min(200, parsed);
    }
    return 30;
  });

  const [showAuditToast, setShowAuditToast] = useState<boolean>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.speedOrderShowAuditToast);
    return saved !== null ? saved === "true" : false;
  });
  const [latencyModelType, setLatencyModelType] = useState<"fixed" | "realistic" | "none">(() => {
    return (localStorage.getItem(STORAGE_KEYS.speedOrderLatencyModel) as "fixed" | "realistic" | "none") || "realistic";
  });
  const [slippageModelType, setSlippageModelType] = useState<"realistic" | "none">(() => {
    return (localStorage.getItem(STORAGE_KEYS.speedOrderSlippageModel) as "realistic" | "none") || "realistic";
  });
  const [recentAuditNotification, setRecentAuditNotification] = useState<ExecutionAuditRecord | null>(null);

  const updateExecutionModels = useCallback(
    async (latType: "fixed" | "realistic" | "none", slipType: "realistic" | "none", fixedMs: number) => {
      let latModel: LatencyModel;
      if (latType === "none") {
        latModel = { type: "Zero" };
      } else if (latType === "fixed") {
        latModel = { type: "Fixed", params: { latency_ms: fixedMs } };
      } else {
        latModel = { type: "Normal", params: { mean_ms: 35.0, std_dev_ms: 8.0 } };
      }

      let slipModel: SlippageModel;
      if (slipType === "none") {
        slipModel = { type: "None" };
      } else {
        slipModel = { type: "Realistic", params: { base_slippage_pips: 0.1, volatility_factor: 1.0 } };
      }

      try {
        await setExecutionModels(latModel, slipModel);
      } catch (e) {
        console.error("Failed to set execution models", e);
      }
    },
    []
  );

  useEffect(() => {
    updateExecutionModels(latencyModelType, slippageModelType, orderLatencyMs);
  }, [latencyModelType, slippageModelType, orderLatencyMs, updateExecutionModels]);

  const checkLatestAuditLog = useCallback(async () => {
    const isToastEnabled = localStorage.getItem(STORAGE_KEYS.speedOrderShowAuditToast) === "true";
    if (!isToastEnabled) return;

    try {
      const records = await getExecutionAuditLog();
      if (records.length > 0) {
        const latest = records[records.length - 1];
        setRecentAuditNotification(latest);
        setTimeout(() => {
          setRecentAuditNotification((curr) => (curr?.ticket === latest.ticket ? null : curr));
        }, 4000);
      }
    } catch (e) {
      console.error("Failed to fetch latest audit log", e);
    }
  }, []);

  const [quickLots, setQuickLots] = useState<number[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.speedOrderQuickLots);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length >= 1) {
          const valid = parsed
            .map((v: unknown) => parseFloat(String(v)))
            .filter((v: number) => !isNaN(v) && v > 0);
          if (valid.length >= 1) {
            return valid.slice(0, 5).sort((a, b) => a - b);
          }
        }
      } catch (e) {
        console.error("Failed to parse initial speed-order-quick-lots", e);
      }
    }
    return [1, 10, 100];
  });

  // ホットキー設定の状態
  const [hotkeys, setHotkeys] = useState<Record<string, string>>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.speedOrderHotkeys);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse initial speed-order-hotkeys", e);
      }
    }
    return DEFAULT_HOTKEYS;
  });

  // 設定変更時にlocalStorageへ保存するエフェクト
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.speedOrderLots, String(lots));
  }, [lots]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.speedOrderSlPoints, String(slPoints));
  }, [slPoints]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.speedOrderSlEnabled, String(slEnabled));
  }, [slEnabled]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.speedOrderTpPoints, String(tpPoints));
  }, [tpPoints]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.speedOrderTpEnabled, String(tpEnabled));
  }, [tpEnabled]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.speedOrderMaxSpreadPips, String(maxSpreadPips));
  }, [maxSpreadPips]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.speedOrderMaxSpreadEnabled, String(maxSpreadEnabled));
  }, [maxSpreadEnabled]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.speedOrderShowHoldingTime, String(showHoldingTime));
  }, [showHoldingTime]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.speedOrderHoldingTimeMode, holdingTimeMode);
  }, [holdingTimeMode]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.speedOrderErrorDisplayDuration, String(errorDisplayDuration));
  }, [errorDisplayDuration]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.speedOrderLatencyMs, String(orderLatencyMs));
    sendCommand({ command: "SET_LATENCY", latency_ms: orderLatencyMs });
  }, [orderLatencyMs]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.speedOrderQuickLots, JSON.stringify(quickLots));
  }, [quickLots]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.speedOrderShowAuditToast, String(showAuditToast));
  }, [showAuditToast]);

  const sortedQuickLots = useMemo(() => {
    const valid = quickLots.filter(v => v > 0).sort((a, b) => a - b);
    return valid.length > 0 ? valid : [1];
  }, [quickLots]);

  const lotsGroupWidth = useMemo(() => {
    const count = sortedQuickLots.length;
    if (count >= 5) return "72px";
    if (count === 4) return "82px";
    if (count === 3) return "95px";
    return "110px";
  }, [sortedQuickLots.length]);

  // エラー表示の自動消去
  useEffect(() => {
    if (errorMessage && errorDisplayDuration > 0) {
      const timer = setTimeout(() => {
        setErrorMessage("");
      }, Math.round(errorDisplayDuration * 1000));
      return () => clearTimeout(timer);
    }
  }, [errorMessage, errorDisplayDuration]);
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.speedOrderHedging && e.newValue) {
        setHedging(e.newValue === "true");
      } else if (e.key === STORAGE_KEYS.speedOrderShowHoldingTime && e.newValue) {
        setShowHoldingTime(e.newValue !== "false");
      } else if (e.key === STORAGE_KEYS.speedOrderHoldingTimeMode && e.newValue) {
        setHoldingTimeMode(e.newValue as "pc" | "server");
      } else if (e.key === STORAGE_KEYS.speedOrderErrorDisplayDuration && e.newValue) {
        const parsed = parseFloat(e.newValue);
        if (!isNaN(parsed) && parsed >= 0) {
          setErrorDisplayDuration(Math.round(parsed * 10) / 10);
        }
      } else if (e.key === STORAGE_KEYS.speedOrderLatencyMs && e.newValue) {
        const parsed = parseInt(e.newValue, 10);
        if (!isNaN(parsed) && parsed >= 0) {
          setOrderLatencyMs(Math.min(200, parsed));
        }
      } else if (e.key === STORAGE_KEYS.speedOrderHotkeys && e.newValue) {
        try {
          setHotkeys(JSON.parse(e.newValue));
        } catch (err) {
          console.error("Failed to parse hotkeys from storage event", err);
        }
      } else if (e.key === STORAGE_KEYS.speedOrderQuickLots && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (Array.isArray(parsed) && parsed.length >= 1) {
            const valid = parsed
              .map((v: unknown) => parseFloat(String(v)))
              .filter((v: number) => !isNaN(v) && v > 0);
            if (valid.length >= 1) {
              setQuickLots(valid.slice(0, 5).sort((a, b) => a - b));
            }
          }
        } catch (err) {
          console.error("Failed to parse quick lots from storage event", err);
        }
      } else if (e.key === "replay-economic-availability" && e.newValue) {
        try {
          setEconomicMap(JSON.parse(e.newValue));
        } catch (err) {
          console.error("Failed to parse economic availability in speed order", err);
        }
      } else if (e.key === STORAGE_KEYS.replayTimezoneMode && e.newValue) {
        if (e.newValue === "JST" || e.newValue === "SERVER") {
          setTimezoneMode(e.newValue);
        }
      } else if (e.key === STORAGE_KEYS.speedOrderShowAuditToast && e.newValue) {
        const isEnabled = e.newValue === "true";
        setShowAuditToast(isEnabled);
        if (!isEnabled) {
          setRecentAuditNotification(null);
        }
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const sendCommand = async (cmd: ReplayCommand) => {
    try {
      await sendReplayCommand(cmd);
    } catch (e) {
      console.error("Failed to send command", e);
      setErrorMessage(translateErrorMessage("Command error: " + e));
    }
  };

  useEffect(() => {
    // ホットキー・初期設定の読み込み
    invoke<PersistedSettings>(COMMANDS.loadSettings).then((saved) => {
      if (saved) {
        if (saved.hotkeys) {
          const merged = { ...DEFAULT_HOTKEYS, ...saved.hotkeys };
          setHotkeys(merged);
          localStorage.setItem(STORAGE_KEYS.speedOrderHotkeys, JSON.stringify(merged));
        }
        if (saved.timezone_mode && !localStorage.getItem(STORAGE_KEYS.replayTimezoneMode)) {
          setTimezoneMode(saved.timezone_mode as "JST" | "SERVER");
        }
      }
    }).catch(console.error);

    // キャッシュされている最後のステータスを取得して初期化
    invoke<string>(COMMANDS.getLastStatus).then((last) => {
      if (last && last.trim() !== "") {
        const data = JSON.parse(last) as ReplayProgressPayload;
        if (data.status === "ACTIVE" || data.status === "READY" || data.status === "CONNECTED") {
          setStatus(data.status);
          prevStatusRef.current = data.status;
          const currentShow = localStorage.getItem(STORAGE_KEYS.speedOrderShowHistory) === "true";
          const currentContractSize = parseInt(localStorage.getItem(STORAGE_KEYS.speedOrderContractSize) || "10000", 10);
          const currentHedging = localStorage.getItem(STORAGE_KEYS.speedOrderHedging) === "true";
          const currentLatency = parseInt(localStorage.getItem(STORAGE_KEYS.speedOrderLatencyMs) || "30", 10);
          sendCommand({ command: "SET_HISTORY_VISIBILITY", show: currentShow });
          sendCommand({ command: "SET_CONTRACT_SIZE", size: currentContractSize });
          sendCommand({ command: "SET_HEDGING", allowed: currentHedging });
          sendCommand({ command: "SET_LATENCY", latency_ms: isNaN(currentLatency) ? 30 : Math.min(200, Math.max(0, currentLatency)) });
          if (data.jfx_real !== undefined) {
            setJfxReal(data.jfx_real);
          }
          const initBid = data.jfx_bid !== undefined ? data.jfx_bid : (data.dmm_bid !== undefined ? data.dmm_bid : data.bid);
          const initAsk = data.jfx_ask !== undefined ? data.jfx_ask : (data.dmm_ask !== undefined ? data.dmm_ask : data.ask);
          if (initBid) setBid(initBid);
          if (initAsk) setAsk(initAsk);
          if (data.account) setAccount(data.account);
          if (data.positions) setPositions(data.positions);
          if (data.is_playing !== undefined) setIsPlaying(data.is_playing);
          if (data.virtual_time_msc !== undefined) setVirtualTimeMsc(data.virtual_time_msc);
        }
      }
    }).catch(console.error);

    // ステータス更新イベントのリッスン
    // The EA can publish progress faster than this window can paint. Keep
    // only the newest snapshot and apply it once per browser frame.
    let pendingStatus: string | null = null;
    let statusFrame: number | null = null;
    const applyStatus = (payload: string) => {
      try {
        const data = JSON.parse(payload) as ReplayProgressPayload;
        if (data.status === "ACTIVE" || data.status === "READY" || data.status === "CONNECTED") {
          const prev = prevStatusRef.current;
          if (prev === "DISCONNECTED") {
            const currentShow = localStorage.getItem(STORAGE_KEYS.speedOrderShowHistory) === "true";
            const currentContractSize = parseInt(localStorage.getItem(STORAGE_KEYS.speedOrderContractSize) || "10000", 10);
            const currentHedging = localStorage.getItem(STORAGE_KEYS.speedOrderHedging) === "true";
            const currentLatency = parseInt(localStorage.getItem(STORAGE_KEYS.speedOrderLatencyMs) || "30", 10);
            sendCommand({ command: "SET_HISTORY_VISIBILITY", show: currentShow });
            sendCommand({ command: "SET_CONTRACT_SIZE", size: currentContractSize });
            sendCommand({ command: "SET_HEDGING", allowed: currentHedging });
            sendCommand({ command: "SET_LATENCY", latency_ms: isNaN(currentLatency) ? 30 : Math.min(200, Math.max(0, currentLatency)) });
          }
          prevStatusRef.current = data.status;
          setStatus(data.status);
          if (data.jfx_real !== undefined) {
            setJfxReal(data.jfx_real);
          }
          const nextBid = data.jfx_bid !== undefined ? data.jfx_bid : (data.dmm_bid !== undefined ? data.dmm_bid : data.bid);
          if (nextBid !== undefined) {
            setBid((prev) => {
              if (prev > 0) {
                if (nextBid > prev) {
                  if (bidFlashTimerRef.current) clearTimeout(bidFlashTimerRef.current);
                  setBidFlash("up");
                  bidFlashTimerRef.current = setTimeout(() => setBidFlash(null), 300);
                } else if (nextBid < prev) {
                  if (bidFlashTimerRef.current) clearTimeout(bidFlashTimerRef.current);
                  setBidFlash("down");
                  bidFlashTimerRef.current = setTimeout(() => setBidFlash(null), 300);
                }
              }
              return nextBid;
            });
          }
          const nextAsk = data.jfx_ask !== undefined ? data.jfx_ask : (data.dmm_ask !== undefined ? data.dmm_ask : data.ask);
          if (nextAsk !== undefined) {
            setAsk((prev) => {
              if (prev > 0) {
                if (nextAsk > prev) {
                  if (askFlashTimerRef.current) clearTimeout(askFlashTimerRef.current);
                  setAskFlash("up");
                  askFlashTimerRef.current = setTimeout(() => setAskFlash(null), 300);
                } else if (nextAsk < prev) {
                  if (askFlashTimerRef.current) clearTimeout(askFlashTimerRef.current);
                  setAskFlash("down");
                  askFlashTimerRef.current = setTimeout(() => setAskFlash(null), 300);
                }
              }
              return nextAsk;
            });
          }
          if (data.account) {
            setAccount((prev) => {
              if (JSON.stringify(prev) === JSON.stringify(data.account)) return prev;
              return data.account ?? prev;
            });
          }
          if (data.positions) {
            setPositions((prev) => {
              if (JSON.stringify(prev) === JSON.stringify(data.positions)) return prev;
              return data.positions ?? prev;
            });
          }
          if (data.source_symbol) {
            setSourceSymbol((prev) => {
              if (prev !== data.source_symbol) {
                localStorage.setItem(STORAGE_KEYS.speedOrderSymbol, data.source_symbol ?? prev);
                return data.source_symbol ?? prev;
              }
              return prev;
            });
          }
          if (data.is_playing !== undefined) setIsPlaying((prev) => prev !== (data.is_playing ?? prev) ? (data.is_playing ?? prev) : prev);
          if (data.virtual_time_msc !== undefined) setVirtualTimeMsc((prev) => prev !== (data.virtual_time_msc ?? prev) ? (data.virtual_time_msc ?? prev) : prev);
        } else if (data.status === "ERROR") {
          setErrorMessage(translateErrorMessage(data.message || ""));
        } else if (data.status === "DISCONNECTED") {
          prevStatusRef.current = "DISCONNECTED";
          setStatus("DISCONNECTED");
          setBid(0);
          setAsk(0);
          setAccount((prev) => prev !== null ? null : prev);
          setPositions((prev) => prev.length > 0 ? [] : prev);
        }
      } catch (e) {
        console.error(e);
      }
    };
    const scheduleStatus = (payload: string) => {
      pendingStatus = payload;
      if (statusFrame !== null) return;
      statusFrame = requestAnimationFrame(() => {
        statusFrame = null;
        const latest = pendingStatus;
        pendingStatus = null;
        if (latest !== null) applyStatus(latest);
      });
    };
    const discardPendingStatus = () => {
      pendingStatus = null;
      if (statusFrame !== null) {
        cancelAnimationFrame(statusFrame);
        statusFrame = null;
      }
    };
    const unlistenStatus = listen<string>(EVENTS.mt5Status, (event) => {
      // ERRORステータスは離散イベントのため、rAFスロットリングで上書き消失しないよう即座に適用する
      if (event.payload.includes('"status":"ERROR"') || event.payload.includes('"status": "ERROR"')) {
        try {
          const parsed = JSON.parse(event.payload);
          if (parsed.status === "ERROR") {
            setErrorMessage(translateErrorMessage(parsed.message || ""));
            return;
          }
        } catch (_) {
          // Ignore malformed status payloads and continue the regular status update.
        }
      }
      scheduleStatus(event.payload);
    });

    const unlistenDisconnect = listen(EVENTS.mt5Disconnected, () => {
      discardPendingStatus();
      if (bidFlashTimerRef.current) clearTimeout(bidFlashTimerRef.current);
      if (askFlashTimerRef.current) clearTimeout(askFlashTimerRef.current);
      setBidFlash(null);
      setAskFlash(null);
      prevStatusRef.current = "DISCONNECTED";
      setStatus("DISCONNECTED");
      setBid(0);
      setAsk(0);
      setAccount(null);
      setPositions([]);
    });

    return () => {
      if (statusFrame !== null) cancelAnimationFrame(statusFrame);
      if (bidFlashTimerRef.current) clearTimeout(bidFlashTimerRef.current);
      if (askFlashTimerRef.current) clearTimeout(askFlashTimerRef.current);
      pendingStatus = null;
      unlistenStatus.then((fn) => fn());
      unlistenDisconnect.then((fn) => fn());
    };
  }, []);

  // ホットキー用のkeydownリスナーをバインドし、Tauri IPC経由でメインウィンドウへ転送する
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 入力フィールドフォーカス時は除外
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement).isContentEditable
      ) {
        return;
      }

      let matchedAction: string | null = null;
      for (const [action, keyDef] of Object.entries(hotkeys)) {
        if (matchesHotkey(e, keyDef)) {
          matchedAction = action;
          break;
        }
      }

      if (matchedAction) {
        e.preventDefault();
        emit(EVENTS.triggerAction, { action: matchedAction }).catch(console.error);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hotkeys]);

  interface StopwatchState {
    accumulatedMs: number;
    lastActiveTime: number | null;
  }

  const stopwatchStateRef = useRef<Record<number, StopwatchState>>({});
  const virtualTimeMscRef = useRef(virtualTimeMsc);
  virtualTimeMscRef.current = virtualTimeMsc;

  const syncStopwatchState = (
    currentPositions: VirtualPosition[],
    playing: boolean
  ) => {
    const activeTickets = new Set(currentPositions.map(p => p.ticket));

    // 1. Clean up closed positions
    Object.keys(stopwatchStateRef.current).forEach(ticketStr => {
      const ticket = Number(ticketStr);
      if (!activeTickets.has(ticket)) {
        const state = stopwatchStateRef.current[ticket];
        if (state) {
          const finalDuration = state.accumulatedMs + 
            (state.lastActiveTime ? (Date.now() - state.lastActiveTime) : 0);
          
          try {
            const storedTimesStr = localStorage.getItem(STORAGE_KEYS.speedOrderPositionRealTimes);
            const storedTimes = storedTimesStr ? JSON.parse(storedTimesStr) : {};
            storedTimes[ticket] = finalDuration;
            localStorage.setItem(STORAGE_KEYS.speedOrderPositionRealTimes, JSON.stringify(storedTimes));
            
            window.dispatchEvent(new StorageEvent("storage", {
              key: STORAGE_KEYS.speedOrderPositionRealTimes,
              newValue: JSON.stringify(storedTimes)
            }));
          } catch (e) {
            console.error("Failed to update final duration in localStorage", e);
          }
        }
        delete stopwatchStateRef.current[ticket];
      }
    });

    // 2. Initialize new positions
    let storedTimes: Record<number, number> = {};
    try {
      const storedTimesStr = localStorage.getItem(STORAGE_KEYS.speedOrderPositionRealTimes);
      if (storedTimesStr) {
        storedTimes = JSON.parse(storedTimesStr);
      }
    } catch (e) {
      console.error("Failed to parse storedTimes from localStorage", e);
    }

    currentPositions.forEach(p => {
      const state = stopwatchStateRef.current[p.ticket];
      if (state === undefined) {
        let initialAccumulated = 0;
        if (storedTimes[p.ticket] !== undefined) {
          initialAccumulated = storedTimes[p.ticket];
        } else {
          const virtualElapsed = virtualTimeMscRef.current - p.open_time_msc;
          if (virtualElapsed > 0) {
            initialAccumulated = virtualElapsed;
          }
        }

        stopwatchStateRef.current[p.ticket] = {
          accumulatedMs: initialAccumulated,
          lastActiveTime: playing ? Date.now() : null
        };
      } else {
        // 既存ポジションのステート更新
        if (playing) {
          if (state.lastActiveTime === null) {
            state.lastActiveTime = Date.now();
          }
        } else {
          if (state.lastActiveTime !== null) {
            state.accumulatedMs += Date.now() - state.lastActiveTime;
            state.lastActiveTime = null;
          }
        }
      }
    });

    // 3. Update localStorage with current times
    const currentTimesToStore: Record<number, number> = {};
    Object.keys(storedTimes).forEach(tkStr => {
      const tk = Number(tkStr);
      if (!activeTickets.has(tk)) {
        currentTimesToStore[tk] = storedTimes[tk];
      }
    });
    Object.keys(stopwatchStateRef.current).forEach(tkStr => {
      const tk = Number(tkStr);
      const state = stopwatchStateRef.current[tk];
      currentTimesToStore[tk] = state.accumulatedMs + 
        (state.lastActiveTime ? (Date.now() - state.lastActiveTime) : 0);
    });
    localStorage.setItem(STORAGE_KEYS.speedOrderPositionRealTimes, JSON.stringify(currentTimesToStore));
  };

  useEffect(() => {
    syncStopwatchState(positions, isPlaying);
  }, [positions, isPlaying]);

  const [timerTrigger, setTimerTrigger] = useState(0);
  useEffect(() => {
    if (!showHoldingTime || positions.length === 0 || !isPlaying) {
      return;
    }
    const interval = setInterval(() => {
      setTimerTrigger(t => t + 1);
    }, 200);
    return () => clearInterval(interval);
  }, [showHoldingTime, positions.length, isPlaying]);

  const getOldestPositionElapsedTime = (_trigger: number) => {
    if (positions.length === 0) return 0;
    const oldest = positions.reduce((old, p) => p.open_time_msc < old.open_time_msc ? p : old, positions[0]);
    
    if (holdingTimeMode === "server") {
      const elapsed = virtualTimeMsc - oldest.open_time_msc;
      return Math.max(0, elapsed);
    } else {
      const stopwatch = stopwatchStateRef.current[oldest.ticket];
      if (!stopwatch) return 0;
      const elapsed = stopwatch.accumulatedMs + 
        (stopwatch.lastActiveTime ? (Date.now() - stopwatch.lastActiveTime) : 0);
      return Math.max(0, elapsed);
    }
  };

  const formatElapsedTime = (ms: number) => {
    if (ms < 0) ms = 0;
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    if (hours > 0) {
      return `${hours}時間${minutes}分${seconds}秒`;
    }
    if (minutes > 0) {
      return `${minutes}分${seconds}秒`;
    }
    const tenths = Math.floor((ms % 1000) / 100);
    return `${seconds}.${tenths}秒`;
  };

  const handleOrderOpen = (type: "BUY" | "SELL") => {
    if (maxSpreadEnabled && maxSpreadPips > 0) {
      const currentPipMultiplier = isJpy ? 100 : 10000;
      const currentSpreadPips = (ask > 0 && bid > 0) ? (ask - bid) * currentPipMultiplier : 0;
      if (currentSpreadPips > maxSpreadPips + 0.00001) {
        setErrorMessage(`スプレッド制限オーバー: 現在 ${currentSpreadPips.toFixed(1)} pips > 許容 ${maxSpreadPips.toFixed(1)} pips`);
        return;
      }
    }

    sendCommand({
      command: "ORDER_OPEN",
      type,
      volume: lots,
      sl_points: slEnabled ? slPoints : 0,
      tp_points: tpEnabled ? tpPoints : 0
    });
    // Core v2 約定ログを直後および遅延後にチェックして通知トーストを表示
    setTimeout(() => {
      checkLatestAuditLog();
    }, 80);
    const delayCheck = Math.max(150, (orderLatencyMs || 30) + 100);
    setTimeout(() => {
      checkLatestAuditLog();
    }, delayCheck);
  };

  const handleCloseAll = () => sendCommand({ command: "ORDER_CLOSE_ALL" });
  const handleCloseBuy = () => sendCommand({ command: "ORDER_CLOSE_BUY" });
  const handleCloseSell = () => sendCommand({ command: "ORDER_CLOSE_SELL" });

  // 通貨ペア・銘柄種別判定
  const currentSymbol = sourceSymbol || positions[0]?.symbol || "";
  const isJpy = currentSymbol.toUpperCase().includes("JPY") || (currentSymbol === "" && bid > 20.0);
  const isGold = currentSymbol.toUpperCase().includes("XAU") || currentSymbol.toUpperCase().includes("GOLD");
  const isCrypto = currentSymbol.toUpperCase().includes("BTC") || currentSymbol.toUpperCase().includes("ETH");
  const isIndex = currentSymbol.toUpperCase().includes("225") || currentSymbol.toUpperCase().includes("US30") || currentSymbol.toUpperCase().includes("NAS");

  const getPriceParts = (p: number) => {
    if (p <= 0) return { base: "--", big: "--", fraction: "-" };
    const decimalPlaces = isCrypto || isIndex ? 2 : isGold || isJpy ? 3 : 5;
    const str = p.toFixed(decimalPlaces);
    const len = str.length;
    return {
      base: str.substring(0, len - 3),
      big: str.substring(len - 3, len - 1),
      fraction: str.substring(len - 1),
    };
  };

  const bidParts = getPriceParts(bid);
  const askParts = getPriceParts(ask);

  // ポジション集計
  const buyPositions = positions.filter(p => p.type === "BUY");
  const sellPositions = positions.filter(p => p.type === "SELL");
  const totalBuyLots = buyPositions.reduce((sum, p) => sum + p.volume, 0);
  const totalSellLots = sellPositions.reduce((sum, p) => sum + p.volume, 0);
  const totalPL = account?.total_profit ?? 0;

  // 発注可能ロット数計算
  const leverage = account?.leverage || 25;
  const freeMargin = account?.free_margin || 0;
  const currentPrice = ask || bid || 1;
  const maxLotsRaw = currentPrice > 0 ? (freeMargin * leverage) / (contractSize * currentPrice) : 0;
  const maxLots = contractSize === 100000
    ? Math.max(0, Math.floor(maxLotsRaw * 100) / 100)
    : Math.max(0, Math.floor(maxLotsRaw));

  // 平均レートの計算
  const avgBuyRate = totalBuyLots > 0
    ? buyPositions.reduce((sum, p) => sum + p.volume * p.open_price, 0) / totalBuyLots
    : 0;
  const avgSellRate = totalSellLots > 0
    ? sellPositions.reduce((sum, p) => sum + p.volume * p.open_price, 0) / totalSellLots
    : 0;

  // 評価損益の計算
  const totalBuyProfit = buyPositions.reduce((sum, p) => sum + p.profit, 0);
  const totalSellProfit = sellPositions.reduce((sum, p) => sum + p.profit, 0);

  // pipsの計算 (現在のBid/Askレートと平均建値の価格差からpips値を直接算出)
  const pipMultiplier = isCrypto || isIndex ? 1 : isGold ? 10 : isJpy ? 100 : 10000;
  const buyPips = totalBuyLots > 0 ? (bid - avgBuyRate) * pipMultiplier : 0;
  const sellPips = totalSellLots > 0 ? (avgSellRate - ask) * pipMultiplier : 0;
  const spreadValue = (ask > 0 && bid > 0) ? ((ask - bid) * pipMultiplier).toFixed(1) : "--";

  const formatPLCompact = (val: number) => {
    const formatted = val.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    if (val > 0) return <span className="profit-green">+{formatted}</span>;
    if (val < 0) return <span className="loss-red">{formatted}</span>;
    return <span style={{ opacity: 0.4 }}>0.00</span>;
  };

  const formatPipsCompact = (val: number) => {
    const formatted = val.toFixed(1);
    if (val > 0) return <span className="profit-green">+{formatted}</span>;
    if (val < 0) return <span className="loss-red">{formatted}</span>;
    return <span style={{ opacity: 0.4 }}>0.0</span>;
  };

  // メインウィンドウやグローバルホットキーからの注文・決済アクション呼び出しをリッスン
  const handleTriggerActionRef = useRef<(action: string) => void>(() => {});
  handleTriggerActionRef.current = (action: string) => {
    switch (action) {
      case "order_buy":
        if (lots > 0 && (status === "READY" || status === "ACTIVE")) {
          handleOrderOpen("BUY");
        }
        break;
      case "order_sell":
        if (lots > 0 && (status === "READY" || status === "ACTIVE")) {
          handleOrderOpen("SELL");
        }
        break;
      case "order_close_buy":
        if (totalBuyLots > 0) {
          handleCloseBuy();
        }
        break;
      case "order_close_sell":
        if (totalSellLots > 0) {
          handleCloseSell();
        }
        break;
      case "order_close_all":
        if (positions.length > 0) {
          handleCloseAll();
        }
        break;
      default:
        break;
    }
  };

  useEffect(() => {
    const unlisten = listen<{ action: string }>(EVENTS.triggerAction, (event) => {
      handleTriggerActionRef.current(event.payload.action);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const isEconomicMode = isEconomicSpreadActive(virtualTimeMsc, economicMap);

  // 統合インジケーター（単一ドット）の状態算出
  const isDisconnected = status === "DISCONNECTED";
  const isCurrentlyPlaying = !isDisconnected && (status === "ACTIVE" ? isPlaying : false);

  const getIndicatorDotClass = () => {
    if (isDisconnected) return "speed-status-dot disconnected";
    const modeClass = isEconomicMode ? "indicator" : "normal";
    const playClass = isCurrentlyPlaying ? "playing" : "paused";
    return `speed-status-dot ${modeClass} ${playClass}`;
  };

  const getIndicatorTooltip = () => {
    if (isDisconnected) {
      return "【オフライン (未接続)】\n・再生状態: 未接続\n・再生コントローラーからリプレイを開始してください";
    }
    const modeTitle = isEconomicMode ? "指標連動モード" : "通常モード";
    const playStatusStr = isCurrentlyPlaying ? "再生中 (Active)" : "一時停止中 (待機)";
    const spreadDesc = isEconomicMode
      ? "経済指標発表前後に動的拡大（Parquet連動）"
      : "平時固定スプレッド（仲値・早朝流動性制御）";

    return `【${modeTitle} - ${isCurrentlyPlaying ? "再生中" : "一時停止中"}】\n・スプレッド: ${spreadDesc}\n・再生状態: ${playStatusStr}`;
  };

  const rawTimeStr =
    !isDisconnected && virtualTimeMsc > 0
      ? timezoneMode === "JST"
        ? formatJstTime(virtualTimeMsc)
        : formatServerTime(virtualTimeMsc)
      : "--:--:--";
  const { datePart, timePart } = splitShortDateTime(rawTimeStr);

  const handleToggleTimezone = () => {
    const next = timezoneMode === "JST" ? "SERVER" : "JST";
    setTimezoneMode(next);
    localStorage.setItem(STORAGE_KEYS.replayTimezoneMode, next);
  };

  return (
    <div className="speed-order-window" data-color-style={orderColorStyle} style={{ position: "relative" }}>
      {/* ヘッダー */}
      <div className="speed-order-header" data-tauri-drag-region>
        <div className="speed-order-title" data-tauri-drag-region>
          <button
            type="button"
            className="ctrl-time-btn font-data"
            onClick={handleToggleTimezone}
            title={`表示タイムゾーン切替 (現在: ${timezoneMode === "JST" ? "JST 日本時間" : "SERVER MT5サーバー時刻"})\nリプレイ日時: ${rawTimeStr}\nクリックで切替`}
          >
            <span className="tz-label">{timezoneMode}</span>
            <span className="time-val">
              {datePart ? <span className="time-date-part">{datePart}</span> : null}
              <span className="time-clock-part">{timePart}</span>
            </span>
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 }} data-tauri-drag-region>
          {jfxReal !== null && (
            <span
              className="jfx-badge"
              style={{
                fontSize: "10px",
                fontWeight: 700,
                padding: "1px 5px",
                borderRadius: "4px",
                letterSpacing: "0.3px",
                lineHeight: "1.2",
                backgroundColor: jfxReal ? "rgba(34, 197, 94, 0.15)" : "rgba(234, 179, 8, 0.15)",
                color: jfxReal ? "#4ade80" : "#facc15",
                border: jfxReal ? "1px solid rgba(74, 222, 128, 0.4)" : "1px solid rgba(250, 204, 21, 0.4)",
                userSelect: "none",
                flexShrink: 0,
              }}
              title={jfxReal ? "JFX実ティックデータ執行中 (スプレッド原則固定0.2銭)" : "JFX疑似固定スプレッド(0.2銭)フォールバック執行中"}
            >
              {jfxReal ? "JFX" : "疑似"}
            </span>
          )}
          {/* 口座・ポジション管理（ポジション一覧）ウィンドウ起動ボタン */}
          <button
            className="speed-header-icon-btn"
            onClick={async () => {
              try {
                await invoke(COMMANDS.openPositionsWindow);
              } catch (err) {
                console.error("Failed to open account & positions window:", err);
              }
            }}
            title="口座・ポジション管理（ポジション一覧）ウィンドウを起動"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--on-surface-variant)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "4px",
              borderRadius: "50%",
              transition: "var(--transition-fast)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--on-surface)";
              e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--on-surface-variant)";
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>account_balance_wallet</span>
          </button>


          {/* 設定ボタン */}
          <button
            className="speed-settings-btn"
            onClick={() => setIsSettingsOpen(true)}
            title="設定"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--on-surface-variant)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "4px",
              borderRadius: "50%",
              transition: "var(--transition-fast)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--on-surface)";
              e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--on-surface-variant)";
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>settings</span>
          </button>

          <div 
            className="speed-order-status" 
            title={getIndicatorTooltip()}
            data-tauri-drag-region
          >
            {/* 統合ステータス＆モード判別ドット（単一） */}
            <span className={getIndicatorDotClass()} />
          </div>
        </div>
      </div>

      {/* 最新約定トースト通知 (Core v2 約定フィードバック) */}
      {recentAuditNotification && showAuditToast && (
        <div
          className="audit-toast-banner"
          onClick={() => {
            invoke(COMMANDS.openTracelyApp).catch(console.error);
          }}
          style={{
            position: "absolute",
            top: "50px",
            left: "12px",
            right: "12px",
            zIndex: 90,
            backgroundColor: "rgba(15, 23, 42, 0.95)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
            border: "1px solid var(--outline-variant)",
            borderLeft: `4px solid ${
              recentAuditNotification.side === "BUY" ? "var(--order-buy, #3b82f6)" : "var(--order-sell, #ef4444)"
            }`,
            padding: "6px 12px",
            fontSize: "11px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            borderRadius: "4px",
            cursor: "pointer",
          }}
          title="クリックしてトレード分析 (Tracely) を開く"
        >
          <span className="material-symbols-outlined" style={{ fontSize: "16px", color: "var(--primary)" }}>
            check_circle
          </span>
          <span style={{ fontWeight: 600, color: "var(--on-surface)" }}>
            [約定 #{recentAuditNotification.ticket}] {recentAuditNotification.side} {recentAuditNotification.volume.toFixed(2)}lot @ {recentAuditNotification.fill_price}
          </span>
          <span style={{ fontSize: "10px", color: "var(--on-surface-variant)", marginLeft: "auto" }}>
            遅延 {recentAuditNotification.latency_ms}ms | スリップ {recentAuditNotification.slippage_pips >= 0 ? "+" : ""}{recentAuditNotification.slippage_pips.toFixed(2)}pips
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowAuditToast(false);
              localStorage.setItem(STORAGE_KEYS.speedOrderShowAuditToast, "false");
              window.dispatchEvent(new StorageEvent("storage", {
                key: STORAGE_KEYS.speedOrderShowAuditToast,
                newValue: "false"
              }));
              setRecentAuditNotification(null);
            }}
            title="約定通知トーストをオフにする（設定からいつでも再有効化可能）"
            style={{
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: "3px",
              color: "var(--on-surface-variant)",
              cursor: "pointer",
              padding: "1px 5px",
              fontSize: "10px",
              display: "flex",
              alignItems: "center",
              gap: "2px",
              whiteSpace: "nowrap"
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>notifications_off</span>
            <span>オフ</span>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setRecentAuditNotification(null);
            }}
            title="通知を閉じる"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--on-surface-variant)",
              cursor: "pointer",
              padding: "0 2px",
              fontSize: "14px",
              lineHeight: 1
            }}
          >
            &times;
          </button>
        </div>
      )}

      {/* エラーバナー (オーバーレイ表示、他パネルの位置がずれないように絶対配置) */}
      {errorMessage && (
        <div
          className="error-banner"
          style={{
            position: "absolute",
            top: "50px", // ヘッダーのすぐ下
            left: "12px",
            right: "12px",
            zIndex: 100,
            margin: 0,
            backgroundColor: "rgba(30, 10, 10, 0.95)",
            boxShadow: "0 8px 20px rgba(0,0,0,0.6)",
            border: "1px solid var(--status-danger)",
            padding: "8px 12px",
            fontSize: "12px",
            boxSizing: "border-box"
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>error</span>
          <span style={{ flex: 1, whiteSpace: "normal", wordBreak: "break-all" }}>{errorMessage}</span>
          <button
            className="error-banner-close-btn"
            onClick={() => setErrorMessage("")}
            title="閉じる"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
      )}

      {/* 売り・買い注文レートパネル */}
      <div className="speed-rates-wrapper">
        <div className="speed-rates-container">
          <button
            className={`rate-box sell-box ${bidFlash || ""}`}
            onClick={() => handleOrderOpen("SELL")}
            disabled={lots <= 0 || (status !== "READY" && status !== "ACTIVE")}
          >
            <div className="rate-arrow-container">
              <span className="rate-arrow up-arrow">▲</span>
              <span className="rate-arrow down-arrow">▼</span>
            </div>
            <div className="rate-label">SELL (Bid)</div>
            <div className="rate-value">
              <span className="rate-base">{bidParts.base}</span>
              <span className="rate-big">{bidParts.big}</span>
              <span className="rate-fraction">{bidParts.fraction}</span>
            </div>
          </button>

          <button
            className={`rate-box buy-box ${askFlash || ""}`}
            onClick={() => handleOrderOpen("BUY")}
            disabled={lots <= 0 || (status !== "READY" && status !== "ACTIVE")}
          >
            <div className="rate-arrow-container">
              <span className="rate-arrow up-arrow">▲</span>
              <span className="rate-arrow down-arrow">▼</span>
            </div>
            <div className="rate-label">BUY (Ask)</div>
            <div className="rate-value">
              <span className="rate-base">{askParts.base}</span>
              <span className="rate-big">{askParts.big}</span>
              <span className="rate-fraction">{askParts.fraction}</span>
            </div>
          </button>
        </div>
        <div className="spread-badge">
          <span className="spread-label">Spread</span>
          <span className="spread-value">{spreadValue}</span>
        </div>
      </div>

      {/* 決済系コントロール */}
      <div className="speed-close-container">
        <button className="close-btn close-buy" onClick={handleCloseBuy} disabled={totalBuyLots === 0}>BUY決済</button>
        <button className="close-btn close-all" onClick={handleCloseAll} disabled={positions.length === 0}>全決済</button>
        <button className="close-btn close-sell" onClick={handleCloseSell} disabled={totalSellLots === 0}>SELL決済</button>
      </div>

      {/* 最古ポジションの経過時間表示 */}
      {showHoldingTime && (
        <div className={`speed-holding-time-bar ${positions.length === 0 ? "inactive" : ""}`}>
          <span className="holding-time-label">
            <span className="material-symbols-outlined" style={{ fontSize: "12px", verticalAlign: "middle" }}>schedule</span>
            最古ポジション保有時間 ({holdingTimeMode === "pc" ? "PC" : "Chart"})
          </span>
          <span className="holding-time-val">
            {positions.length > 0
              ? formatElapsedTime(getOldestPositionElapsedTime(timerTrigger))
              : "--"}
          </span>
        </div>
      )}

      {/* 建玉要約 (左右並列レイアウト) */}
      <div className="speed-pos-summary-container">
        {/* SELL (Left Column) */}
        <div className="summary-column sell-column">
          <div className="summary-header">SELL</div>
          <div className="summary-row">
            <span className="summary-label">建玉数量</span>
            <span className="summary-value font-data">
              {totalSellLots > 0
                ? totalSellLots.toFixed(contractSize === 100000 ? 2 : 0)
                : (contractSize === 100000 ? "0.00" : "0")}
            </span>
          </div>
          <div className="summary-row">
            <span className="summary-label">平均レート</span>
            <span className="summary-value font-data">{totalSellLots > 0 ? avgSellRate.toFixed(isJpy ? 3 : 5) : "-"}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">評価損益</span>
            <span className="summary-value font-data">{totalSellLots > 0 ? formatPLCompact(totalSellProfit) : "0"}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">損益(pips)</span>
            <span className="summary-value font-data">{totalSellLots > 0 ? formatPipsCompact(sellPips) : "0.0"}</span>
          </div>
        </div>

        {/* BUY (Right Column) */}
        <div className="summary-column buy-column">
          <div className="summary-header">BUY</div>
          <div className="summary-row">
            <span className="summary-label">建玉数量</span>
            <span className="summary-value font-data">
              {totalBuyLots > 0
                ? totalBuyLots.toFixed(contractSize === 100000 ? 2 : 0)
                : (contractSize === 100000 ? "0.00" : "0")}
            </span>
          </div>
          <div className="summary-row">
            <span className="summary-label">平均レート</span>
            <span className="summary-value font-data">{totalBuyLots > 0 ? avgBuyRate.toFixed(isJpy ? 3 : 5) : "-"}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">評価損益</span>
            <span className="summary-value font-data">{totalBuyLots > 0 ? formatPLCompact(totalBuyProfit) : "0"}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">損益(pips)</span>
            <span className="summary-value font-data">{totalBuyLots > 0 ? formatPipsCompact(buyPips) : "0.0"}</span>
          </div>
        </div>
      </div>

      {/* 簡易口座情報バー */}
      <div
        className="speed-account-bar"
        onClick={() => invoke(COMMANDS.openPositionsWindow).catch(console.error)}
        style={{ cursor: "pointer", userSelect: "none" }}
        title="クリックして口座・ポジション管理を開く"
      >
        <div className="account-stat">
          <span className="stat-label">P/L:</span>
          <span className={`stat-val ${totalPL >= 0 ? "profit-green" : "loss-red"}`}>
            {totalPL >= 0 ? "+" : ""}{totalPL.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
          </span>
        </div>
        <div className="account-stat">
          <span className="stat-label">Equity:</span>
          <span className="stat-val font-bold">
            {account ? account.equity.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : "1,000,000"}
          </span>
        </div>
      </div>

      {/* 注文入力パラメータフォーム */}
      <div className="speed-inputs-container">
        <div className="speed-input-row">
          <div className="speed-input-group" style={{ flex: `0 0 ${lotsGroupWidth}`, transition: "flex-basis 0.2s ease" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: "2px", marginBottom: "4px", overflow: "hidden" }}>
              <label className="speed-label" style={{ marginBottom: 0, flexShrink: 0 }}>Lots</label>
              {account && (
                <span
                  className="speed-max-lots-badge"
                  onClick={() => setLots(maxLots)}
                  title={`クリックして最大可能枚数をセット (発注可能: ${maxLots})`}
                  style={{
                    fontSize: "8.5px",
                    color: "var(--on-surface)",
                    cursor: "pointer",
                    opacity: 0.75,
                    transition: "opacity 0.25s ease",
                    fontFamily: "var(--font-ui)",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis"
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = "1";
                    e.currentTarget.style.textDecoration = "underline";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = "0.75";
                    e.currentTarget.style.textDecoration = "none";
                  }}
                >
                  ({maxLots})
                </span>
              )}
            </div>
            <div className="speed-input-wrapper">
              <input
                type="number"
                step={contractSize === 100000 ? "0.01" : "1"}
                min="0"
                className="speed-input"
                value={lots}
                onChange={(e) => {
                  const val = parseFloat(e.target.value) || 0;
                  if (contractSize === 100000) {
                    setLots(Math.max(0, Math.round(val * 100) / 100));
                  } else {
                    setLots(Math.max(0, Math.floor(val)));
                  }
                }}
              />
            </div>
          </div>
          <div className="speed-quick-lots">
            <button
              className="quick-lot-btn clear-btn"
              onClick={() => setLots(0)}
              title="クリア"
            >
              CLR
            </button>
            {sortedQuickLots.map((v: number, idx: number) => (
              <button
                key={`${v}-${idx}`}
                className="quick-lot-btn"
                onClick={() =>
                  setLots((prev) => {
                    const nextVal = prev + v;
                    if (contractSize === 100000 || v % 1 !== 0) {
                      return Math.round(nextVal * 100) / 100;
                    }
                    return Math.floor(nextVal);
                  })
                }
              >
                +{v}
              </button>
            ))}
          </div>
        </div>

        <div className="speed-sl-tp-row">
          <div className="speed-input-group">
            <div className="speed-input-header" title="許容スプレッド (Pips)">
              <label className="speed-label" style={{ opacity: maxSpreadEnabled ? 1 : 0.5 }}>Spread</label>
              <label className="speed-switch" title={maxSpreadEnabled ? "許容スプレッド有効" : "許容スプレッド無効"}>
                <input
                  type="checkbox"
                  checked={maxSpreadEnabled}
                  onChange={(e) => setMaxSpreadEnabled(e.target.checked)}
                />
                <span className="speed-switch-slider"></span>
              </label>
            </div>
            <input
              type="number"
              step="0.1"
              min="0"
              className="speed-input"
              value={maxSpreadPips}
              onChange={(e) => setMaxSpreadPips(Math.max(0, parseFloat(e.target.value) || 0))}
              disabled={!maxSpreadEnabled}
              style={{ opacity: maxSpreadEnabled ? 1 : 0.45 }}
              placeholder={maxSpreadEnabled ? "0.0" : "無効"}
              title="許容スプレッド (Pips)"
            />
          </div>
          <div className="speed-input-group">
            <div className="speed-input-header" title="ストップロス (Points)">
              <label className="speed-label" style={{ opacity: slEnabled ? 1 : 0.5 }}>SL</label>
              <label className="speed-switch" title={slEnabled ? "SL有効" : "SL無効"}>
                <input
                  type="checkbox"
                  checked={slEnabled}
                  onChange={(e) => setSlEnabled(e.target.checked)}
                />
                <span className="speed-switch-slider"></span>
              </label>
            </div>
            <input
              type="number"
              step="10"
              min="0"
              className="speed-input"
              value={slPoints}
              onChange={(e) => setSlPoints(Math.max(0, parseInt(e.target.value) || 0))}
              disabled={!slEnabled}
              style={{ opacity: slEnabled ? 1 : 0.45 }}
              placeholder={slEnabled ? "0 (なし)" : "無効"}
              title="ストップロス (Points)"
            />
          </div>
          <div className="speed-input-group">
            <div className="speed-input-header" title="テイクプロフィット (Points)">
              <label className="speed-label" style={{ opacity: tpEnabled ? 1 : 0.5 }}>TP</label>
              <label className="speed-switch" title={tpEnabled ? "TP有効" : "TP無効"}>
                <input
                  type="checkbox"
                  checked={tpEnabled}
                  onChange={(e) => setTpEnabled(e.target.checked)}
                />
                <span className="speed-switch-slider"></span>
              </label>
            </div>
            <input
              type="number"
              step="10"
              min="0"
              className="speed-input"
              value={tpPoints}
              onChange={(e) => setTpPoints(Math.max(0, parseInt(e.target.value) || 0))}
              disabled={!tpEnabled}
              style={{ opacity: tpEnabled ? 1 : 0.45 }}
              placeholder={tpEnabled ? "0 (なし)" : "無効"}
              title="テイクプロフィット (Points)"
            />
          </div>
        </div>
      </div>

      {isSettingsOpen && (
        <div className="modal-overlay" onClick={() => setIsSettingsOpen(false)}>
          <div className="modal-container speed-settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">
                <span className="material-symbols-outlined icon-accent" style={{ fontSize: "16px" }}>settings</span>
                発注設定
              </h3>
              <button className="modal-close-btn" onClick={() => setIsSettingsOpen(false)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="modal-body speed-settings-body">
              <div className="speed-settings-row">
                <div className="speed-settings-label">
                  <span className="label-text">決済履歴表示</span>
                  <span className="label-desc">チャート上に決済履歴の線を描画</span>
                </div>
                <div className="speed-settings-control">
                  <label className="speed-switch">
                    <input
                      type="checkbox"
                      checked={showHistory}
                      onChange={(e) => {
                        const val = e.target.checked;
                        setShowHistory(val);
                        localStorage.setItem(STORAGE_KEYS.speedOrderShowHistory, String(val));
                        sendCommand({ command: "SET_HISTORY_VISIBILITY", show: val });
                      }}
                    />
                    <span className="speed-switch-slider"></span>
                  </label>
                </div>
              </div>

              <div className="speed-settings-row">
                <div className="speed-settings-label">
                  <span className="label-text">保有時間表示</span>
                  <span className="label-desc">最古ポジションの保有経過時間を表示</span>
                </div>
                <div className="speed-settings-control">
                  <label className="speed-switch">
                    <input
                      type="checkbox"
                      checked={showHoldingTime}
                      onChange={(e) => {
                        const val = e.target.checked;
                        setShowHoldingTime(val);
                        localStorage.setItem(STORAGE_KEYS.speedOrderShowHoldingTime, String(val));
                        window.dispatchEvent(new StorageEvent("storage", {
                          key: STORAGE_KEYS.speedOrderShowHoldingTime,
                          newValue: String(val)
                        }));
                      }}
                    />
                    <span className="speed-switch-slider"></span>
                  </label>
                </div>
              </div>

              {showHoldingTime && (
                <div className="speed-settings-row">
                  <div className="speed-settings-label">
                    <span className="label-text">保有時間モード</span>
                    <span className="label-desc">時間測定の基準（PC時間またはサーバー時間）</span>
                  </div>
                  <div className="speed-settings-control">
                    <CustomSelect
                      value={holdingTimeMode}
                      onChange={(val) => {
                        const typedVal = val as "pc" | "server";
                        setHoldingTimeMode(typedVal);
                        localStorage.setItem(STORAGE_KEYS.speedOrderHoldingTimeMode, typedVal);
                        window.dispatchEvent(new StorageEvent("storage", {
                          key: STORAGE_KEYS.speedOrderHoldingTimeMode,
                          newValue: typedVal
                        }));
                      }}
                      style={{
                        width: "100%",
                      }}
                      options={[
                        { value: "pc", label: "PC時間（実際の経過時間）" },
                        { value: "server", label: "サーバー時間（チャート時間）" }
                      ]}
                    />
                  </div>
                </div>
              )}

              <div className="speed-settings-row">
                <div className="speed-settings-label">
                  <span className="label-text">エラー表示時間</span>
                  <span className="label-desc">エラー表示の保持時間（0で自動消去なし）</span>
                </div>
                <div className="speed-settings-control">
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", width: "100%" }}>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="60"
                      className="speed-input"
                      style={{
                        flex: 1,
                        textAlign: "right",
                        padding: "4px 8px",
                        fontSize: "11px",
                        height: "26px",
                        boxSizing: "border-box"
                      }}
                      value={errorDisplayDuration}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        const safeVal = isNaN(val) ? 0 : Math.max(0, Math.round(val * 10) / 10);
                        setErrorDisplayDuration(safeVal);
                        localStorage.setItem(STORAGE_KEYS.speedOrderErrorDisplayDuration, String(safeVal));
                        window.dispatchEvent(new StorageEvent("storage", {
                          key: STORAGE_KEYS.speedOrderErrorDisplayDuration,
                          newValue: String(safeVal)
                        }));
                      }}
                    />
                    <span style={{ fontSize: "11px", color: "var(--on-surface-variant)", whiteSpace: "nowrap" }}>
                      秒
                    </span>
                  </div>
                </div>
              </div>

              <div className="speed-settings-row">
                <div className="speed-settings-label">
                  <span className="label-text">両建て</span>
                  <span className="label-desc">両建て（買・売ポジションの同時保持）を許可</span>
                </div>
                <div className="speed-settings-control">
                  <label className="speed-switch">
                    <input
                      type="checkbox"
                      checked={hedging}
                      onChange={(e) => {
                        const val = e.target.checked;
                        setHedging(val);
                        localStorage.setItem(STORAGE_KEYS.speedOrderHedging, String(val));
                        sendCommand({ command: "SET_HEDGING", allowed: val });
                      }}
                    />
                    <span className="speed-switch-slider"></span>
                  </label>
                </div>
              </div>

              {/* Core v2 セクション */}
              <div style={{ margin: "12px 0 6px 0", borderTop: "1px solid var(--outline-variant)", paddingTop: "10px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span className="material-symbols-outlined" style={{ fontSize: "16px", color: "var(--primary)" }}>
                      verified_user
                    </span>
                    <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--on-surface)" }}>
                      Replay Core v2 (RenderPipe 一本化)
                    </span>
                  </div>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--primary)", backgroundColor: "rgba(59,130,246,0.12)", padding: "2px 6px", borderRadius: "4px" }}>
                    常時稼働
                  </span>
                </div>
                <div style={{ fontSize: "10px", color: "var(--on-surface-variant)", marginBottom: "8px" }}>
                  MT5タイマー依存を撤廃し、Rust内部でミリ秒刻みの絶対仮想時計と決定論的約定を実行中。
                </div>
              </div>

              {/* 注文遅延モデル */}
              <div className="speed-settings-row">
                <div className="speed-settings-label">
                  <span className="label-text">遅延シミュレーション</span>
                  <span className="label-desc">クリックから取引所到達までの通信・処理遅延</span>
                </div>
                <div className="speed-settings-control">
                  <CustomSelect
                    value={latencyModelType}
                    onChange={(val) => {
                      const typed = val as "fixed" | "realistic" | "none";
                      setLatencyModelType(typed);
                      localStorage.setItem(STORAGE_KEYS.speedOrderLatencyModel, typed);
                    }}
                    style={{ width: "100%" }}
                    options={[
                      { value: "realistic", label: "実戦正規分布 (35ms / σ8ms)" },
                      { value: "fixed", label: "固定遅延 (指定ms)" },
                      { value: "none", label: "遅延なし (0ms)" },
                    ]}
                  />
                </div>
              </div>

              {latencyModelType === "fixed" && (
                <div className="speed-settings-row">
                  <div className="speed-settings-label">
                    <span className="label-text">固定遅延ミリ秒</span>
                    <span className="label-desc">0〜200ms</span>
                  </div>
                  <div className="speed-settings-control">
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", width: "100%" }}>
                      <input
                        type="number"
                        step="1"
                        min="0"
                        max="200"
                        className="speed-input font-data"
                        style={{
                          flex: 1,
                          textAlign: "right",
                          padding: "4px 8px",
                          fontSize: "11px",
                          height: "26px",
                          boxSizing: "border-box",
                        }}
                        value={orderLatencyMs}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          const safeVal = isNaN(val) ? 0 : Math.max(0, Math.min(200, val));
                          setOrderLatencyMs(safeVal);
                        }}
                      />
                      <span style={{ fontSize: "11px", color: "var(--on-surface-variant)", whiteSpace: "nowrap" }}>
                        ms
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* スリッページモデル */}
              <div className="speed-settings-row">
                <div className="speed-settings-label">
                  <span className="label-text">スリッページモデル</span>
                  <span className="label-desc">ボラティリティ・板薄時の約定すべり再現</span>
                </div>
                <div className="speed-settings-control">
                  <CustomSelect
                    value={slippageModelType}
                    onChange={(val) => {
                      const typed = val as "realistic" | "none";
                      setSlippageModelType(typed);
                      localStorage.setItem(STORAGE_KEYS.speedOrderSlippageModel, typed);
                    }}
                    style={{ width: "100%" }}
                    options={[
                      { value: "realistic", label: "実戦ダイナミック (相場連動)" },
                      { value: "none", label: "スリッページなし (0 pip)" },
                    ]}
                  />
                </div>
              </div>

              {/* 約定通知トースト表示切り替え */}
              <div
                className="speed-settings-row"
                style={{ cursor: "pointer" }}
                onClick={() => {
                  const nextVal = !showAuditToast;
                  setShowAuditToast(nextVal);
                  localStorage.setItem(STORAGE_KEYS.speedOrderShowAuditToast, String(nextVal));
                  window.dispatchEvent(new StorageEvent("storage", {
                    key: STORAGE_KEYS.speedOrderShowAuditToast,
                    newValue: String(nextVal)
                  }));
                  if (!nextVal) {
                    setRecentAuditNotification(null);
                  }
                }}
              >
                <div className="speed-settings-label">
                  <span className="label-text">約定通知トースト</span>
                  <span className="label-desc">発注直後に遅延・スリップのサマリーを通知</span>
                </div>
                <div className="speed-settings-control" onClick={(e) => e.stopPropagation()}>
                  <label className="speed-switch" htmlFor="speed-order-toast-toggle">
                    <input
                      id="speed-order-toast-toggle"
                      type="checkbox"
                      checked={showAuditToast}
                      onChange={(e) => {
                        const val = e.target.checked;
                        setShowAuditToast(val);
                        localStorage.setItem(STORAGE_KEYS.speedOrderShowAuditToast, String(val));
                        window.dispatchEvent(new StorageEvent("storage", {
                          key: STORAGE_KEYS.speedOrderShowAuditToast,
                          newValue: String(val)
                        }));
                        if (!val) {
                          setRecentAuditNotification(null);
                        }
                      }}
                    />
                    <span className="speed-switch-slider"></span>
                  </label>
                </div>
              </div>

              {/* トレード分析・約定監査 (Tracely) 起動ボタン */}
              <div className="speed-settings-row">
                <div className="speed-settings-label">
                  <span className="label-text">トレード分析 (Tracely)</span>
                  <span className="label-desc">詳細な約定監査ログ・執行品質・統計分析</span>
                </div>
                <div className="speed-settings-control">
                  <button
                    type="button"
                    onClick={() => {
                      setIsSettingsOpen(false);
                      invoke(COMMANDS.openTracelyApp).catch(console.error);
                    }}
                    style={{
                      width: "100%",
                      padding: "6px 10px",
                      backgroundColor: "var(--surface-container-high)",
                      border: "1px solid var(--outline-variant)",
                      borderRadius: "4px",
                      color: "var(--primary)",
                      fontSize: "11px",
                      fontWeight: 600,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "4px",
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>
                      analytics
                    </span>
                    Tracely を起動
                  </button>
                </div>
              </div>

              <div className="speed-settings-row" style={{ alignItems: "flex-start", paddingTop: "8px", paddingBottom: "8px" }}>
                <div className="speed-settings-label">
                  <span className="label-text">LOT加算ボタン</span>
                  <span className="label-desc">1〜5個の加算プリセット（自動昇順）</span>
                </div>
                <div className="speed-settings-control" style={{ minWidth: "150px", maxWidth: "150px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", width: "100%", alignItems: "flex-end" }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", justifyContent: "flex-end" }}>
                      {quickLots.map((val, idx) => (
                        <div key={idx} style={{ display: "flex", alignItems: "center", position: "relative" }}>
                          <input
                            type="number"
                            step="any"
                            min="0.01"
                            className="speed-input font-data no-spinner"
                            style={{
                              width: "44px",
                              height: "22px",
                              padding: "2px 2px",
                              fontSize: "10px",
                              textAlign: "center",
                              boxSizing: "border-box"
                            }}
                            value={val === 0 ? "" : val}
                            onChange={(e) => {
                              const num = parseFloat(e.target.value);
                              const nextLots = [...quickLots];
                              nextLots[idx] = isNaN(num) ? 0 : Math.max(0, num);
                              setQuickLots(nextLots);
                            }}
                            onBlur={() => {
                              const valid = quickLots
                                .map((v) => (v <= 0 || isNaN(v) ? 1 : v))
                                .sort((a, b) => a - b);
                              setQuickLots(valid);
                            }}
                          />
                          {quickLots.length > 1 && (
                            <button
                              type="button"
                              onClick={() => {
                                const updated = quickLots.filter((_, i) => i !== idx);
                                const sorted = updated.length > 0 ? updated.sort((a, b) => a - b) : [1];
                                setQuickLots(sorted);
                              }}
                              style={{
                                position: "absolute",
                                top: "-4px",
                                right: "-4px",
                                width: "12px",
                                height: "12px",
                                borderRadius: "50%",
                                backgroundColor: "var(--error-color, #ef4444)",
                                color: "#ffffff",
                                border: "none",
                                fontSize: "9px",
                                fontWeight: "bold",
                                lineHeight: "1",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "pointer",
                                padding: 0,
                                boxShadow: "0 1px 2px rgba(0,0,0,0.3)"
                              }}
                              title="削除"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    {quickLots.length < 5 && (
                      <button
                        type="button"
                        onClick={() => {
                          if (quickLots.length >= 5) return;
                          const validCurrent = quickLots.filter((v) => v > 0);
                          const maxVal = validCurrent.length > 0 ? Math.max(...validCurrent) : 1;
                          const nextVal = maxVal >= 100 ? maxVal + 100 : maxVal >= 10 ? maxVal + 10 : maxVal * 10 || 1;
                          const updated = [...quickLots, nextVal].sort((a, b) => a - b);
                          setQuickLots(updated);
                        }}
                        style={{
                          padding: "2px 8px",
                          fontSize: "10px",
                          height: "20px",
                          background: "var(--surface-container-highest, rgba(255, 255, 255, 0.08))",
                          border: "1px solid var(--outline-variant)",
                          borderRadius: "var(--radius-sm)",
                          color: "var(--on-surface)",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "2px"
                        }}
                      >
                        + 追加
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="speed-settings-row">
                <div className="speed-settings-label">
                  <span className="label-text">ロット単位</span>
                  <span className="label-desc">発注時の1ロットあたりの通貨量 (リプレイ開始前の取引設定でのみ変更可能)</span>
                </div>
                <div className="speed-settings-control">
                  <span style={{
                    fontSize: "11px",
                    color: "var(--on-surface-variant)",
                    backgroundColor: "rgba(255, 255, 255, 0.04)",
                    padding: "4px 8px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--outline-variant)",
                    fontFamily: "var(--font-ui)",
                    fontWeight: 500,
                    width: "100%",
                    textAlign: "center",
                    display: "inline-block",
                    boxSizing: "border-box"
                  }}>
                    {getContractSizeLabel(contractSize)}
                  </span>
                </div>
              </div>

              <div className="speed-settings-row">
                <div className="speed-settings-label">
                  <span className="label-text">レバレッジ</span>
                  <span className="label-desc">現在の口座の取引レバレッジ</span>
                </div>
                <div className="speed-settings-control">
                  <span style={{
                    fontSize: "11px",
                    color: "var(--on-surface-variant)",
                    backgroundColor: "rgba(255, 255, 255, 0.04)",
                    padding: "4px 8px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--outline-variant)",
                    fontFamily: "var(--font-data)",
                    fontWeight: "bold",
                    width: "100%",
                    textAlign: "center",
                    display: "inline-block",
                    boxSizing: "border-box"
                  }}>
                    {leverage}倍
                  </span>
                </div>
              </div>

              <div className="speed-settings-row">
                <div className="speed-settings-label">
                  <span className="label-text">発注カラー</span>
                  <span className="label-desc">SELL/BUYボタンの色味</span>
                </div>
                <div className="speed-settings-control">
                  <CustomSelect
                    value={orderColorStyle}
                    onChange={(val) => {
                      const typedVal = val as "blue-red" | "red-green";
                      setOrderColorStyle(typedVal);
                      localStorage.setItem(STORAGE_KEYS.speedOrderColorStyle, typedVal);
                    }}
                    style={{
                      width: "100%",
                    }}
                    options={[
                      { value: "blue-red", label: "SELL:青 / BUY:赤" },
                      { value: "red-green", label: "SELL:赤 / BUY:緑" }
                    ]}
                  />
                </div>
              </div>

              <div className="speed-settings-row">
                <div className="speed-settings-label">
                  <span className="label-text">損益配色</span>
                  <span className="label-desc">利益／損失の表示色</span>
                </div>
                <div className="speed-settings-control">
                  <CustomSelect
                    value={plColorStyle}
                    onChange={(val) => {
                      const typedVal = val as "red-blue" | "green-red";
                      setPlColorStyle(typedVal);
                      localStorage.setItem(STORAGE_KEYS.plColorStyle, typedVal);
                    }}
                    style={{
                      width: "100%",
                    }}
                    options={[
                      { value: "red-blue", label: "利益:赤 / 損失:青" },
                      { value: "green-red", label: "利益:緑 / 損失:赤" }
                    ]}
                  />
                </div>
              </div>
            </div>
            <div className="modal-footer" style={{ padding: "8px 16px" }}>
              <button className="pro-btn primary" onClick={() => setIsSettingsOpen(false)} style={{ padding: "4px 12px", fontSize: "11px" }}>
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
