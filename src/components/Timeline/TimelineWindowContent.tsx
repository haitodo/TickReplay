import React, { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { COMMANDS } from "../../constants/commands";
import { EVENTS } from "../../constants/events";
import { STORAGE_KEYS } from "../../constants/storageKeys";
import { useAppearance } from "../../hooks/useAppearance";
import { formatJstTime, formatServerTime } from "../../utils/timeUtils";
import { ReplayCommand, sendReplayCommand } from "../../utils/command";
import type { DayTimelineActivity, ReplayProgressPayload } from "../../types/replay";
import type { PersistedSettings } from "../../types/settings";
import "./TimelineWindowContent.css";

export const TimelineWindowContent: React.FC = () => {
  useAppearance();

  // --- 再生ステータス ---
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

  const [timezoneMode, setTimezoneMode] = useState<"JST" | "SERVER">(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.replayTimezoneMode);
    return saved === "SERVER" ? "SERVER" : "JST";
  });

  // A-B ループ State
  const [loopActive, setLoopActive] = useState(false);
  const [loopA, setLoopA] = useState(-1);
  const [loopB, setLoopB] = useState(-1);

  // タイムライン活動度 (1日単位波形)
  const [timelineActivity, setTimelineActivity] = useState<DayTimelineActivity | null>(null);
  const lastActivityDateRef = useRef<string>("");

  // 最前面ピン留め
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(true);

  // ドラッグシーク
  const [dragSec, setDragSec] = useState<number | null>(null);
  const isDraggingCanvasRef = useRef(false);
  const pendingSeekTimeTargetRef = useRef<number | null>(null);
  const seekTimeRafRef = useRef<number | null>(null);

  // ホバー情報
  const [hoverInfo, setHoverInfo] = useState<{
    sec: number;
    clientX: number;
    slotIdx: number;
    intensity: number;
  } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const sizeRef = useRef<{ w: number; h: number; dpr: number }>({ w: 0, h: 0, dpr: 1 });
  const [sizeVersion, setSizeVersion] = useState(0);

  // --- ウィンドウタイトル更新 ---
  useEffect(() => {
    if (sourceSymbol) {
      getCurrentWindow()
        .setTitle(`タイムライン・ナビゲーター [${sourceSymbol}] - TickReplay`)
        .catch(console.warn);
    }
  }, [sourceSymbol]);

  // --- タイムゾーン同期 ---
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

  // --- 最前面トグル ---
  const toggleAlwaysOnTop = async () => {
    const next = !isAlwaysOnTop;
    setIsAlwaysOnTop(next);
    try {
      await invoke(COMMANDS.setAlwaysOnTop, { always: next });
    } catch (e) {
      console.warn("Failed to set always on top:", e);
    }
  };

  // --- ウィンドウ非表示 ---
  const handleClose = async () => {
    try {
      await invoke(COMMANDS.closeTimelineWindow);
    } catch {
      await getCurrentWindow().hide();
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

  // --- 再生 / 一時停止 ---
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

  // --- 精密ジャンプ ---
  const handleTimeJump = useCallback((seconds: number) => {
    sendCommand({
      command: "TIME_JUMP",
      delta_seconds: seconds,
    });
  }, [sendCommand]);

  // --- セッションジャンプ ---
  const handleSessionJump = useCallback((session: string) => {
    sendCommand({
      command: "SESSION_JUMP",
      session: session,
      direction: "NEXT",
    });
  }, [sendCommand]);

  // --- A-B ループ ---
  const handleSetLoopA = useCallback(() => {
    sendCommand({ command: "LOOP_SET_A" });
  }, [sendCommand]);

  const handleSetLoopB = useCallback(() => {
    sendCommand({ command: "LOOP_SET_B" });
  }, [sendCommand]);

  const handleClearLoop = useCallback(() => {
    sendCommand({ command: "LOOP_CLEAR" });
  }, [sendCommand]);

  // --- ステータス受信 ---
  useEffect(() => {
    invoke<PersistedSettings>(COMMANDS.loadSettings)
      .then((settings) => {
        if (settings) {
          if (settings.source_symbol) setSourceSymbol((prev) => prev || settings.source_symbol || "");
          if (settings.timezone_mode && !localStorage.getItem(STORAGE_KEYS.replayTimezoneMode)) {
            setTimezoneMode(settings.timezone_mode as "JST" | "SERVER");
          }
        }
      })
      .catch(console.warn);

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
      if (!windowVisible) return;
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
      try {
        const lastStatusStr = await invoke<string>(COMMANDS.getLastStatus);
        if (!disposed && lastStatusStr) {
          handleStatusPayload(lastStatusStr);
        }
      } catch (err) {
        console.warn("Failed to get initial status:", err);
      }

      const off = await listen<string>(EVENTS.mt5Status, (event) => {
        scheduleStatus(event.payload);
      });

      const offSettings = await listen(EVENTS.settingsUpdated, () => {
        lastActivityDateRef.current = "";
        setTimelineActivity(null);
      });

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
        setStatus((prev) => (prev !== nextStatus ? nextStatus : prev));
      }
      if (data.total_ticks !== undefined) {
        const total = data.total_ticks;
        setTotalTicks((prev) => (prev !== total ? total : prev));
      }
      if (data.current_idx !== undefined && !isDraggingCanvasRef.current) {
        const cur = data.current_idx;
        setCurrentIdx((prev) => (prev !== cur ? cur : prev));
      }
      if (data.virtual_time_msc !== undefined) {
        const vtime = data.virtual_time_msc;
        setVirtualTimeMsc((prev) => (prev !== vtime ? vtime : prev));
      }
      if (data.is_playing !== undefined) {
        const playing = data.is_playing;
        const guard = playStateGuardRef.current;
        if (guard && performance.now() < guard.expireAt) {
          if (playing === guard.expected) {
            playStateGuardRef.current = null;
            isPlayingRef.current = playing;
            setIsPlaying((prev) => (prev !== playing ? playing : prev));
          }
        } else {
          playStateGuardRef.current = null;
          isPlayingRef.current = playing;
          setIsPlaying((prev) => (prev !== playing ? playing : prev));
        }
      }
      if (data.speed_mode) {
        const mode = data.speed_mode as "TEMPORAL" | "COUNT";
        setSpeedMode((prev) => (prev !== mode ? mode : prev));
      }
      if (data.multiplier !== undefined) {
        const m = typeof data.multiplier === "number" ? data.multiplier : parseFloat(data.multiplier) || 1.0;
        setMultiplier((prev) => (prev !== m ? m : prev));
      }
      if (data.tick_step !== undefined) {
        const ts = typeof data.tick_step === "number" ? data.tick_step : parseInt(String(data.tick_step), 10) || 1;
        setTickStep((prev) => (prev !== ts ? ts : prev));
      }
      if (data.source_symbol) {
        const sym = data.source_symbol;
        setSourceSymbol((prev) => (prev !== sym ? sym : prev));
      }
      if (data.loop_active !== undefined) {
        const lActive = data.loop_active;
        setLoopActive((prev) => (prev !== lActive ? lActive : prev));
      }
      if (data.loop_a !== undefined) {
        const la = data.loop_a;
        setLoopA((prev) => (prev !== la ? la : prev));
      }
      if (data.loop_b !== undefined) {
        const lb = data.loop_b;
        setLoopB((prev) => (prev !== lb ? lb : prev));
      }
    } catch (e) {
      console.error("Error parsing mt5-status in timeline:", e);
    }
  };

  // --- タイムライン活動度 (波形) の取得 ---
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
          console.warn("Failed to fetch day timeline activity in navigator:", err);
        });
    }
  }, [virtualTimeMsc, timelineActivity]);

  // 当日秒数 (0..86400)
  const isServerDayMode = Boolean(timelineActivity && timelineActivity.day_start_msc > 0);
  const currentSecInDay = isServerDayMode
    ? Math.max(0, Math.min(86400, Math.floor((virtualTimeMsc - timelineActivity!.day_start_msc) / 1000)))
    : 0;
  const activeSec = dragSec !== null ? dragSec : currentSecInDay;

  // --- Canvas リサイズ検知 ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const updateSize = (width: number, height: number) => {
      const dpr = window.devicePixelRatio || 1;
      const pixelW = Math.round(width * dpr);
      const pixelH = Math.round(height * dpr);
      if (pixelW > 0 && pixelH > 0) {
        if (canvas.width !== pixelW || canvas.height !== pixelH) {
          canvas.width = pixelW;
          canvas.height = pixelH;
        }
        sizeRef.current = { w: width, h: height, dpr };
        setSizeVersion((v) => v + 1);
      }
    };

    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      updateSize(rect.width, rect.height);
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        updateSize(width, height);
      }
    });

    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  // --- Canvas 高解像度描画 ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { w, h, dpr } = sizeRef.current;
    if (w <= 0 || h <= 0) return;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const act = timelineActivity;
    const tyo = act?.tyo_start_sec || 6300;
    const ldn = act?.ldn_start_sec || 36000;
    const ny = act?.ny_start_sec || 54000;

    // 1. セッション背景カラー帯の描画
    const drawSessionZone = (startSec: number, endSec: number, fillColor: string, label: string, labelColor: string) => {
      const x1 = (startSec / 86400) * w;
      const x2 = (endSec / 86400) * w;
      const zoneW = Math.max(0, x2 - x1);
      ctx.fillStyle = fillColor;
      ctx.fillRect(x1, 0, zoneW, h);

      // 上部セッションラベル
      ctx.fillStyle = labelColor;
      ctx.font = "bold 10px monospace";
      ctx.fillText(label, x1 + 6, 14);
    };

    // 東京 (TYO: ~17:00 / 61200s)
    drawSessionZone(tyo, 61200, "rgba(29, 185, 84, 0.07)", "TOKYO (TYO)", "rgba(29, 185, 84, 0.8)");
    // ロンドン (LDN: 16:00 / 36000s ~ 24:00)
    drawSessionZone(ldn, 86400, "rgba(49, 130, 206, 0.07)", "LONDON (LDN)", "rgba(56, 189, 248, 0.8)");
    // ニューヨーク (NY: 21:00 / 54000s ~ 24:00)
    drawSessionZone(ny, 86400, "rgba(229, 62, 62, 0.08)", "NEW YORK (NY)", "rgba(248, 113, 113, 0.85)");

    // 2. 時間グリッドライン (3時間ごと: 03:00, 06:00, 09:00, 12:00, 15:00, 18:00, 21:00)
    ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    for (let hr = 3; hr < 24; hr += 3) {
      const gx = (hr / 24) * w;
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, h);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // 3. A-B ループ範囲ハイライト
    if (act && loopActive && loopA !== -1) {
      const loopASec = Math.max(0, Math.min(86400, (loopA - act.day_start_msc) / 1000));
      const loopBSec = loopB !== -1 ? Math.max(0, Math.min(86400, (loopB - act.day_start_msc) / 1000)) : 86400;
      const lx1 = (loopASec / 86400) * w;
      const lx2 = (loopBSec / 86400) * w;
      const lw = Math.max(2, lx2 - lx1);

      ctx.fillStyle = "rgba(16, 185, 129, 0.16)";
      ctx.fillRect(lx1, 0, lw, h);

      ctx.strokeStyle = "#10b981";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(lx1, 0);
      ctx.lineTo(lx1, h);
      if (loopB !== -1) {
        ctx.moveTo(lx2, 0);
        ctx.lineTo(lx2, h);
      }
      ctx.stroke();
    }

    const currentX = Math.max(0, Math.min(w, (activeSec / 86400) * w));

    // 4. ボラティリティ波形の描画
    if (act && act.slots_15m && act.slots_15m.length === 96) {
      const slots96 = act.slots_15m;
      const slot96W = w / 96;
      const chartTopMargin = 22; // 上部セッション名用の余白
      const chartHeight = h - chartTopMargin - 4;

      // 4. ボラティリティ波形の描画（15分刻み全96スロットを一貫して描画）
      for (let i = 0; i < 96; i++) {
        const xStart = i * slot96W;
        const xCenter = xStart + slot96W / 2;
        const intensity = slots96[i] || 0;
        const barH = Math.max(2, intensity * chartHeight);
        const yTop = h - 4 - barH;
        const barW = Math.max(1.5, slot96W - 2);

        const isPast = xCenter <= currentX;
        let color: string;
        if (isPast) {
          // 再生済み（過去）: 鮮やかな不透明バー
          if (intensity >= 0.7) color = "#f59e0b"; // 高活動: アンバー
          else if (intensity >= 0.35) color = "#38bdf8"; // 中活動: シアン
          else color = "rgba(148, 163, 184, 0.55)"; // 低活動: スレート
        } else {
          // 未再生（未来）: 落ち着いた半透明バー（ボラティリティの波形は完全に把握可能）
          if (intensity >= 0.7) color = "rgba(245, 158, 11, 0.45)";
          else if (intensity >= 0.35) color = "rgba(56, 189, 248, 0.40)";
          else color = "rgba(148, 163, 184, 0.20)";
        }

        ctx.fillStyle = color;
        ctx.fillRect(xStart + 1, yTop, barW, barH);
      }
    }

    // 5. 現在再生ヘッド (針: ネオンレッドで青・オレンジ・グレーの全バーから際立たせる)
    ctx.strokeStyle = "#f43f5e";
    ctx.lineWidth = 2;
    ctx.shadowColor = "rgba(244, 63, 94, 0.9)";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(currentX, 0);
    ctx.lineTo(currentX, h);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // 上部ヘッドピンマーカー
    ctx.fillStyle = "#f43f5e";
    ctx.beginPath();
    ctx.moveTo(currentX - 5, 0);
    ctx.lineTo(currentX + 5, 0);
    ctx.lineTo(currentX, 8);
    ctx.closePath();
    ctx.fill();

    // 下部ヘッドピンマーカー
    ctx.beginPath();
    ctx.moveTo(currentX - 5, h);
    ctx.lineTo(currentX + 5, h);
    ctx.lineTo(currentX, h - 8);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }, [timelineActivity, activeSec, loopActive, loopA, loopB, sizeVersion]);

  // --- Canvas マウス操作 (クリック・ドラッグによるシーク) ---
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isServerDayMode || !timelineActivity) return;
    isDraggingCanvasRef.current = true;
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const sec = Math.floor((relX / rect.width) * 86400);
    setDragSec(sec);
    sendSeekTimeCommand(timelineActivity.day_start_msc + sec * 1000, false);
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isServerDayMode || !timelineActivity) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const sec = Math.floor((relX / rect.width) * 86400);

    if (isDraggingCanvasRef.current) {
      setDragSec(sec);
      sendSeekTimeCommand(timelineActivity.day_start_msc + sec * 1000, false);
    }

    const slotIdx = Math.max(0, Math.min(95, Math.floor(sec / 900)));
    const intensity = timelineActivity.slots_15m[slotIdx] || 0;
    setHoverInfo({
      sec,
      clientX: relX,
      slotIdx,
      intensity,
    });
  };

  const handleCanvasMouseUp = () => {
    if (isDraggingCanvasRef.current) {
      isDraggingCanvasRef.current = false;
      if (dragSec !== null && isServerDayMode && timelineActivity) {
        sendSeekTimeCommand(timelineActivity.day_start_msc + dragSec * 1000, true);
        setDragSec(null);
      }
    }
  };

  const handleCanvasMouseLeave = () => {
    handleCanvasMouseUp();
    setHoverInfo(null);
  };

  // --- マウスホイールによるスクラブ微調整 ---
  const handleCanvasWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!isServerDayMode || !timelineActivity) return;

    let delta = e.deltaY < 0 ? 5 : -5; // 通常: ±5秒
    if (e.shiftKey) delta = e.deltaY < 0 ? 60 : -60; // Shift: ±1分
    else if (e.ctrlKey || e.metaKey) delta = e.deltaY < 0 ? 900 : -900; // Ctrl: ±15分

    handleTimeJump(delta);
  };

  // --- キーボード操作 ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.code === "Space") {
        e.preventDefault();
        if (!e.repeat) handlePlayPause();
      } else if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.code === "ArrowRight") {
        e.preventDefault();
        handleTimeJump(10);
      } else if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.code === "ArrowLeft") {
        e.preventDefault();
        handleTimeJump(-10);
      } else if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && e.code === "ArrowRight") {
        e.preventDefault();
        handleTimeJump(60);
      } else if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && e.code === "ArrowLeft") {
        e.preventDefault();
        handleTimeJump(-60);
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.code === "ArrowRight") {
        e.preventDefault();
        handleTimeJump(900);
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.code === "ArrowLeft") {
        e.preventDefault();
        handleTimeJump(-900);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handlePlayPause, handleTimeJump]);

  const progressPercent = totalTicks > 0 ? (currentIdx / totalTicks) * 100 : 0;
  const rawTimeStr =
    virtualTimeMsc > 0
      ? timezoneMode === "JST"
        ? formatJstTime(virtualTimeMsc)
        : formatServerTime(virtualTimeMsc)
      : "--:--:--";

  // ホバー用ツールチップ文字列生成
  const getHoverTimeStr = (sec: number) => {
    if (!timelineActivity || !timelineActivity.day_start_msc) {
      const h = Math.floor(sec / 3600).toString().padStart(2, "0");
      const m = Math.floor((sec % 3600) / 60).toString().padStart(2, "0");
      const s = Math.floor(sec % 60).toString().padStart(2, "0");
      return `${h}:${m}:${s}`;
    }
    const msc = timelineActivity.day_start_msc + sec * 1000;
    return timezoneMode === "JST"
      ? formatJstTime(msc).substring(11, 19)
      : formatServerTime(msc).substring(11, 19);
  };

  const getHoverSessionInfo = (sec: number) => {
    const act = timelineActivity;
    if (!act) return { name: "Asia", className: "asia" };
    if (sec >= act.ny_start_sec) return { name: "New York", className: "ny" };
    if (sec >= act.ldn_start_sec) return { name: "London", className: "ldn" };
    if (sec >= act.tyo_start_sec) return { name: "Tokyo", className: "tyo" };
    return { name: "Early Asia", className: "asia" };
  };

  return (
    <div className="timeline-window-root">
      {/* 1. 上部ヘッダーバー */}
      <header className="timeline-header">
        <div className="timeline-header-left">
          <span
            className={`ctrl-status-dot ${status.toLowerCase()}`}
            title={`接続状態: ${
              status === "ACTIVE"
                ? "リプレイ再生中"
                : status === "READY"
                ? "準備完了"
                : status === "CONNECTED"
                ? "接続完了"
                : "未接続"
            }`}
          />
          <div className="timeline-app-title">
            <span className="material-symbols-outlined title-icon">timeline</span>
            <span>タイムライン・ナビゲーター</span>
          </div>
          {sourceSymbol && <span className="timeline-symbol-badge font-data">{sourceSymbol}</span>}
          {timelineActivity?.date_str && (
            <span className="timeline-date-badge font-data">{timelineActivity.date_str}</span>
          )}
        </div>

        <div className="timeline-header-center">
          <div
            className="timeline-time-display font-data"
            onClick={() => {
              const next = timezoneMode === "JST" ? "SERVER" : "JST";
              setTimezoneMode(next);
              localStorage.setItem(STORAGE_KEYS.replayTimezoneMode, next);
            }}
            title="クリックでタイムゾーン切替 (JST / SERVER)"
          >
            <span className="tz-tag">{timezoneMode}</span>
            <span className="time-val">{rawTimeStr}</span>
          </div>
          <span className="timeline-progress-pill font-data">({progressPercent.toFixed(1)}%)</span>
        </div>

        <div className="timeline-header-right">
          {/* 最前面ピン留めボタン */}
          <button
            type="button"
            className={`timeline-header-icon-btn ${isAlwaysOnTop ? "active" : ""}`}
            onClick={toggleAlwaysOnTop}
            title={isAlwaysOnTop ? "最前面表示: ON (クリックで解除)" : "最前面表示: OFF (クリックで有効化)"}
          >
            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>push_pin</span>
          </button>

          {/* 閉じるボタン */}
          <button
            type="button"
            className="timeline-header-icon-btn close-btn"
            onClick={handleClose}
            title="タイムライン・ナビゲーターを閉じる"
          >
            <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>close</span>
          </button>
        </div>
      </header>

      {/* 2. メイン波形 & シークバー領域 (Canvas) */}
      <div
        ref={canvasContainerRef}
        className="timeline-canvas-container"
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={handleCanvasMouseUp}
        onMouseLeave={handleCanvasMouseLeave}
        onWheel={handleCanvasWheel}
      >
        <canvas ref={canvasRef} className="timeline-canvas" />

        {/* ホバー時インスペクターツールチップ */}
        {hoverInfo && (
          <div
            className="timeline-nav-tooltip font-data"
            style={{
              left: `${Math.max(80, Math.min((canvasContainerRef.current?.clientWidth || 800) - 80, hoverInfo.clientX))}px`,
            }}
          >
            <div className="tooltip-header">
              <span className={`session-badge ${getHoverSessionInfo(hoverInfo.sec).className}`}>
                {getHoverSessionInfo(hoverInfo.sec).name}
              </span>
              <span>{getHoverTimeStr(hoverInfo.sec)}</span>
            </div>
            <div className="tooltip-intensity">
              活動強度: <strong>{Math.round(hoverInfo.intensity * 100)}%</strong>
              {hoverInfo.sec > activeSec && <span style={{ marginLeft: "6px", color: "#64748b", fontSize: "10px" }}>(未再生)</span>}
            </div>
          </div>
        )}
      </div>

      {/* 時間目盛りルーラー行 */}
      <div className="timeline-ruler-row">
        <span>00:00</span>
        <span>03:00</span>
        <span>06:00</span>
        <span>09:00 (TYO)</span>
        <span>12:00</span>
        <span>15:00</span>
        <span>16:00 (LDN)</span>
        <span>18:00</span>
        <span>21:00 (NY)</span>
        <span>24:00</span>
      </div>

      {/* 3. 下部コントロールクラスター */}
      <div className="timeline-bottom-controls">
        {/* セッションジャンプ & A-B ループ */}
        <div className="timeline-meta-actions-row">
          <div className="timeline-session-jump-group">
            <span className="group-label">セッション:</span>
            <button
              className="btn-session-nav"
              onClick={() => handleSessionJump("TYO")}
              title="東京セッション (09:00) へジャンプ"
            >
              <span className="dot tyo" />
              <span>TYO 09:00</span>
            </button>
            <button
              className="btn-session-nav"
              onClick={() => handleSessionJump("LDN")}
              title="ロンドンセッション (16:00) へジャンプ"
            >
              <span className="dot ldn" />
              <span>LDN 16:00</span>
            </button>
            <button
              className="btn-session-nav"
              onClick={() => handleSessionJump("NY")}
              title="ニューヨークセッション (21:00) へジャンプ"
            >
              <span className="dot ny" />
              <span>NY 21:00</span>
            </button>
          </div>

          <div className="timeline-loop-group">
            {loopActive && <span className="loop-active-indicator font-data">LOOP ACTIVE</span>}
            <button
              className={`btn-timeline-loop ${loopA !== -1 ? "set" : ""}`}
              onClick={handleSetLoopA}
              title="現在位置をループ開始点 A にセット"
            >
              SET A
            </button>
            <button
              className={`btn-timeline-loop ${loopB !== -1 ? "set" : ""}`}
              onClick={handleSetLoopB}
              title="現在位置をループ終了点 B にセットしループ再生開始"
            >
              SET B
            </button>
            <button
              className="btn-timeline-loop-clear"
              onClick={handleClearLoop}
              title="A-Bループを解除"
            >
              CLEAR
            </button>
          </div>
        </div>

        {/* 精密シークステッパー & 再生/一時停止 */}
        <div className="timeline-stepper-row font-data">
          <div className="stepper-cluster-left">
            <button className="btn-stepper-step" onClick={() => handleTimeJump(-3600)} title="1時間戻る">-1h</button>
            <button className="btn-stepper-step" onClick={() => handleTimeJump(-900)} title="15分戻る">-15m</button>
            <button className="btn-stepper-step" onClick={() => handleTimeJump(-60)} title="1分戻る">-1m</button>
            <button className="btn-stepper-step" onClick={() => handleTimeJump(-10)} title="10秒戻る">-10s</button>
            <button className="btn-stepper-step" onClick={() => handleTimeJump(-1)} title="1秒戻る">-1s</button>
          </div>

          <button
            type="button"
            className={`btn-timeline-play ${isPlaying ? "playing" : "paused"}`}
            onClick={handlePlayPause}
            title={isPlaying ? "一時停止 (Space)" : "再生 (Space)"}
          >
            <span className="material-symbols-outlined icon">
              {isPlaying ? "pause" : "play_arrow"}
            </span>
          </button>

          <div className="stepper-cluster-right">
            <button className="btn-stepper-step" onClick={() => handleTimeJump(1)} title="1秒進む">+1s</button>
            <button className="btn-stepper-step" onClick={() => handleTimeJump(10)} title="10秒進む">+10s</button>
            <button className="btn-stepper-step" onClick={() => handleTimeJump(60)} title="1分進む">+1m</button>
            <button className="btn-stepper-step" onClick={() => handleTimeJump(900)} title="15分進む">+15m</button>
            <button className="btn-stepper-step" onClick={() => handleTimeJump(3600)} title="1時間進む">+1h</button>
          </div>
        </div>
      </div>
    </div>
  );
};
