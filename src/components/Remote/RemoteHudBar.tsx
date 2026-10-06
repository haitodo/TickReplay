import React from "react";
import { COMMANDS } from "../../constants/commands";
import { invoke } from "@tauri-apps/api/core";
import { formatJstTime, formatServerTime, getNewsTimeForDisplay } from "../../utils/timeUtils";

interface RemoteHudBarProps {
  handleDragStart: (e: React.MouseEvent) => void;
  timezoneMode: "JST" | "SERVER";
  virtualTimeMsc: number;
  getDayOfWeekStr: (msc: number, isJst: boolean) => string;
  handleSessionJump: (session: string, dir: "PREV" | "NEXT") => void;
  handleTimeJump: (sec: number) => void;
  handleStep: (step: number) => void;
  handlePlayPause: () => void;
  isPlaying: boolean;
  updateSpeed: (mode: "TEMPORAL" | "COUNT", mult: number, step: number) => void;
  speedMode: "TEMPORAL" | "COUNT";
  multiplier: number;
  tickStep: number;
  renderMiniSessionTrack: () => React.ReactNode;
  totalTicks: number;
  currentIdx: number;
  setCurrentIdx: (val: number) => void;
  sendSeekCommand: (val: number) => void;
  startTime: string;
  endTime: string;
  isShortcutsActive: boolean;
  handleShortcutsToggle: () => void;
  alwaysOnTop: boolean;
  handleAlwaysOnTopToggle: () => void;
  handleTerminate: () => void;
  toggleRemoteMode: (val: boolean) => void;
}

