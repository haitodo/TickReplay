import React, { useState, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { translateErrorMessage } from "../utils/i18nUtils";
import { DEFAULT_HOTKEYS, matchesHotkey } from "../utils/hotkeyUtils";
import { listen, emit } from "@tauri-apps/api/event";

import { CustomSelect } from "../CustomSelect";
import { useTheme } from "../hooks/useTheme";
import { getContractSizeLabel } from "../domain/contractUtils";

export const SpeedOrderWindowContent: React.FC = () => {
  useTheme();

  const [status, setStatus] = useState<string>("DISCONNECTED");
  const [bid, setBid] = useState<number>(0);
  const [ask, setAsk] = useState<number>(0);
  const [bidFlash, setBidFlash] = useState<"up" | "down" | null>(null);
  const [askFlash, setAskFlash] = useState<"up" | "down" | null>(null);

  const [showHistory, setShowHistory] = useState<boolean>(() => {
    return localStorage.getItem("speed-order-show-history") === "true";
  });
  const [contractSize] = useState<number>(() => {
    const saved = localStorage.getItem("speed-order-contract-size");
    return saved ? parseInt(saved, 10) : 10000;
  });
  const [orderColorStyle, setOrderColorStyle] = useState<"blue-red" | "red-green">(() => {
    const saved = localStorage.getItem("speed-order-color-style");
    if (saved === "red-primary") return "red-green";
    return (saved as "blue-red" | "red-green") || "blue-red";
  });
  const [plColorStyle, setPlColorStyle] = useState<"red-blue" | "green-red">(() => {
    return (localStorage.getItem("pl-color-style") as "red-blue" | "green-red") || "red-blue";
  });
  const [hedging, setHedging] = useState<boolean>(() => {
    const saved = localStorage.getItem("speed-order-hedging");
    return saved === "true";
  });
  const [lots, setLots] = useState<number>(() => {
    const savedLots = localStorage.getItem("speed-order-lots");
    if (savedLots !== null) {
      const parsed = parseFloat(savedLots);
      if (!isNaN(parsed)) return parsed;
    }
    const savedContract = localStorage.getItem("speed-order-contract-size");
    const contract = savedContract ? parseInt(savedContract, 10) : 10000;
    if (contract === 100000) return 0.1;
    if (contract === 1000) return 10;
    return 1;
  });
  const [slPoints, setSlPoints] = useState<number>(() => {
    const saved = localStorage.getItem("speed-order-sl-points");
    return saved ? Math.max(0, parseInt(saved, 10)) : 0;
  });
  const [slEnabled, setSlEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem("speed-order-sl-enabled");
    return saved !== "false";
  });
  const [tpPoints, setTpPoints] = useState<number>(() => {
    const saved = localStorage.getItem("speed-order-tp-points");
    return saved ? Math.max(0, parseInt(saved, 10)) : 0;
  });
  const [tpEnabled, setTpEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem("speed-order-tp-enabled");
    return saved !== "false";
  });
  const [maxSpreadPips, setMaxSpreadPips] = useState<number>(() => {
    const saved = localStorage.getItem("speed-order-max-spread-pips");
    return saved !== null ? Math.max(0, parseFloat(saved) || 0) : 2.0;
  });
  const [maxSpreadEnabled, setMaxSpreadEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem("speed-order-max-spread-enabled");
    return saved === "true";
  });
  const [account, setAccount] = useState<any>(null);
  const [positions, setPositions] = useState<any[]>([]);
  const [showHoldingTime, setShowHoldingTime] = useState<boolean>(() => {
    const saved = localStorage.getItem("speed-order-show-holding-time");
    return saved !== "false";
  });
  const [holdingTimeMode, setHoldingTimeMode] = useState<"pc" | "server">(
    () => (localStorage.getItem("speed-order-holding-time-mode") as "pc" | "server") || "pc"
  );
  const [sourceSymbol, setSourceSymbol] = useState<string>(() => localStorage.getItem("speed-order-symbol") || "");
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [virtualTimeMsc, setVirtualTimeMsc] = useState<number>(0);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const prevStatusRef = useRef<string>("DISCONNECTED");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [errorDisplayDuration, setErrorDisplayDuration] = useState<number>(() => {
    const saved = localStorage.getItem("speed-order-error-display-duration");
    if (saved !== null) {
      const parsed = parseFloat(saved);
      if (!isNaN(parsed) && parsed >= 0) return Math.round(parsed * 10) / 10;
    }
    return 3.0;
  });

  const [quickLots, setQuickLots] = useState<number[]>(() => {
    const saved = localStorage.getItem("speed-order-quick-lots");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length >= 1) {
          const valid = parsed
            .map((v: any) => parseFloat(v))
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
  // const [isVisible, setIsVisible] = useState<boolean>(false);
  const isVisibleRef = useRef<boolean>(false);

  // ホットキー設定の状態
  const [hotkeys, setHotkeys] = useState<Record<string, string>>(() => {
    const saved = localStorage.getItem("speed-order-hotkeys");
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
    localStorage.setItem("speed-order-lots", String(lots));
  }, [lots]);

  useEffect(() => {
    localStorage.setItem("speed-order-sl-points", String(slPoints));
  }, [slPoints]);

  useEffect(() => {
    localStorage.setItem("speed-order-sl-enabled", String(slEnabled));
  }, [slEnabled]);

  useEffect(() => {
    localStorage.setItem("speed-order-tp-points", String(tpPoints));
  }, [tpPoints]);

  useEffect(() => {
    localStorage.setItem("speed-order-tp-enabled", String(tpEnabled));
  }, [tpEnabled]);

  useEffect(() => {
    localStorage.setItem("speed-order-max-spread-pips", String(maxSpreadPips));
  }, [maxSpreadPips]);

  useEffect(() => {
    localStorage.setItem("speed-order-max-spread-enabled", String(maxSpreadEnabled));
  }, [maxSpreadEnabled]);

  useEffect(() => {
    localStorage.setItem("speed-order-show-holding-time", String(showHoldingTime));
  }, [showHoldingTime]);

  useEffect(() => {
    localStorage.setItem("speed-order-holding-time-mode", holdingTimeMode);
  }, [holdingTimeMode]);

  useEffect(() => {
    localStorage.setItem("speed-order-error-display-duration", String(errorDisplayDuration));
  }, [errorDisplayDuration]);

  useEffect(() => {
    localStorage.setItem("speed-order-quick-lots", JSON.stringify(quickLots));
  }, [quickLots]);

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

  // ウィンドウの表示・非表示イベントのリッスン
  useEffect(() => {
    const unlistenVisible = listen<boolean>("window-visible", (event) => {
      const visible = event.payload;
      // setIsVisible(visible);
      isVisibleRef.current = visible;
      if (visible) {
        // 表示された瞬間に最新の状態を取得してUI同期
        invoke<string>("get_last_status").then((last: string) => {
          if (last && last.trim() !== "") {
            const data = JSON.parse(last);
            if (data.status === "ACTIVE" || data.status === "READY" || data.status === "CONNECTED") {
              setStatus(data.status);
              prevStatusRef.current = data.status;
              if (data.bid) setBid(data.bid);
              if (data.ask) setAsk(data.ask);
              if (data.account) setAccount(data.account);
              if (data.positions) setPositions(data.positions);
              if (data.source_symbol) {
                setSourceSymbol(data.source_symbol);
                localStorage.setItem("speed-order-symbol", data.source_symbol);
              }
              if (data.is_playing !== undefined) setIsPlaying(data.is_playing);
              if (data.virtual_time_msc !== undefined) setVirtualTimeMsc(data.virtual_time_msc);
            }
          }
        }).catch(console.error);
      }
    });
    return () => {
      unlistenVisible.then((fn) => fn());
    };
  }, []);

  // 他ウィンドウ（メイン画面）でのlocalStorage更新を検知して同期
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === "speed-order-hedging" && e.newValue) {
        setHedging(e.newValue === "true");
      } else if (e.key === "speed-order-show-holding-time" && e.newValue) {
        setShowHoldingTime(e.newValue !== "false");
      } else if (e.key === "speed-order-holding-time-mode" && e.newValue) {
        setHoldingTimeMode(e.newValue as "pc" | "server");
      } else if (e.key === "speed-order-error-display-duration" && e.newValue) {
        const parsed = parseFloat(e.newValue);
        if (!isNaN(parsed) && parsed >= 0) {
          setErrorDisplayDuration(Math.round(parsed * 10) / 10);
        }
      } else if (e.key === "speed-order-hotkeys" && e.newValue) {
        try {
          setHotkeys(JSON.parse(e.newValue));
        } catch (err) {
          console.error("Failed to parse hotkeys from storage event", err);
        }
      } else if (e.key === "speed-order-quick-lots" && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (Array.isArray(parsed) && parsed.length >= 1) {
            const valid = parsed
              .map((v: any) => parseFloat(v))
              .filter((v: number) => !isNaN(v) && v > 0);
            if (valid.length >= 1) {
              setQuickLots(valid.slice(0, 5).sort((a, b) => a - b));
            }
          }
        } catch (err) {
          console.error("Failed to parse quick lots from storage event", err);
        }
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const sendCommand = async (cmd: any) => {
    try {
      await invoke("send_command", { commandJson: JSON.stringify(cmd) });
    } catch (e) {
      console.error("Failed to send command", e);
      setErrorMessage(translateErrorMessage("Command error: " + e));
    }
  };

  useEffect(() => {
    // ホットキー設定の読み込み
    invoke<any>("load_settings").then((saved) => {
      if (saved && saved.hotkeys) {
        const merged = { ...DEFAULT_HOTKEYS, ...saved.hotkeys };
        setHotkeys(merged);
        localStorage.setItem("speed-order-hotkeys", JSON.stringify(merged));
      }
    }).catch(console.error);

    // キャッシュされている最後のステータスを取得して初期化
    invoke<string>("get_last_status").then((last) => {
      if (last && last.trim() !== "") {
        const data = JSON.parse(last);
        if (data.status === "ACTIVE" || data.status === "READY" || data.status === "CONNECTED") {
          setStatus(data.status);
          prevStatusRef.current = data.status;
          const currentShow = localStorage.getItem("speed-order-show-history") === "true";
          const currentContractSize = parseInt(localStorage.getItem("speed-order-contract-size") || "10000", 10);
          const currentHedging = localStorage.getItem("speed-order-hedging") === "true";
          invoke("send_command", { commandJson: JSON.stringify({ command: "SET_HISTORY_VISIBILITY", show: currentShow }) }).catch(console.error);
          invoke("send_command", { commandJson: JSON.stringify({ command: "SET_CONTRACT_SIZE", size: currentContractSize }) }).catch(console.error);
          invoke("send_command", { commandJson: JSON.stringify({ command: "SET_HEDGING", allowed: currentHedging }) }).catch(console.error);
          if (data.bid) setBid(data.bid);
          if (data.ask) setAsk(data.ask);
          if (data.account) setAccount(data.account);
          if (data.positions) setPositions(data.positions);
          if (data.is_playing !== undefined) setIsPlaying(data.is_playing);
          if (data.virtual_time_msc !== undefined) setVirtualTimeMsc(data.virtual_time_msc);
        }
      }
    }).catch(console.error);

    // ステータス更新イベントのリッスン
    const unlistenStatus = listen<string>("mt5-status", (event) => {
      if (!isVisibleRef.current) return;
      try {
        const data = JSON.parse(event.payload);
        if (data.status === "ACTIVE" || data.status === "READY" || data.status === "CONNECTED") {
          const prev = prevStatusRef.current;
          if (prev === "DISCONNECTED") {
            const currentShow = localStorage.getItem("speed-order-show-history") === "true";
            const currentContractSize = parseInt(localStorage.getItem("speed-order-contract-size") || "10000", 10);
            const currentHedging = localStorage.getItem("speed-order-hedging") === "true";
            invoke("send_command", { commandJson: JSON.stringify({ command: "SET_HISTORY_VISIBILITY", show: currentShow }) }).catch(console.error);
            invoke("send_command", { commandJson: JSON.stringify({ command: "SET_CONTRACT_SIZE", size: currentContractSize }) }).catch(console.error);
            invoke("send_command", { commandJson: JSON.stringify({ command: "SET_HEDGING", allowed: currentHedging }) }).catch(console.error);
          }
          prevStatusRef.current = data.status;
          setStatus(data.status);
          if (data.bid !== undefined) {
            setBid((prev) => {
              if (prev > 0) {
                if (data.bid > prev) {
                  setBidFlash("up");
                  setTimeout(() => setBidFlash(null), 300);
                } else if (data.bid < prev) {
                  setBidFlash("down");
                  setTimeout(() => setBidFlash(null), 300);
                }
              }
              return data.bid;
            });
          }
          if (data.ask !== undefined) {
            setAsk((prev) => {
              if (prev > 0) {
                if (data.ask > prev) {
                  setAskFlash("up");
                  setTimeout(() => setAskFlash(null), 300);
                } else if (data.ask < prev) {
                  setAskFlash("down");
                  setTimeout(() => setAskFlash(null), 300);
                }
              }
              return data.ask;
            });
          }
          if (data.account) {
            setAccount((prev: any) => {
              if (JSON.stringify(prev) === JSON.stringify(data.account)) return prev;
              return data.account;
            });
          }
          if (data.positions) {
            setPositions((prev: any[]) => {
              if (JSON.stringify(prev) === JSON.stringify(data.positions)) return prev;
              return data.positions;
            });
          }
          if (data.source_symbol) {
            setSourceSymbol((prev) => {
              if (prev !== data.source_symbol) {
                localStorage.setItem("speed-order-symbol", data.source_symbol);
                return data.source_symbol;
              }
              return prev;
            });
          }
          if (data.is_playing !== undefined) setIsPlaying((prev) => prev !== data.is_playing ? data.is_playing : prev);
          if (data.virtual_time_msc !== undefined) setVirtualTimeMsc((prev) => prev !== data.virtual_time_msc ? data.virtual_time_msc : prev);
        } else if (data.status === "ERROR") {
          setErrorMessage(translateErrorMessage(data.message));
        } else if (data.status === "DISCONNECTED") {
          prevStatusRef.current = "DISCONNECTED";
          setStatus("DISCONNECTED");
          setBid(0);
          setAsk(0);
          setAccount((prev: any) => prev !== null ? null : prev);
          setPositions((prev) => prev.length > 0 ? [] : prev);
        }
      } catch (e) {
        console.error(e);
      }
    });

    const unlistenDisconnect = listen("mt5-disconnected", () => {
      if (!isVisibleRef.current) return;
      prevStatusRef.current = "DISCONNECTED";
      setStatus("DISCONNECTED");
      setBid(0);
      setAsk(0);
      setAccount(null);
      setPositions([]);
    });

    return () => {
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
        emit("trigger-action", { action: matchedAction }).catch(console.error);
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

  const syncStopwatchState = (
    currentPositions: any[], 
    playing: boolean, 
    virtualTime: number
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
            const storedTimesStr = localStorage.getItem("speed-order-position-real-times");
            const storedTimes = storedTimesStr ? JSON.parse(storedTimesStr) : {};
            storedTimes[ticket] = finalDuration;
            localStorage.setItem("speed-order-position-real-times", JSON.stringify(storedTimes));
            
            window.dispatchEvent(new StorageEvent("storage", {
              key: "speed-order-position-real-times",
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
      const storedTimesStr = localStorage.getItem("speed-order-position-real-times");
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
          const virtualElapsed = virtualTime - p.open_time_msc;
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
    localStorage.setItem("speed-order-position-real-times", JSON.stringify(currentTimesToStore));
  };

  useEffect(() => {
    syncStopwatchState(positions, isPlaying, virtualTimeMsc);
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
    if (isCrypto || isIndex) {
      const str = p.toFixed(2);
      const len = str.length;
      const fraction = str.substring(len - 1);
      const big = str.substring(len - 3, len - 1);
      const base = str.substring(0, len - 3);
      return { base, big, fraction };
    } else if (isGold || isJpy) {
      const str = p.toFixed(3);
      const len = str.length;
      const fraction = str.substring(len - 1);
      const big = str.substring(len - 3, len - 1);
      const base = str.substring(0, len - 3);
      return { base, big, fraction };
    } else {
      const str = p.toFixed(5);
      const len = str.length;
      const fraction = str.substring(len - 1);
      const big = str.substring(len - 3, len - 1);
      const base = str.substring(0, len - 3);
      return { base, big, fraction };
    }
  };

  const bidParts = getPriceParts(bid);
  const askParts = getPriceParts(ask);

  // ポジション集計
  const buyPositions = positions.filter(p => p.type === "BUY");
  const sellPositions = positions.filter(p => p.type === "SELL");
  const totalBuyLots = buyPositions.reduce((sum, p) => sum + p.volume, 0);
  const totalSellLots = sellPositions.reduce((sum, p) => sum + p.volume, 0);
  const totalPL = account ? account.total_profit : 0;

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
  useEffect(() => {
    const unlisten = listen<{ action: string }>("trigger-action", (event) => {
      if (!isVisibleRef.current) return;
      const { action } = event.payload;
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
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [lots, status, totalBuyLots, totalSellLots, positions, slPoints, tpPoints, slEnabled, tpEnabled, maxSpreadPips, maxSpreadEnabled, ask, bid, isJpy]);

  return (
    <div className="speed-order-window" data-color-style={orderColorStyle} style={{ position: "relative" }}>
      {/* ヘッダー */}
      <div className="speed-order-header" data-tauri-drag-region>
        <div className="speed-order-title" data-tauri-drag-region>
          <span className="material-symbols-outlined icon-accent" data-tauri-drag-region>monetization_on</span>
          Speed Order
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }} data-tauri-drag-region>
          {/* 口座・ポジション管理（ポジション一覧）ウィンドウ起動ボタン */}
          <button
            className="speed-header-icon-btn"
            onClick={async () => {
              try {
                await invoke("open_positions_window");
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
            title={`Status: ${status === "DISCONNECTED" ? "Offline (未接続)" : status === "CONNECTED" ? "Connected (接続完了)" : status === "READY" ? "Ready (準備完了)" : "Active (動作中)"}`}
            data-tauri-drag-region
          >
            <span className={`status-dot ${status.toLowerCase()}`}></span>
          </div>
        </div>
      </div>

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
        onClick={() => invoke("open_positions_window").catch(console.error)}
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
            {sortedQuickLots.map((v: any, idx: number) => (
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
                        localStorage.setItem("speed-order-show-history", String(val));
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
                        localStorage.setItem("speed-order-show-holding-time", String(val));
                        window.dispatchEvent(new StorageEvent("storage", {
                          key: "speed-order-show-holding-time",
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
                        localStorage.setItem("speed-order-holding-time-mode", typedVal);
                        window.dispatchEvent(new StorageEvent("storage", {
                          key: "speed-order-holding-time-mode",
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
                        localStorage.setItem("speed-order-error-display-duration", String(safeVal));
                        window.dispatchEvent(new StorageEvent("storage", {
                          key: "speed-order-error-display-duration",
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
                        localStorage.setItem("speed-order-hedging", String(val));
                        sendCommand({ command: "SET_HEDGING", allowed: val });
                      }}
                    />
                    <span className="speed-switch-slider"></span>
                  </label>
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
                      localStorage.setItem("speed-order-color-style", typedVal);
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
                      localStorage.setItem("pl-color-style", typedVal);
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
