import React, { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ControlDashboard } from "./ControlDashboard";
import { useTheme } from "../../hooks/useTheme";
import { formatJstTime, formatServerTime } from "../../utils/timeUtils";
import { TimeStepItem, DEFAULT_TIME_STEPS, formatSecondsToLabel } from "../../App";
import { ReplayCommand, sendReplayCommand } from "../../utils/command";
import { PersistedSettings } from "../../types/settings";
import { ReplayProgressPayload } from "../../types/replay";
import { getCachedEconomicAvailabilityMap, isEconomicSpreadActive } from "../../utils/economicDataUtils";

export const ControllerWindowContent: React.FC = () => {
  useTheme();

  // --- 経済指標データ充足状態 ---
  const [economicMap, setEconomicMap] = useState<Record<string, boolean>>(() => getCachedEconomicAvailabilityMap());

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === "replay-economic-availability" && e.newValue) {
        try {
          setEconomicMap(JSON.parse(e.newValue));
        } catch (err) {
          console.error("Failed to parse economic availability in controller", err);
        }
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

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
  const [timezoneMode, setTimezoneMode] = useState<"JST" | "SERVER">("JST");

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
    const saved = localStorage.getItem("custom-time-steps");
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
    invoke<PersistedSettings>("load_settings")
      .then((settings) => {
        if (settings) {
          if (settings.start_time) setStartTime(settings.start_time);
          if (settings.end_time) setEndTime(settings.end_time);
          if (settings.source_symbol) setSourceSymbol((prev) => prev || settings.source_symbol || "");
          if (settings.timezone_mode) setTimezoneMode(settings.timezone_mode as "JST" | "SERVER");
          if (settings.time_presets && Array.isArray(settings.time_presets) && settings.time_presets.length > 0) {
            setTimePresets(settings.time_presets);
          }
          if (settings.tick_presets && Array.isArray(settings.tick_presets) && settings.tick_presets.length > 0) {
            setTickPresets(settings.tick_presets);
          }
        }
      })
      .catch(console.warn);

    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      // 初期ステータス取得
      try {
        const lastStatusStr = await invoke<string>("get_last_status");
        if (lastStatusStr) {
          handleStatusPayload(lastStatusStr);
        }
      } catch (err) {
        console.warn("Failed to get initial status:", err);
      }

      // イベント購読
      unlisten = await listen<string>("mt5-status", (event) => {
        handleStatusPayload(event.payload);
      });
    };

    setupListener();

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const handleStatusPayload = (payload: string) => {
    try {
      const data = JSON.parse(payload) as ReplayProgressPayload;
      if (data.status && data.status !== "ERROR") {
        setStatus(data.status);
      }
      if (data.total_ticks !== undefined) setTotalTicks(data.total_ticks);
      if (data.current_idx !== undefined && !isDraggingRef.current) setCurrentIdx(data.current_idx);
      if (data.virtual_time_msc !== undefined) setVirtualTimeMsc(data.virtual_time_msc);
      if (data.is_playing !== undefined) setIsPlaying(data.is_playing);
      if (data.speed_mode) setSpeedMode(data.speed_mode as "TEMPORAL" | "COUNT");
      if (data.multiplier !== undefined) {
        const m = typeof data.multiplier === "number" ? data.multiplier : parseFloat(data.multiplier) || 1.0;
        setMultiplier(m);
      }
      if (data.tick_step !== undefined) {
        const ts = typeof data.tick_step === "number" ? data.tick_step : parseInt(data.tick_step, 10) || 1;
        setTickStep(ts);
      }
      if (data.source_symbol) setSourceSymbol(data.source_symbol);
      if (data.loop_active !== undefined) setLoopActive(data.loop_active);
      if (data.loop_a !== undefined) setLoopA(data.loop_a);
      if (data.loop_b !== undefined) setLoopB(data.loop_b);
      if (data.loop_a_idx !== undefined) setLoopAIdx(data.loop_a_idx);
      if (data.loop_b_idx !== undefined) setLoopBIdx(data.loop_b_idx);
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

  // --- 終了アクション ---

  // 1. リプレイを停止して設定画面（モニター1）へ戻る
  const handleStopAndReturnToSetup = async () => {
    setIsExitMenuOpen(false);
    try {
      await sendCommand({ command: "TERMINATE" });
      await invoke("show_setup_window");
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
        await invoke("save_session", { sessionId, sessionData });
      } catch (err) {
        console.warn("Session save note:", err);
      }
      await sendCommand({ command: "TERMINATE" });
      await invoke("exit_app");
    } catch (e) {
      console.error("Failed to exit app:", e);
      await invoke("exit_app");
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
      await invoke("exit_app");
    } catch (e) {
      console.error("Failed to exit app:", e);
    }
  };

  const progressPercent = totalTicks > 0 ? (currentIdx / totalTicks) * 100 : 0;
  const isEconomicMode = isEconomicSpreadActive(virtualTimeMsc, economicMap);
  const timeDisplayStr =
    virtualTimeMsc > 0
      ? timezoneMode === "JST"
        ? formatJstTime(virtualTimeMsc)
        : formatServerTime(virtualTimeMsc)
      : "--:--:--";

  return (
    <div className="controller-window-root">
      {/* 上部ヘッダーバー (小型430px専用) */}
      <header className="controller-window-header">
        <div className="ctrl-header-left">
          <span className={`ctrl-status-dot ${status.toLowerCase()}`} title={`Status: ${status}`} />
          <span className="ctrl-symbol-tag">{sourceSymbol || "REPLAY"}</span>
          <div
            className={`ctrl-spread-mode-badge ${isEconomicMode ? "mode-indicator" : "mode-normal"}`}
            title={
              isEconomicMode
                ? "【指標連動モード】現在の期間は経済指標データに基づいて、発表前後のスプレッドが強度に応じて先行拡大・動的変動します。"
                : "【通常モード】現在の期間は経済指標データがないため、平時固定スプレッド（仲値・早朝流動性制御のみ）で動作しています。"
            }
          >
            <span className="spread-mode-dot" />
            <span className="spread-mode-label">{isEconomicMode ? "指標連動" : "通常"}</span>
          </div>
          <button
            type="button"
            className="ctrl-time-btn font-data"
            onClick={() => setTimezoneMode((prev) => (prev === "JST" ? "SERVER" : "JST"))}
            title="クリックでJST / SERVER表示を切替"
          >
            <span className="tz-label">{timezoneMode}</span>
            <span className="time-val">{timeDisplayStr.substring(5, 19)}</span>
          </button>
        </div>

        <div className="ctrl-header-right" ref={exitMenuRef} style={{ position: "relative" }}>
          <button
            type="button"
            className="ctrl-icon-btn ctrl-speed-order-btn"
            onClick={() => invoke("open_speed_order_window").catch(console.error)}
            title="スピード発注画面を開く"
          >
            <span className="material-symbols-outlined icon">monetization_on</span>
          </button>
          <button
            type="button"
            className="ctrl-icon-btn"
            onClick={() => invoke("open_positions_window").catch(console.error)}
            title="口座・ポジション管理画面を開く"
          >
            <span className="material-symbols-outlined icon text-green">account_balance_wallet</span>
          </button>
          <button
            type="button"
            className="ctrl-icon-btn"
            onClick={() => invoke("open_tracely_app").catch(console.error)}
            title="トレード分析 (Tracely) を起動"
          >
            <span className="material-symbols-outlined icon text-indigo">analytics</span>
          </button>
          <button
            type="button"
            className="ctrl-icon-btn"
            onClick={() => invoke("open_settings_window").catch(console.error)}
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
                  localStorage.setItem("time-presets", JSON.stringify(editingTimePresets));
                  localStorage.setItem("tick-presets", JSON.stringify(editingTickPresets));
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
                  localStorage.setItem("custom-time-steps", JSON.stringify(editingTimeSteps));
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