export const RemoteHudBar: React.FC<RemoteHudBarProps> = ({
  handleDragStart,
  timezoneMode,
  virtualTimeMsc,
  getDayOfWeekStr,
  handleSessionJump,
  handleTimeJump,
  handleStep,
  handlePlayPause,
  isPlaying,
  updateSpeed,
  speedMode,
  multiplier,
  tickStep,
  renderMiniSessionTrack,
  totalTicks,
  currentIdx,
  setCurrentIdx,
  sendSeekCommand,
  startTime,
  endTime,
  isShortcutsActive,
  handleShortcutsToggle,
  alwaysOnTop,
  handleAlwaysOnTopToggle,
  handleTerminate,
  toggleRemoteMode,
}) => {
  const safeMultiplier = typeof multiplier === "number" ? multiplier : parseFloat(String(multiplier)) || 1.0;

  return (
    <div className="remote-wrapper relative" data-tauri-drag-region>
      {/* ドラッグ移動用のつまみ（最左端） */}
      <div
        className="remote-grip select-none"
        onMouseDown={handleDragStart}
        data-tauri-drag-region
        title="ドラッグして移動"
      >
        <span className="material-symbols-outlined text-[16px] pointer-events-none" data-tauri-drag-region>
          drag_indicator
        </span>
      </div>

      {/* 左側：ステータス＆時刻表示HUD */}
      <div className="remote-hud" onMouseDown={handleDragStart} data-tauri-drag-region>
        <div className="remote-hud-dot" title="EA接続ステータス" />
        <div className="remote-segment select-none" data-tauri-drag-region>
          <span className="remote-segment-time" data-tauri-drag-region>
            {timezoneMode === "JST"
              ? formatJstTime(virtualTimeMsc).substring(11, 19)
              : formatServerTime(virtualTimeMsc).substring(11, 19)}
          </span>
          <span className="remote-segment-date" data-tauri-drag-region>
            {timezoneMode === "JST"
              ? `${formatJstTime(virtualTimeMsc).substring(0, 10).replace(/-/g, ".")} ${getDayOfWeekStr(virtualTimeMsc, true)}`
              : `${formatServerTime(virtualTimeMsc).substring(0, 10).replace(/-/g, ".")} ${getDayOfWeekStr(virtualTimeMsc, false)}`}
          </span>
        </div>
      </div>

      {/* Center: High-Density Controls & Timeline */}
      <div className="remote-controls-center">
        {/* Session Jumps */}
        <div className="remote-session-group">
          <div className="remote-session-block border-r">
            <span className="remote-session-label tyo select-none">TYO</span>
            <button
              className="remote-btn-tactile"
              onClick={() => handleSessionJump("TYO", "PREV")}
              title="東京セッション 前日へ"
              style={{ marginRight: "2px" }}
            >
              <span className="material-symbols-outlined text-[14px]">remove</span>
            </button>
            <button
              className="remote-btn-tactile"
              onClick={() => handleSessionJump("TYO", "NEXT")}
              title="東京セッション 翌日へ"
            >
              <span className="material-symbols-outlined text-[14px]">add</span>
            </button>
          </div>
          <div className="remote-session-block border-r">
            <span className="remote-session-label ldn select-none">LDN</span>
            <button
              className="remote-btn-tactile"
              onClick={() => handleSessionJump("LDN", "PREV")}
              title="ロンドンセッション 前日へ"
              style={{ marginRight: "2px" }}
            >
              <span className="material-symbols-outlined text-[14px]">remove</span>
            </button>
            <button
              className="remote-btn-tactile"
              onClick={() => handleSessionJump("LDN", "NEXT")}
              title="ロンドンセッション 翌日へ"
            >
              <span className="material-symbols-outlined text-[14px]">add</span>
            </button>
          </div>
          <div className="remote-session-block">
            <span className="remote-session-label ny select-none">NY</span>
            <button
              className="remote-btn-tactile"
              onClick={() => handleSessionJump("NY", "PREV")}
              title="ニューヨークセッション 前日へ"
              style={{ marginRight: "2px" }}
            >
              <span className="material-symbols-outlined text-[14px]">remove</span>
            </button>
            <button
              className="remote-btn-tactile"
              onClick={() => handleSessionJump("NY", "NEXT")}
              title="ニューヨークセッション 翌日へ"
            >
              <span className="material-symbols-outlined text-[14px]">add</span>
            </button>
          </div>
        </div>

        {/* Time Jumps */}
        <div className="remote-time-group">
          <button className="remote-btn-time" onClick={() => handleTimeJump(-60)} title="1分戻る">
            -1M
          </button>
          <button className="remote-btn-time" onClick={() => handleTimeJump(60)} title="1分進む">
            +1M
          </button>
          <div className="remote-divider-v" />
          <button className="remote-btn-time" onClick={() => handleTimeJump(-600)} title="10分戻る">
            -10M
          </button>
          <button className="remote-btn-time" onClick={() => handleTimeJump(600)} title="10分進む">
            +10M
          </button>
        </div>

        {/* Playback Cluster */}
        <div className="remote-playback-group">
          <button className="remote-btn-playback" onClick={() => handleStep(-1)} title="1コマ(1ティック)戻る">
            <span className="material-symbols-outlined text-[15px]" style={{ fontVariationSettings: "'FILL' 1" }}>
              skip_previous
            </span>
          </button>
          <button
            className={`remote-btn-playback-primary ${isPlaying ? "active-play" : ""}`}
            onClick={handlePlayPause}
            title={isPlaying ? "一時停止" : "再生"}
          >
            <span className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: "'FILL' 1", color: "var(--on-primary)" }}>
              {isPlaying ? "pause" : "play_arrow"}
            </span>
          </button>
          <button className="remote-btn-playback" onClick={() => handleStep(1)} title="1コマ(1ティック)進む">
            <span className="material-symbols-outlined text-[15px]" style={{ fontVariationSettings: "'FILL' 1" }}>
              skip_next
            </span>
          </button>
        </div>

        {/* Speed Toggle */}
        <button
          className="remote-speed-btn"
          onClick={() => updateSpeed(speedMode === "TEMPORAL" ? "COUNT" : "TEMPORAL", safeMultiplier, tickStep)}
          title="再生速度モード切替 (時間基準 / ティック数基準)"
        >
          {speedMode === "TEMPORAL" ? `${safeMultiplier.toFixed(1)}x` : `${tickStep}T`}
        </button>
      </div>

      {/* Right: Mini Timeline */}
      <div className="remote-timeline-container">
        <div className="remote-timeline-track-bg">{renderMiniSessionTrack()}</div>
        <div className="remote-slider-wrapper">
          <input
            className="remote-slider-el"
            max={totalTicks}
            min={0}
            type="range"
            value={currentIdx}
            onChange={(e) => {
              const val = parseInt(e.target.value);
              setCurrentIdx(val);
              sendSeekCommand(val);
            }}
            title={`Tick Progress: ${currentIdx} / ${totalTicks}`}
          />
        </div>
        <div className="remote-timeline-labels select-none">
          <span className="remote-timeline-text">
            {startTime
              ? (timezoneMode === "JST" ? startTime : getNewsTimeForDisplay(startTime, "SERVER")).substring(11, 16)
              : "00:00"}
          </span>
          <span className="remote-timeline-text active">
            {timezoneMode === "JST"
              ? formatJstTime(virtualTimeMsc).substring(11, 16)
              : formatServerTime(virtualTimeMsc).substring(11, 16)}
          </span>
          <span className="remote-timeline-text">
            {endTime
              ? (timezoneMode === "JST" ? endTime : getNewsTimeForDisplay(endTime, "SERVER")).substring(11, 16)
              : "24:00"}
          </span>
        </div>
      </div>

      {/* Far Right: Utility actions */}
      <div className="remote-utilities">
        <button
          className="remote-btn-utility"
          onClick={() => invoke(COMMANDS.openTracelyApp).catch(console.error)}
          title="トレード分析 (Tracely) を起動"
        >
          <span className="material-symbols-outlined text-[14px] text-indigo">analytics</span>
        </button>
        <button
          className={`remote-btn-utility ${isShortcutsActive ? "active-green" : ""}`}
          onClick={handleShortcutsToggle}
          title="Global Hotkeys Toggle"
        >
          <span className="material-symbols-outlined text-[14px]">keyboard</span>
        </button>
        <button
          className={`remote-btn-utility ${alwaysOnTop ? "active-green" : ""}`}
          onClick={handleAlwaysOnTopToggle}
          title="Always on Top Toggle"
        >
          <span className="material-symbols-outlined text-[14px]">push_pin</span>
        </button>
        <button className="remote-btn-utility danger" onClick={handleTerminate} title="Terminate Replay">
          <span className="material-symbols-outlined text-[14px]">power_settings_new</span>
        </button>
        <button className="remote-btn-utility exit" onClick={() => toggleRemoteMode(false)} title="通常画面に戻る">
          <span className="material-symbols-outlined text-[14px]">desktop_windows</span>
        </button>
      </div>
    </div>
  );
};
