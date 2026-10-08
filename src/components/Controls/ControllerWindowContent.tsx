import React, { useState, useEffect, useRef, useCallback } from "react";
import { COMMANDS } from "../../constants/commands";
import { EVENTS } from "../../constants/events";
import { STORAGE_KEYS } from "../../constants/storageKeys";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ControlDashboard } from "./ControlDashboard";
import { useTheme } from "../../hooks/useTheme";
import { formatJstTime, formatServerTime, splitShortDateTime } from "../../utils/timeUtils";
import { DEFAULT_TIME_STEPS, formatSecondsToLabel } from "../../domain/timeSteps";
import type { TimeStepItem } from "../../types/replay";
import { ReplayCommand, sendReplayCommand } from "../../utils/command";
import { PersistedSettings } from "../../types/settings";
import { ReplayProgressPayload } from "../../types/replay";

export const ControllerWindowContent: React.FC = () => {
  useTheme();

  // --- 再生ステータス State ---
  const [status, setStatus] = useState<"DISCONNECTED" | "CONNECTED" | "READY" | "ACTIVE">("DISCONNECTED");
  const [totalTicks, setTotalTicks] = useState(0);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [virtualTimeMsc, setVirtualTimeMsc] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
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
  const [timePresets, setTimePresets] = useState<number[]>([0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0]);
  const [tickPresets, setTickPresets] = useState<number[]>([1, 2, 5, 10, 30, 60]);
  const [isSpeedPresetsModalOpen, setIsSpeedPresetsModalOpen] = useState(false);
  const [editingTimePresets, setEditingTimePresets] = useState<number[]>([]);
  const [editingTickPresets, setEditingTickPresets] = useState<number[]>([]);
  const [modalNewTimePreset, setModalNewTimePreset] = useState("");
  const [modalNewTickPreset, setModalNewTickPreset] = useState("");

  // タイムステップ
  const [timeSteps, setTimeSteps] = useState<TimeStepItem[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.customTimeSteps);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (e) {
        console.error("Failed to parse custom-time-steps", e);
      }
    }
    return DEFAULT_TIME_STEPS;
  });
  const [isTimeStepsModalOpen, setIsTimeStepsModalOpen] = useState(false);
  const [editingTimeSteps, setEditingTimeSteps] = useState<TimeStepItem[]>([]);
  const [newStepSeconds, setNewStepSeconds] = useState(300);

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
        }
      })
      .catch(console.warn);

    // 購読完了前にこの effect が破棄された場合でもリスナーを残さないためのフラグ
    let disposed = false;
    let unlisten: (() => void) | undefined;

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
        handleStatusPayload(event.payload);
      });

      // 購読が解決する前にアンマウントされていた場合は即座に解除する
      if (disposed) {
        off();
        return;
      }
      unlisten = off;
    };

    setupListener();

    return () => {
      disposed = true;
      if (unlisten) unlisten();
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
        setIsPlaying((prev) => prev !== playing ? playing : prev);
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
  const sendCommand = async (cmd: ReplayCommand) => {
    try {
      await sendReplayCommand(cmd);
    } catch (e) {
      console.error("Failed to send command:", cmd, e);
    }
  };

  const handlePlayPause = () => {
    const nextPlaying = !isPlaying;
    setIsPlaying(nextPlaying);
    sendCommand({
      command: "CONTROL",
      is_playing: nextPlaying,
      speed_mode: speedMode,
      multiplier: multiplier,
      tick_step: tickStep,
    });
  };

  const handleStep = (step: number) => {
    sendCommand({
      command: "SEEK_RELATIVE",
      delta: step,
    });
  };

  const updateSpeed = (mode: "TEMPORAL" | "COUNT", mult: number, step: number) => {
    setSpeedMode(mode);
    setMultiplier(mult);
    setTickStep(step);
    sendCommand({
      command: "CONTROL",
      is_playing: isPlaying,
      speed_mode: mode,
      multiplier: mult,
      tick_step: step,
    });
  };

  const handleCoarseSpeed = (increase: boolean) => {
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
  };

  const handleMediumSpeed = (increase: boolean) => {
    if (speedMode === "TEMPORAL") {
      const delta = increase ? 1.0 : -1.0;
      const next = Math.max(0.1, parseFloat((multiplier + delta).toFixed(1)));
      updateSpeed("TEMPORAL", next, tickStep);
    } else {
      const delta = increase ? 10 : -10;
      const next = Math.max(1, tickStep + delta);
      updateSpeed("COUNT", multiplier, next);
    }
  };

  const handleFineSpeed = (increase: boolean) => {
    if (speedMode === "TEMPORAL") {
      const delta = increase ? 0.1 : -0.1;
      const next = Math.max(0.1, parseFloat((multiplier + delta).toFixed(1)));
      updateSpeed("TEMPORAL", next, tickStep);
    } else {
      const delta = increase ? 1 : -1;
      const next = Math.max(1, tickStep + delta);
      updateSpeed("COUNT", multiplier, next);
    }
  };

  const handleSetLoopA = () => {
    sendCommand({ command: "LOOP_SET_A" });
  };

  const handleSetLoopB = () => {
    sendCommand({ command: "LOOP_SET_B" });
  };

  const handleClearLoop = () => {
    sendCommand({ command: "LOOP_CLEAR" });
  };

  // ドラッグ/クリックシーク (requestAnimationFrame によるスロットリングと即時確定)
  const pendingSeekTargetRef = useRef<number | null>(null);
  const seekRafRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (seekRafRef.current !== null) {
        cancelAnimationFrame(seekRafRef.current);
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

  const handleSessionJump = (session: string, dir: "PREV" | "NEXT") => {
    sendCommand({
      command: "SESSION_JUMP",
      session: session,
      direction: dir,
    });
  };

  const handleTimeJump = (seconds: number) => {
    sendCommand({
      command: "TIME_JUMP",
      delta_seconds: seconds,
    });
  };

  const getDayOffset = (): string => {
    if (virtualTimeMsc <= 0) return "";
    const current = new Date(virtualTimeMsc);
    return `${current.getMonth() + 1}/${current.getDate()}`;
  };

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
        handlePlayPause();
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
    const pad = (n: number) => n.toString().padStart(2, "0");
    const defaultName = `${sourceSymbol || "REPLAY"}_Replay_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
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
            <span className="material-symbols-outlined icon text-indigo">analytics</span>
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
          setEditingTimePresets={setEditingTimePresets}
          setEditingTickPresets={setEditingTickPresets}
          setModalNewTimePreset={setModalNewTimePreset}
          setModalNewTickPreset={setModalNewTickPreset}
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
          setEditingTimeSteps={setEditingTimeSteps}
          handleSessionJump={handleSessionJump}
          handleTimeJump={handleTimeJump}
          getDayOffset={getDayOffset}
          startTime={startTime}
          endTime={endTime}
          virtualTimeMsc={virtualTimeMsc}
          timezoneMode={timezoneMode}
        />
      </main>

      {/* 速度プリセット編集モーダル */}
      {isSpeedPresetsModalOpen && (
        <div className="modal-overlay" onClick={() => setIsSpeedPresetsModalOpen(false)}>
          <div className="modal-container" style={{ maxWidth: "380px" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">速度プリセット設定</h3>
              <button className="modal-close-btn" onClick={() => setIsSpeedPresetsModalOpen(false)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="modal-body" style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <div>
                <label className="form-label">時間比率プリセット (倍率):</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", margin: "4px 0" }}>
                  {editingTimePresets.map((val, idx) => (
                    <span key={idx} className="chip-btn">
                      {val}x
                      <button
                        type="button"
                        style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", marginLeft: "4px" }}
                        onClick={() => setEditingTimePresets(editingTimePresets.filter((_, i) => i !== idx))}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <div style={{ display: "flex", gap: "4px" }}>
                  <input
                    type="number"
                    step="0.1"
                    className="input-compact"
                    placeholder="例: 15.0"
                    value={modalNewTimePreset}
                    onChange={(e) => setModalNewTimePreset(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-modal-primary"
                    onClick={() => {
                      const num = parseFloat(modalNewTimePreset);
                      if (!isNaN(num) && num > 0 && !editingTimePresets.includes(num)) {
                        setEditingTimePresets([...editingTimePresets, num].sort((a, b) => a - b));
                        setModalNewTimePreset("");
                      }
                    }}
                  >
                    追加
                  </button>
                </div>
              </div>

              <div>
                <label className="form-label">ティック比率プリセット (ステップ):</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", margin: "4px 0" }}>
                  {editingTickPresets.map((val, idx) => (
                    <span key={idx} className="chip-btn">
                      {val}T
                      <button
                        type="button"
                        style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", marginLeft: "4px" }}
                        onClick={() => setEditingTickPresets(editingTickPresets.filter((_, i) => i !== idx))}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <div style={{ display: "flex", gap: "4px" }}>
                  <input
                    type="number"
                    className="input-compact"
                    placeholder="例: 100"
                    value={modalNewTickPreset}
                    onChange={(e) => setModalNewTickPreset(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-modal-primary"
                    onClick={() => {
                      const num = parseInt(modalNewTickPreset, 10);
                      if (!isNaN(num) && num > 0 && !editingTickPresets.includes(num)) {
                        setEditingTickPresets([...editingTickPresets, num].sort((a, b) => a - b));
                        setModalNewTickPreset("");
                      }
                    }}
                  >
                    追加
                  </button>
                </div>
              </div>
            </div>
            <div className="modal-footer" style={{ padding: "8px 12px", display: "flex", justifyContent: "flex-end", gap: "6px" }}>
              <button
                type="button"
                className="btn-action-outline"
                onClick={() => setIsSpeedPresetsModalOpen(false)}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="btn-modal-primary"
                onClick={() => {
                  setTimePresets(editingTimePresets);
                  setTickPresets(editingTickPresets);
                  localStorage.setItem(STORAGE_KEYS.timePresets, JSON.stringify(editingTimePresets));
                  localStorage.setItem(STORAGE_KEYS.tickPresets, JSON.stringify(editingTickPresets));
                  setIsSpeedPresetsModalOpen(false);
                }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* タイムステップ編集モーダル */}
      {isTimeStepsModalOpen && (
        <div className="modal-overlay" onClick={() => setIsTimeStepsModalOpen(false)}>
          <div className="modal-container" style={{ maxWidth: "380px" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">タイムステップ設定</h3>
              <button className="modal-close-btn" onClick={() => setIsTimeStepsModalOpen(false)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="modal-body" style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                {editingTimeSteps.map((item, idx) => (
                  <span key={item.id} className="chip-btn">
                    {item.label}
                    <button
                      type="button"
                      style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", marginLeft: "4px" }}
                      onClick={() => setEditingTimeSteps(editingTimeSteps.filter((_, i) => i !== idx))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div style={{ display: "flex", gap: "4px" }}>
                <input
                  type="number"
                  className="input-compact"
                  placeholder="秒数 (例: 300)"
                  value={newStepSeconds}
                  onChange={(e) => setNewStepSeconds(parseInt(e.target.value, 10) || 0)}
                />
                <button
                  type="button"
                  className="btn-modal-primary"
                  onClick={() => {
                    if (newStepSeconds > 0 && !editingTimeSteps.some((s) => s.seconds === newStepSeconds)) {
                      const newId = "ts-" + Date.now();
                      const newLabel = formatSecondsToLabel(newStepSeconds);
                      setEditingTimeSteps([...editingTimeSteps, { id: newId, seconds: newStepSeconds, label: newLabel }].sort((a, b) => a.seconds - b.seconds));
                    }
                  }}
                >
                  追加
                </button>
              </div>
            </div>
            <div className="modal-footer" style={{ padding: "8px 12px", display: "flex", justifyContent: "flex-end", gap: "6px" }}>
              <button
                type="button"
                className="btn-action-outline"
                onClick={() => setIsTimeStepsModalOpen(false)}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="btn-modal-primary"
                onClick={() => {
                  setTimeSteps(editingTimeSteps);
                  localStorage.setItem(STORAGE_KEYS.customTimeSteps, JSON.stringify(editingTimeSteps));
                  setIsTimeStepsModalOpen(false);
                }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

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
