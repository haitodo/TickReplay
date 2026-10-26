import React, { useState, useEffect, useRef, useCallback } from "react";
import { DEFAULT_SPEED_TIME_PRESETS, DEFAULT_SPEED_TICK_PRESETS } from "../../constants/speedPresets";
import { MAX_TIME_STEPS } from "../../domain/timeSteps";
import { COMMANDS } from "../../constants/commands";
import { EVENTS } from "../../constants/events";
import { STORAGE_KEYS } from "../../constants/storageKeys";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ControlDashboard } from "./ControlDashboard";
import { useAppearance } from "../../hooks/useAppearance";
import { formatJstTime, formatServerTime, splitShortDateTime } from "../../utils/timeUtils";
import { DEFAULT_TIME_STEPS } from "../../domain/timeSteps";
import { SpeedPresetsModal, TimeStepsModal } from "../Modals";
import type { TimeStepItem, DayTimelineActivity } from "../../types/replay";
import { ReplayCommand, sendReplayCommand } from "../../utils/command";
import { PersistedSettings } from "../../types/settings";
import { ReplayProgressPayload } from "../../types/replay";
import { formatReplaySessionName } from "../../utils/sessionName";

export const ControllerWindowContent: React.FC = () => {
  useAppearance();

  // --- 再生ステータス State ---
  const [status, setStatus] = useState<"DISCONNECTED" | "CONNECTED" | "READY" | "ACTIVE">("DISCONNECTED");
  const [totalTicks, setTotalTicks] = useState(0);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [virtualTimeMsc, setVirtualTimeMsc] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(false);
  const playStateGuardRef = useRef<{ expected: boolean; expireAt: number } | null>(null);
  const [speedMode, setSpeedMode] = useState<"TEMPORAL" | "COUNT">("TEMPORAL");
  const [multiplier, setMultiplier] = useState(1.0);
  const [tickStep, setTickStep] = useState(1);
  const [sourceSymbol, setSourceSymbol] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [timezoneMode, setTimezoneMode] = useState<"JST" | "SERVER">(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.replayTimezoneMode);
    return saved === "SERVER" ? "SERVER" : "JST";
  });

  // サーバー日タイムライン活動度 (1日単位波形)
  const [timelineActivity, setTimelineActivity] = useState<DayTimelineActivity | null>(null);
  const lastActivityDateRef = useRef<string>("");

  // 指定活動度未満の時間帯の自動早送り (Auto-Skip) State
  const [autoSkipFlat, setAutoSkipFlat] = useState<boolean>(() => {
    return localStorage.getItem(STORAGE_KEYS.replayAutoSkipFlat) === "true";
  });
  const [autoSkipThreshold, setAutoSkipThreshold] = useState<number>(0.15);
  const [timelineActivityMaxCap, setTimelineActivityMaxCap] = useState<number>(2800);
  const [timelineActivityMinFloor, setTimelineActivityMinFloor] = useState<number>(1500);

  // 自動スキップ設定モーダル State
  const [isAutoSkipModalOpen, setIsAutoSkipModalOpen] = useState(false);
  const [tempAutoSkipThreshold, setTempAutoSkipThreshold] = useState<number>(0.15);
  const [tempActivityMaxCap, setTempActivityMaxCap] = useState<number>(2800);
  const [tempActivityMinFloor, setTempActivityMinFloor] = useState<number>(1500);

  const normalMultiplierRef = useRef<number>(1.0);
  const isAutoSpeedBoostedRef = useRef<boolean>(false);

  // ウィンドウ間でのタイムゾーンモード変更の同期
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.replayTimezoneMode && e.newValue) {
        if (e.newValue === "JST" || e.newValue === "SERVER") {
          setTimezoneMode(e.newValue);
        }
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  // シンボル名更新時にOSウィンドウタイトルへ反映
  useEffect(() => {
    if (sourceSymbol) {
      getCurrentWindow()
        .setTitle(`リプレイ操作コントローラー [${sourceSymbol}] - TickReplay`)
        .catch((err) => {
          console.warn("Failed to set window title:", err);
        });
    }
  }, [sourceSymbol]);

  // A-B ループ State
  const [loopActive, setLoopActive] = useState(false);
  const [loopA, setLoopA] = useState(-1);
  const [loopB, setLoopB] = useState(-1);
  const [loopAIdx, setLoopAIdx] = useState(-1);
  const [loopBIdx, setLoopBIdx] = useState(-1);

  // プリセット
  const [timePresets, setTimePresets] = useState<number[]>(() => [...DEFAULT_SPEED_TIME_PRESETS]);
  const [tickPresets, setTickPresets] = useState<number[]>(() => [...DEFAULT_SPEED_TICK_PRESETS]);
  const [isSpeedPresetsModalOpen, setIsSpeedPresetsModalOpen] = useState(false);

  // タイムステップ
  const [timeSteps, setTimeSteps] = useState<TimeStepItem[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.customTimeSteps);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return (parsed as TimeStepItem[]).slice(0, MAX_TIME_STEPS);
        }
      } catch (e) {
        console.error("Failed to parse custom-time-steps", e);
      }
    }
    return DEFAULT_TIME_STEPS;
  });
  const [isTimeStepsModalOpen, setIsTimeStepsModalOpen] = useState(false);

  // 終了メニュー & 保存終了モーダル State
  const [isExitMenuOpen, setIsExitMenuOpen] = useState(false);
  const [isSaveAndExitModalOpen, setIsSaveAndExitModalOpen] = useState(false);
  const [saveSessionName, setSaveSessionName] = useState("");
  const exitMenuRef = useRef<HTMLDivElement>(null);

  const isDraggingRef = useRef(false);

  // 外側クリックで終了メニューを閉じる
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (exitMenuRef.current && !exitMenuRef.current.contains(e.target as Node)) {
        setIsExitMenuOpen(false);
      }
    };
    if (isExitMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isExitMenuOpen]);

  // 設定およびステータス受信リスナー
  useEffect(() => {
    // 起動時に保存された設定（銘柄・期間など）を取得
    invoke<PersistedSettings>(COMMANDS.loadSettings)
      .then((settings) => {
        if (settings) {
          if (settings.start_time) setStartTime(settings.start_time);
          if (settings.end_time) setEndTime(settings.end_time);
          if (settings.source_symbol) setSourceSymbol((prev) => prev || settings.source_symbol || "");
          if (settings.timezone_mode && !localStorage.getItem(STORAGE_KEYS.replayTimezoneMode)) {
            setTimezoneMode(settings.timezone_mode as "JST" | "SERVER");
          }
          if (settings.time_presets && Array.isArray(settings.time_presets) && settings.time_presets.length > 0) {
            setTimePresets(settings.time_presets);
          }
          if (settings.tick_presets && Array.isArray(settings.tick_presets) && settings.tick_presets.length > 0) {
            setTickPresets(settings.tick_presets);
          }
          if (settings.auto_skip_threshold !== undefined) {
            setAutoSkipThreshold(settings.auto_skip_threshold);
          }
          if (settings.timeline_activity_max_cap !== undefined) {
            setTimelineActivityMaxCap(settings.timeline_activity_max_cap);
          }
          if (settings.timeline_activity_min_floor !== undefined) {
            setTimelineActivityMinFloor(settings.timeline_activity_min_floor);
          }
        }
      })
      .catch(console.warn);

    // 購読完了前にこの effect が破棄された場合でもリスナーを残さないためのフラグ
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let unlistenSettings: (() => void) | undefined;
    let pendingStatus: string | null = null;
    let statusFrame: number | null = null;
    let windowVisible = !document.hidden;

    const handleVisibility = () => {
      windowVisible = !document.hidden;
      if (windowVisible && pendingStatus && !disposed) {
        handleStatusPayload(pendingStatus);
        pendingStatus = null;
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    const scheduleStatus = (payload: string) => {
      pendingStatus = payload;
      if (!windowVisible) return; // 非表示・最小化中は描画処理を休眠してCPU消費を0%化
      if (statusFrame !== null) return;
      statusFrame = requestAnimationFrame(() => {
        statusFrame = null;
        if (disposed) return;
        const latest = pendingStatus;
        pendingStatus = null;
        if (latest !== null) handleStatusPayload(latest);
      });
    };

    const setupListener = async () => {
      // 初期ステータス取得
      try {
        const lastStatusStr = await invoke<string>(COMMANDS.getLastStatus);
        if (!disposed && lastStatusStr) {
          handleStatusPayload(lastStatusStr);
        }
      } catch (err) {
        console.warn("Failed to get initial status:", err);
      }

      // イベント購読
      const off = await listen<string>(EVENTS.mt5Status, (event) => {
        scheduleStatus(event.payload);
      });

      // 設定更新イベント購読
      const offSettings = await listen<{
        autoSkipThreshold?: number;
        timelineActivityMaxCap?: number;
        timelineActivityMinFloor?: number;
      }>(EVENTS.settingsUpdated, (event) => {
        if (event.payload?.autoSkipThreshold !== undefined) {
          setAutoSkipThreshold(event.payload.autoSkipThreshold);
        }
        if (event.payload?.timelineActivityMaxCap !== undefined) {
          setTimelineActivityMaxCap(event.payload.timelineActivityMaxCap);
        }
        if (event.payload?.timelineActivityMinFloor !== undefined) {
          setTimelineActivityMinFloor(event.payload.timelineActivityMinFloor);
        }
        // タイムライン活動度 (波形) を最新の設定で再取得
        lastActivityDateRef.current = "";
      });

      // 購読が解決する前にアンマウントされていた場合は即座に解除する
      if (disposed) {
        off();
        offSettings();
        return;
      }
      unlisten = off;
      unlistenSettings = offSettings;
    };

    setupListener();

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      if (statusFrame !== null) cancelAnimationFrame(statusFrame);
      pendingStatus = null;
      if (unlisten) unlisten();
      if (unlistenSettings) unlistenSettings();
    };
  }, []);

  const handleStatusPayload = (payload: string) => {
    try {
      const data = JSON.parse(payload) as ReplayProgressPayload;
      if (data.status && data.status !== "ERROR") {
        const nextStatus = data.status as "DISCONNECTED" | "CONNECTED" | "READY" | "ACTIVE";
        setStatus((prev) => prev !== nextStatus ? nextStatus : prev);
      }
      if (data.total_ticks !== undefined) {
        const total = data.total_ticks;
        setTotalTicks((prev) => prev !== total ? total : prev);
      }
      if (data.current_idx !== undefined && !isDraggingRef.current) {
        const cur = data.current_idx;
        setCurrentIdx((prev) => prev !== cur ? cur : prev);
      }
      if (data.virtual_time_msc !== undefined) {
        const vtime = data.virtual_time_msc;
        setVirtualTimeMsc((prev) => prev !== vtime ? vtime : prev);
      }
      if (data.is_playing !== undefined) {
        const playing = data.is_playing;
        const guard = playStateGuardRef.current;
        if (guard && performance.now() < guard.expireAt) {
          if (playing === guard.expected) {
            playStateGuardRef.current = null;
            isPlayingRef.current = playing;
            setIsPlaying((prev) => prev !== playing ? playing : prev);
          }
        } else {
          playStateGuardRef.current = null;
          isPlayingRef.current = playing;
          setIsPlaying((prev) => prev !== playing ? playing : prev);
        }
      }
      if (data.speed_mode) {
        const mode = data.speed_mode as "TEMPORAL" | "COUNT";
        setSpeedMode((prev) => prev !== mode ? mode : prev);
      }
      if (data.multiplier !== undefined) {
        const m = typeof data.multiplier === "number" ? data.multiplier : parseFloat(data.multiplier) || 1.0;
        setMultiplier((prev) => prev !== m ? m : prev);
      }
      if (data.tick_step !== undefined) {
        const ts = typeof data.tick_step === "number" ? data.tick_step : parseInt(String(data.tick_step), 10) || 1;
        setTickStep((prev) => prev !== ts ? ts : prev);
      }
      if (data.source_symbol) {
        const sym = data.source_symbol;
        setSourceSymbol((prev) => prev !== sym ? sym : prev);
      }
      if (data.loop_active !== undefined) {
        const lActive = data.loop_active;
        setLoopActive((prev) => prev !== lActive ? lActive : prev);
      }
      if (data.loop_a !== undefined) {
        const la = data.loop_a;
        setLoopA((prev) => prev !== la ? la : prev);
      }
      if (data.loop_b !== undefined) {
        const lb = data.loop_b;
        setLoopB((prev) => prev !== lb ? lb : prev);
      }
      if (data.loop_a_idx !== undefined) {
        const laIdx = data.loop_a_idx;
        setLoopAIdx((prev) => prev !== laIdx ? laIdx : prev);
      }
      if (data.loop_b_idx !== undefined) {
        const lbIdx = data.loop_b_idx;
        setLoopBIdx((prev) => prev !== lbIdx ? lbIdx : prev);
      }
    } catch (e) {
      console.error("Error parsing mt5-status in controller:", e);
    }
  };

  // --- IPC 送信コマンド ---
  const sendCommand = useCallback(async (cmd: ReplayCommand) => {
    try {
      await sendReplayCommand(cmd);
    } catch (e) {
      console.error("Failed to send command:", cmd, e);
    }
  }, []);

  const handlePlayPause = useCallback(() => {
    const nextPlaying = !isPlayingRef.current;
    isPlayingRef.current = nextPlaying;
    playStateGuardRef.current = {
      expected: nextPlaying,
      expireAt: performance.now() + 500,
    };
    setIsPlaying(nextPlaying);
    sendCommand({
      command: "CONTROL",
      is_playing: nextPlaying,
      speed_mode: speedMode,
      multiplier: multiplier,
      tick_step: tickStep,
    });
  }, [sendCommand, speedMode, multiplier, tickStep]);

  const handleStep = useCallback((step: number) => {
    sendCommand({
      command: "SEEK_RELATIVE",
      delta: step,
    });
  }, [sendCommand]);

  const updateSpeed = useCallback((mode: "TEMPORAL" | "COUNT", mult: number, step: number) => {
    setSpeedMode(mode);
    setMultiplier(mult);
    setTickStep(step);
    sendCommand({
      command: "CONTROL",
      speed_mode: mode,
      multiplier: mult,
      tick_step: step,
    });
  }, [sendCommand]);

  const handleCoarseSpeed = useCallback((increase: boolean) => {
    if (speedMode === "TEMPORAL") {
      const idx = timePresets.findIndex((p) => Math.abs(p - multiplier) < 0.01);
      if (idx !== -1) {
        const nextIdx = increase ? Math.min(timePresets.length - 1, idx + 1) : Math.max(0, idx - 1);
        updateSpeed("TEMPORAL", timePresets[nextIdx], tickStep);
      }
    } else {
      const idx = tickPresets.findIndex((p) => p === tickStep);
      if (idx !== -1) {
        const nextIdx = increase ? Math.min(tickPresets.length - 1, idx + 1) : Math.max(0, idx - 1);
        updateSpeed("COUNT", multiplier, tickPresets[nextIdx]);
      }
    }
  }, [speedMode, multiplier, tickStep, timePresets, tickPresets, updateSpeed]);

  const adjustSpeedByStep = useCallback((temporalDelta: number, countDelta: number) => {
    if (speedMode === "TEMPORAL") {
      const next = Math.max(0.1, parseFloat((multiplier + temporalDelta).toFixed(1)));
      updateSpeed("TEMPORAL", next, tickStep);
    } else {
      const next = Math.max(1, tickStep + countDelta);
      updateSpeed("COUNT", multiplier, next);
    }
  }, [speedMode, multiplier, tickStep, updateSpeed]);

  const handleMediumSpeed = useCallback((increase: boolean) => {
    adjustSpeedByStep(increase ? 1.0 : -1.0, increase ? 10 : -10);
  }, [adjustSpeedByStep]);

  const handleFineSpeed = useCallback((increase: boolean) => {
    adjustSpeedByStep(increase ? 0.1 : -0.1, increase ? 1 : -1);
  }, [adjustSpeedByStep]);

  const handleSetLoopA = useCallback(() => {
    sendCommand({ command: "LOOP_SET_A" });
  }, [sendCommand]);

  const handleSetLoopB = useCallback(() => {
    sendCommand({ command: "LOOP_SET_B" });
  }, [sendCommand]);

  const handleClearLoop = useCallback(() => {
    sendCommand({ command: "LOOP_CLEAR" });
  }, [sendCommand]);

  // ドラッグ/クリックシーク (requestAnimationFrame によるスロットリングと即時確定)
  const pendingSeekTargetRef = useRef<number | null>(null);
  const seekRafRef = useRef<number | null>(null);
  const pendingSeekTimeTargetRef = useRef<number | null>(null);
  const seekTimeRafRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (seekRafRef.current !== null) {
        cancelAnimationFrame(seekRafRef.current);
      }
      if (seekTimeRafRef.current !== null) {
        cancelAnimationFrame(seekTimeRafRef.current);
      }
    };
  }, []);

  const sendSeekCommand = useCallback((targetIdx: number, immediate: boolean = false) => {
    pendingSeekTargetRef.current = targetIdx;
    if (immediate) {
      if (seekRafRef.current !== null) {
        cancelAnimationFrame(seekRafRef.current);
        seekRafRef.current = null;
      }
      const idx = pendingSeekTargetRef.current;
      pendingSeekTargetRef.current = null;
      sendCommand({
        command: "SEEK",
        target_index: idx,
      }).catch(console.error);
      return;
    }

    if (seekRafRef.current === null) {
      seekRafRef.current = requestAnimationFrame(() => {
        seekRafRef.current = null;
        if (pendingSeekTargetRef.current !== null) {
          const idx = pendingSeekTargetRef.current;
          pendingSeekTargetRef.current = null;
          sendCommand({
            command: "SEEK",
            target_index: idx,
          }).catch(console.error);
        }
      });
    }
  }, [sendCommand]);

  const sendSeekTimeCommand = useCallback((targetMsc: number, immediate: boolean = false) => {
    pendingSeekTimeTargetRef.current = targetMsc;
    if (immediate) {
      if (seekTimeRafRef.current !== null) {
        cancelAnimationFrame(seekTimeRafRef.current);
        seekTimeRafRef.current = null;
      }
      const msc = pendingSeekTimeTargetRef.current;
      pendingSeekTimeTargetRef.current = null;
      sendCommand({
        command: "SEEK_TIME",
        target_time_msc: msc,
      }).catch(console.error);
      return;
    }

    if (seekTimeRafRef.current === null) {
      seekTimeRafRef.current = requestAnimationFrame(() => {
        seekTimeRafRef.current = null;
        if (pendingSeekTimeTargetRef.current !== null) {
          const msc = pendingSeekTimeTargetRef.current;
          pendingSeekTimeTargetRef.current = null;
          sendCommand({
            command: "SEEK_TIME",
            target_time_msc: msc,
          }).catch(console.error);
        }
      });
    }
  }, [sendCommand]);

  // タイムライン活動度 (波形) の取得 (日変更時のみ実行する O(1) 整数範囲チェック)
  useEffect(() => {
    if (virtualTimeMsc <= 0) return;
    if (
      timelineActivity &&
      virtualTimeMsc >= timelineActivity.day_start_msc &&
      virtualTimeMsc <= timelineActivity.day_end_msc
    ) {
      return;
    }

    const dateStr = formatServerTime(virtualTimeMsc).substring(0, 10);
    if (dateStr && dateStr !== lastActivityDateRef.current) {
      lastActivityDateRef.current = dateStr;
      invoke<DayTimelineActivity>(COMMANDS.getDayTimelineActivity, {
        virtualTimeMsc,
      })
        .then((res) => {
          if (res && res.date_str) {
            setTimelineActivity(res);
          }
        })
        .catch((err) => {
          console.warn("Failed to fetch day timeline activity:", err);
        });
    }
  }, [virtualTimeMsc, timelineActivity]);

  // 自動スキップ (Auto-Skip) ロジック
  const handleSetAutoSkipFlat = useCallback((val: boolean) => {
    setAutoSkipFlat(val);
    localStorage.setItem(STORAGE_KEYS.replayAutoSkipFlat, String(val));
    if (!val && isAutoSpeedBoostedRef.current) {
      isAutoSpeedBoostedRef.current = false;
      sendCommand({
        command: "CONTROL",
        speed_mode: speedMode,
        multiplier: normalMultiplierRef.current || 1.0,
        tick_step: tickStep,
      }).catch(console.error);
    }
  }, [sendCommand, speedMode, tickStep]);

  // 自動スキップ設定モーダル開閉 & 保存
  const handleOpenAutoSkipSettings = useCallback(() => {
    setTempAutoSkipThreshold(autoSkipThreshold);
    setTempActivityMaxCap(timelineActivityMaxCap);
    setTempActivityMinFloor(timelineActivityMinFloor);
    setIsAutoSkipModalOpen(true);
  }, [autoSkipThreshold, timelineActivityMaxCap, timelineActivityMinFloor]);

  const handleSaveAutoSkipSettings = useCallback(async () => {
    try {
      const current = await invoke<PersistedSettings>(COMMANDS.loadSettings).catch(() => null);
      await invoke(COMMANDS.saveSettings, {
        settings: {
          ...(current || {}),
          auto_skip_threshold: tempAutoSkipThreshold,
          timeline_activity_max_cap: tempActivityMaxCap,
          timeline_activity_min_floor: tempActivityMinFloor,
        },
      });

      setAutoSkipThreshold(tempAutoSkipThreshold);
      setTimelineActivityMaxCap(tempActivityMaxCap);
      setTimelineActivityMinFloor(tempActivityMinFloor);

      await emit(EVENTS.settingsUpdated, {
        autoSkipThreshold: tempAutoSkipThreshold,
        timelineActivityMaxCap: tempActivityMaxCap,
        timelineActivityMinFloor: tempActivityMinFloor,
      });

      lastActivityDateRef.current = "";
      setIsAutoSkipModalOpen(false);
    } catch (err) {
      console.error("Failed to save auto skip settings:", err);
    }
  }, [tempAutoSkipThreshold, tempActivityMaxCap, tempActivityMinFloor]);

  useEffect(() => {
    if (!autoSkipFlat || !isPlaying || !timelineActivity || speedMode !== "TEMPORAL") {
      if (isAutoSpeedBoostedRef.current) {
        isAutoSpeedBoostedRef.current = false;
        sendCommand({
          command: "CONTROL",
          speed_mode: speedMode,
          multiplier: normalMultiplierRef.current || 1.0,
          tick_step: tickStep,
        }).catch(console.error);
      }
      return;
    }

    const secInDay = Math.floor((virtualTimeMsc - timelineActivity.day_start_msc) / 1000);
    if (secInDay < 0 || secInDay >= 86400) return;

    const slotIdx = Math.max(0, Math.min(95, Math.floor(secInDay / 900)));
    const intensity = timelineActivity.slots_15m[slotIdx] || 0;
    const threshold = autoSkipThreshold || 0.15;
    const restoreMargin = threshold >= 0.50 ? 0.05 : 0.10;
    const restoreThreshold = Math.min(0.95, threshold + restoreMargin);

    if (intensity < threshold) {
      // 閑散状態: 自動早送り (150x)
      if (!isAutoSpeedBoostedRef.current) {
        isAutoSpeedBoostedRef.current = true;
        normalMultiplierRef.current = multiplier >= 50.0 ? 1.0 : multiplier;
        sendCommand({
          command: "CONTROL",
          speed_mode: "TEMPORAL",
          multiplier: 150.0,
          tick_step: tickStep,
        }).catch(console.error);
      }
    } else if (intensity >= restoreThreshold) {
      // 活動再開: 通常速度へ復帰
      if (isAutoSpeedBoostedRef.current) {
        isAutoSpeedBoostedRef.current = false;
        sendCommand({
          command: "CONTROL",
          speed_mode: "TEMPORAL",
          multiplier: normalMultiplierRef.current || 1.0,
          tick_step: tickStep,
        }).catch(console.error);
      }
    }
  }, [autoSkipFlat, autoSkipThreshold, isPlaying, virtualTimeMsc, timelineActivity, speedMode, multiplier, tickStep, sendCommand]);

  const handleSessionJump = useCallback((session: string, dir: "PREV" | "NEXT") => {
    sendCommand({
      command: "SESSION_JUMP",
      session: session,
      direction: dir,
    });
  }, [sendCommand]);

  const handleTimeJump = useCallback((seconds: number) => {
    sendCommand({
      command: "TIME_JUMP",
      delta_seconds: seconds,
    });
  }, [sendCommand]);

  const getDayOffset = useCallback((): string => {
    if (virtualTimeMsc <= 0) return "";
    const current = new Date(virtualTimeMsc);
    return `${current.getMonth() + 1}/${current.getDate()}`;
  }, [virtualTimeMsc]);

  // コントローラーウィンドウフォーカス時の直感キーボード操作 (Space: 再生/停止, 矢印: 1T, Shift+矢印: 10M, Ctrl+矢印: 1H)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement).isContentEditable
      ) {
        return;
      }

      if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.code === "Space") {
        e.preventDefault();
        if (!e.repeat) {
          handlePlayPause();
        }
      } else if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.code === "ArrowRight") {
        e.preventDefault();
        handleStep(1);
      } else if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.code === "ArrowLeft") {
        e.preventDefault();
        handleStep(-1);
      } else if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && e.code === "ArrowRight") {
        e.preventDefault();
        handleTimeJump(600);
      } else if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && e.code === "ArrowLeft") {
        e.preventDefault();
        handleTimeJump(-600);
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.code === "ArrowRight") {
        e.preventDefault();
        handleTimeJump(3600);
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.code === "ArrowLeft") {
        e.preventDefault();
        handleTimeJump(-3600);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handlePlayPause, handleStep, handleTimeJump]);

  // --- 終了アクション ---

  // 1. リプレイを停止して設定画面（モニター1）へ戻る
  const handleStopAndReturnToSetup = async () => {
    setIsExitMenuOpen(false);
    try {
      await sendCommand({ command: "TERMINATE" });
      await invoke(COMMANDS.showSetupWindow);
    } catch (e) {
      console.error("Failed to return to setup:", e);
    }
  };

  // 2. セッション保存モーダルを開く
  const handleOpenSaveAndExit = () => {
    setIsExitMenuOpen(false);
    const now = new Date();
    const defaultName = formatReplaySessionName(sourceSymbol || "REPLAY", now);
    setSaveSessionName(defaultName);
    setIsSaveAndExitModalOpen(true);
  };

  // 3. セッションを保存してアプリを終了
  const handleConfirmSaveAndExit = async () => {
    try {
      const sessionId = "session_" + Date.now();
      const sessionData = {
        session_id: sessionId,
        name: saveSessionName.trim() || "Saved Session",
        group_id: "group_" + Date.now(),
        timestamp: Date.now(),
        source_symbol: sourceSymbol,
        start_time: startTime,
        end_time: endTime,
        current_idx: currentIdx,
        total_ticks: totalTicks,
        virtual_time_msc: virtualTimeMsc,
      };
      try {
        await invoke(COMMANDS.saveSession, { sessionId, sessionData });
      } catch (err) {
        console.warn("Session save note:", err);
      }
      await sendCommand({ command: "TERMINATE" });
      await invoke(COMMANDS.exitApp);
    } catch (e) {
      console.error("Failed to exit app:", e);
      await invoke(COMMANDS.exitApp);
    }
  };

  // 4. 保存せずにTickReplayを終了
  const handleDirectExitApp = async () => {
    setIsExitMenuOpen(false);
    try {
      await sendCommand({ command: "TERMINATE" });
    } catch (e) {
      console.warn(e);
    }
    try {
      await invoke(COMMANDS.exitApp);
    } catch (e) {
      console.error("Failed to exit app:", e);
    }
  };

  const progressPercent = totalTicks > 0 ? (currentIdx / totalTicks) * 100 : 0;
  const rawTimeStr =
    virtualTimeMsc > 0
      ? timezoneMode === "JST"
        ? formatJstTime(virtualTimeMsc)
        : formatServerTime(virtualTimeMsc)
      : "--:--:--";
  const { datePart, timePart } = splitShortDateTime(rawTimeStr);

  return (
    <div className="controller-window-root">
      {/* 上部ヘッダーバー (小型430px専用) */}
      <header className="controller-window-header">
        <div
          className="ctrl-header-left"
          title={`シンボル: ${sourceSymbol || "未指定"}\n接続状態: ${
            status === "ACTIVE"
              ? "リプレイ再生中"
              : status === "READY"
              ? "準備完了"
              : status === "CONNECTED"
              ? "接続完了"
              : "未接続"
          }`}
        >
          <span className={`ctrl-status-dot ${status.toLowerCase()}`} />
        </div>

        <button
          type="button"
          className="ctrl-time-btn font-data"
          onClick={() => {
            const next = timezoneMode === "JST" ? "SERVER" : "JST";
            setTimezoneMode(next);
            localStorage.setItem(STORAGE_KEYS.replayTimezoneMode, next);
          }}
          title={`表示タイムゾーン切替 (現在: ${timezoneMode === "JST" ? "JST 日本時間" : "SERVER MT5サーバー時刻"})\nリプレイ日時: ${rawTimeStr}\nクリックで切替`}
        >
          <span className="tz-label">{timezoneMode}</span>
          <span className="time-val">
            {datePart ? <span className="time-date-part">{datePart}</span> : null}
            <span className="time-clock-part">{timePart}</span>
          </span>
        </button>

        <div className="ctrl-header-right" ref={exitMenuRef} style={{ position: "relative" }}>
          <button
            type="button"
            className="ctrl-icon-btn ctrl-timeline-btn"
            onClick={() => invoke(COMMANDS.openTimelineWindow).catch(console.error)}
            title="タイムライン・ナビゲーター (詳細波形・ボラティリティ) を開く"
          >
            <span className="material-symbols-outlined icon" style={{ color: "#38bdf8" }}>timeline</span>
          </button>
          <button
            type="button"
            className="ctrl-icon-btn ctrl-speed-order-btn"
            onClick={() => invoke(COMMANDS.openSpeedOrderWindow).catch(console.error)}
            title="スピード発注画面を開く"
          >
            <span className="material-symbols-outlined icon">monetization_on</span>
          </button>
          <button
            type="button"
            className="ctrl-icon-btn"
            onClick={() => invoke(COMMANDS.openPositionsWindow).catch(console.error)}
            title="口座・ポジション管理画面を開く"
          >
            <span className="material-symbols-outlined icon text-green">account_balance_wallet</span>
          </button>
          <button
            type="button"
            className="ctrl-icon-btn"
            onClick={() => invoke(COMMANDS.openTracelyApp).catch(console.error)}
            title="トレード分析 (Tracely) を起動"
          >
            <span className="material-symbols-outlined icon">analytics</span>
          </button>
          <button
            type="button"
            className="ctrl-icon-btn"
            onClick={() => invoke(COMMANDS.openSettingsWindow).catch(console.error)}
            title="環境設定画面を開く"
          >
            <span className="material-symbols-outlined icon">settings</span>
          </button>
          <button
            type="button"
            className={`ctrl-icon-btn danger ${isExitMenuOpen ? "active" : ""}`}
            onClick={() => setIsExitMenuOpen((prev) => !prev)}
            title="終了メニュー (クリックで終了方法を選択)"
          >
            <span className="material-symbols-outlined icon">power_settings_new</span>
          </button>

          {/* 終了方法選択ドロップダウンメニュー */}
          {isExitMenuOpen && (
            <div className="ctrl-exit-dropdown-menu">
              <div className="exit-menu-header">
                <span className="material-symbols-outlined exit-header-icon">logout</span>
                <span className="exit-header-title">終了方法を選択</span>
              </div>
              <button
                type="button"
                className="exit-menu-item"
                onClick={handleStopAndReturnToSetup}
              >
                <span className="material-symbols-outlined icon text-cyan">tune</span>
                <div className="exit-item-text">
                  <span className="exit-item-title">リプレイを停止して設定画面へ</span>
                  <span className="exit-item-desc">再生を停止し、モニター1の設定画面を開きます</span>
                </div>
              </button>
              <button
                type="button"
                className="exit-menu-item"
                onClick={handleOpenSaveAndExit}
              >
                <span className="material-symbols-outlined icon text-green">save</span>
                <div className="exit-item-text">
                  <span className="exit-item-title">セッションを保存して終了</span>
                  <span className="exit-item-desc">現在の進捗を保存してアプリを終了します</span>
                </div>
              </button>
              <div className="exit-menu-divider" />
              <button
                type="button"
                className="exit-menu-item danger"
                onClick={handleDirectExitApp}
              >
                <span className="material-symbols-outlined icon">power_settings_new</span>
                <div className="exit-item-text">
                  <span className="exit-item-title">保存せずにTickReplayを終了</span>
                  <span className="exit-item-desc">すべてのウィンドウを閉じてアプリを終了します</span>
                </div>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* メインコントローラーダッシュボード */}
      <main className="controller-window-body">
        <ControlDashboard
          speedMode={speedMode}
          multiplier={multiplier}
          tickStep={tickStep}
          timePresets={timePresets}
          tickPresets={tickPresets}
          updateSpeed={updateSpeed}
          handlePlayPause={handlePlayPause}
          isPlaying={isPlaying}
          handleStep={handleStep}
          handleCoarseSpeed={handleCoarseSpeed}
          handleMediumSpeed={handleMediumSpeed}
          handleFineSpeed={handleFineSpeed}
          setIsSpeedPresetsModalOpen={setIsSpeedPresetsModalOpen}
          loopActive={loopActive}
          loopA={loopA}
          loopB={loopB}
          loopAIdx={loopAIdx}
          loopBIdx={loopBIdx}
          handleSetLoopA={handleSetLoopA}
          handleSetLoopB={handleSetLoopB}
          handleClearLoop={handleClearLoop}
          totalTicks={totalTicks}
          currentIdx={currentIdx}
          setCurrentIdx={setCurrentIdx}
          sendSeekCommand={sendSeekCommand}
          isDraggingRef={isDraggingRef}
          progressPercent={progressPercent}
          timeSteps={timeSteps}
          setIsTimeStepsModalOpen={setIsTimeStepsModalOpen}
          handleSessionJump={handleSessionJump}
          handleTimeJump={handleTimeJump}
          getDayOffset={getDayOffset}
          startTime={startTime}
          endTime={endTime}
          virtualTimeMsc={virtualTimeMsc}
          timezoneMode={timezoneMode}
          timelineActivity={timelineActivity}
          sendSeekTimeCommand={sendSeekTimeCommand}
          autoSkipFlat={autoSkipFlat}
          setAutoSkipFlat={handleSetAutoSkipFlat}
          onOpenAutoSkipSettings={handleOpenAutoSkipSettings}
        />
      </main>

      {/* 自動スキップ設定モーダル */}
      {isAutoSkipModalOpen && (
        <div className="modal-overlay" onClick={() => setIsAutoSkipModalOpen(false)}>
          <div className="modal-container" style={{ maxWidth: "380px" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">自動スキップ設定</h3>
              <button className="modal-close-btn" onClick={() => setIsAutoSkipModalOpen(false)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="modal-body" style={{ padding: "14px", display: "flex", flexDirection: "column", gap: "14px" }}>
              <div>
                <label className="form-label" style={{ fontWeight: "bold", fontSize: "12px", display: "block", marginBottom: "4px" }}>
                  スキップ発動閾値
                </label>
                <select
                  className="input-compact font-data"
                  style={{ width: "100%", padding: "6px 8px", fontSize: "12px" }}
                  value={tempAutoSkipThreshold}
                  onChange={(e) => setTempAutoSkipThreshold(parseFloat(e.target.value) || 0.15)}
                >
                  <option value={0.10}>10% (閑散・早朝帯のみ)</option>
                  <option value={0.15}>15% (標準)</option>
                  <option value={0.20}>20% (やや早め)</option>
                  <option value={0.25}>25% (積極的)</option>
                  <option value={0.35}>35% (低活動スキップ・中活動〜)</option>
                  <option value={0.50}>50% (活発相場のみ再生)</option>
                  <option value={0.70}>70% (激変帯特化・急騰急落のみ)</option>
                </select>
                <span className="settings-hint" style={{ fontSize: "11px", display: "block", marginTop: "4px" }}>
                  活動強度がこの割合を下回ると自動早送り (復帰: {Math.min(95, Math.round((tempAutoSkipThreshold + (tempAutoSkipThreshold >= 0.5 ? 0.05 : 0.1)) * 100))}%)
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <div>
                  <label className="form-label" style={{ fontWeight: "bold", fontSize: "11px", display: "block", marginBottom: "4px" }}>
                    基準上限キャップ (15分)
                  </label>
                  <input
                    type="number"
                    className="input-compact font-data"
                    style={{ width: "100%", padding: "5px 8px", fontSize: "12px" }}
                    min={500}
                    max={10000}
                    step={100}
                    value={tempActivityMaxCap}
                    onChange={(e) => setTempActivityMaxCap(Math.max(500, parseInt(e.target.value, 10) || 2800))}
                  />
                  <span className="settings-hint" style={{ fontSize: "10px", display: "block", marginTop: "2px" }}>
                    上限天井 (初期値: 2800)
                  </span>
                </div>

                <div>
                  <label className="form-label" style={{ fontWeight: "bold", fontSize: "11px", display: "block", marginBottom: "4px" }}>
                    基準下限フロア (15分)
                  </label>
                  <input
                    type="number"
                    className="input-compact font-data"
                    style={{ width: "100%", padding: "5px 8px", fontSize: "12px" }}
                    min={200}
                    max={5000}
                    step={50}
                    value={tempActivityMinFloor}
                    onChange={(e) => setTempActivityMinFloor(Math.max(200, parseInt(e.target.value, 10) || 1500))}
                  />
                  <span className="settings-hint" style={{ fontSize: "10px", display: "block", marginTop: "2px" }}>
                    最低基準 (初期値: 1500)
                  </span>
                </div>
              </div>
            </div>
            <div className="modal-footer" style={{ padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <button
                type="button"
                className="btn-action-outline"
                style={{ fontSize: "11px", padding: "4px 8px" }}
                onClick={() => {
                  setTempAutoSkipThreshold(0.15);
                  setTempActivityMaxCap(2800);
                  setTempActivityMinFloor(1500);
                }}
              >
                初期値に戻す
              </button>
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  type="button"
                  className="btn-action-outline"
                  onClick={() => setIsAutoSkipModalOpen(false)}
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  className="btn-modal-primary"
                  onClick={handleSaveAutoSkipSettings}
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 速度プリセット編集モーダル */}
      <SpeedPresetsModal
        isOpen={isSpeedPresetsModalOpen}
        timePresets={timePresets}
        tickPresets={tickPresets}
        onSave={(times, ticks) => {
          setTimePresets(times);
          setTickPresets(ticks);
          localStorage.setItem(STORAGE_KEYS.timePresets, JSON.stringify(times));
          localStorage.setItem(STORAGE_KEYS.tickPresets, JSON.stringify(ticks));
        }}
        onClose={() => setIsSpeedPresetsModalOpen(false)}
      />

      {/* タイムステップ編集モーダル */}
      <TimeStepsModal
        isOpen={isTimeStepsModalOpen}
        timeSteps={timeSteps}
        onApply={(steps) => {
          setTimeSteps(steps);
          localStorage.setItem(STORAGE_KEYS.customTimeSteps, JSON.stringify(steps));
        }}
        onClose={() => setIsTimeStepsModalOpen(false)}
      />

      {/* セッション保存して終了モーダル */}
      {isSaveAndExitModalOpen && (
        <div className="modal-overlay" onClick={() => setIsSaveAndExitModalOpen(false)}>
          <div className="modal-container" style={{ maxWidth: "380px" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span className="material-symbols-outlined icon text-green">save</span>
                セッションを保存して終了
              </h3>
              <button className="modal-close-btn" onClick={() => setIsSaveAndExitModalOpen(false)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="modal-body" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <label className="form-label">セッション名:</label>
              <input
                type="text"
                className="input-compact font-data"
                value={saveSessionName}
                onChange={(e) => setSaveSessionName(e.target.value)}
                placeholder="セッション名を入力"
                autoFocus
              />
              <p style={{ margin: 0, fontSize: "11px", color: "var(--on-surface-variant)" }}>
                現在のリプレイ進捗、取引ポジション、履歴が保存され、次回起動時に「セッション再開」タブから再開できます。
              </p>
            </div>
            <div className="modal-footer" style={{ padding: "10px 16px", display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button
                type="button"
                className="btn-action-outline"
                onClick={() => setIsSaveAndExitModalOpen(false)}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="btn-modal-primary"
                onClick={handleConfirmSaveAndExit}
              >
                保存して終了
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
