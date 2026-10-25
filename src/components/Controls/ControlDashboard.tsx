import React, { useState } from "react";
import type { TimeStepItem, DayTimelineActivity } from "../../types/replay";
import { formatJstTime, formatServerTime } from "../../utils/timeUtils";
import { getSecondsIntoDay } from "../../domain/timeline";
import { MiniWaveformTrack } from "./MiniWaveformTrack";
import { TimelineInspectorTooltip } from "./TimelineInspectorTooltip";

interface ControlDashboardProps {
  speedMode: "TEMPORAL" | "COUNT";
  multiplier: number;
  tickStep: number;
  timePresets: number[];
  tickPresets: number[];
  updateSpeed: (mode: "TEMPORAL" | "COUNT", mult: number, step: number) => void;
  handlePlayPause: () => void;
  isPlaying: boolean;
  handleStep: (step: number) => void;
  handleCoarseSpeed: (up: boolean) => void;
  handleMediumSpeed: (up: boolean) => void;
  handleFineSpeed: (up: boolean) => void;
  setIsSpeedPresetsModalOpen: (val: boolean) => void;
  loopActive: boolean;
  loopA: number;
  loopB: number;
  loopAIdx: number;
  loopBIdx: number;
  handleSetLoopA: () => void;
  handleSetLoopB: () => void;
  handleClearLoop: () => void;
  totalTicks: number;
  currentIdx: number;
  setCurrentIdx: (val: number) => void;
  sendSeekCommand: (val: number, immediate?: boolean) => void;
  isDraggingRef: React.MutableRefObject<boolean>;
  progressPercent: number;
  timeSteps: TimeStepItem[];
  setIsTimeStepsModalOpen: (val: boolean) => void;
  handleSessionJump: (session: string, dir: "PREV" | "NEXT") => void;
  handleTimeJump: (sec: number) => void;
  getDayOffset: () => string;
  startTime: string;
  endTime: string;
  virtualTimeMsc: number;
  timezoneMode: "JST" | "SERVER";
  timelineActivity?: DayTimelineActivity | null;
  sendSeekTimeCommand?: (targetMsc: number, immediate?: boolean) => void;
  autoSkipFlat?: boolean;
  setAutoSkipFlat?: (val: boolean) => void;
  onOpenAutoSkipSettings?: () => void;
}

interface TransportControlsProps {
  speedMode: "TEMPORAL" | "COUNT";
  safeMultiplier: number;
  tickStep: number;
  timePresets: number[];
  tickPresets: number[];
  isPlaying: boolean;
  updateSpeed: (mode: "TEMPORAL" | "COUNT", mult: number, step: number) => void;
  handlePlayPause: () => void;
  handleStep: (step: number) => void;
  handleCoarseSpeed: (up: boolean) => void;
  handleMediumSpeed: (up: boolean) => void;
  handleFineSpeed: (up: boolean) => void;
  onOpenSpeedPresets: () => void;
  autoSkipFlat?: boolean;
  setAutoSkipFlat?: (val: boolean) => void;
  onOpenAutoSkipSettings?: () => void;
}

const TransportControls: React.FC<TransportControlsProps> = React.memo(({
  speedMode,
  safeMultiplier,
  tickStep,
  timePresets,
  tickPresets,
  isPlaying,
  updateSpeed,
  handlePlayPause,
  handleStep,
  handleCoarseSpeed,
  handleMediumSpeed,
  handleFineSpeed,
  onOpenSpeedPresets,
  autoSkipFlat,
  setAutoSkipFlat,
  onOpenAutoSkipSettings,
}) => {
  return (
    <>
      {/* 上部: 速度プリセットピルバー & モード切替 */}
      <div className="speed-header-row">
        <div className="speed-pills-scroll-track">
          {speedMode === "TEMPORAL"
            ? timePresets.map((preset) => {
                const label = `${preset}x`;
                const isActive = Math.abs(preset - safeMultiplier) < 0.01;
                return (
                  <button
                    key={preset}
                    className={`speed-pill-btn ${isActive ? "active" : ""}`}
                    onClick={() => updateSpeed("TEMPORAL", preset, tickStep)}
                  >
                    {label}
                  </button>
                );
              })
            : tickPresets.map((preset) => {
                const isActive = preset === tickStep;
                return (
                  <button
                    key={preset}
                    className={`speed-pill-btn ${isActive ? "active" : ""}`}
                    onClick={() => updateSpeed("COUNT", safeMultiplier, preset)}
                  >
                    {preset}T
                  </button>
                );
              })}
        </div>

        <div className="speed-actions-right">
          <button
            className="btn-text-icon"
            onClick={onOpenSpeedPresets}
            title="速度プリセットを編集"
          >
            <span className="material-symbols-outlined icon">tune</span>
          </button>
          <button
            className={`mode-badge-btn ${speedMode === "TEMPORAL" ? "time-mode" : "tick-mode"}`}
            onClick={() =>
              updateSpeed(speedMode === "TEMPORAL" ? "COUNT" : "TEMPORAL", safeMultiplier, tickStep)
            }
            title="速度モード切替 (時間基準 / ティック基準)"
          >
            {speedMode === "TEMPORAL" ? "TIME" : "TICK"}
          </button>
          {setAutoSkipFlat && (
            <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
              <button
                className={`mode-badge-btn auto-skip-badge-btn ${autoSkipFlat ? "active" : ""}`}
                onClick={() => setAutoSkipFlat(!autoSkipFlat)}
                title={autoSkipFlat ? "自動スキップ (早送り): ON (クリックでOFF)" : "自動スキップ (早送り): OFF (クリックでON)"}
              >
                <span className="material-symbols-outlined icon" style={{ fontSize: "13px", marginRight: "1px" }}>bolt</span>
                SKIP
              </button>
              {onOpenAutoSkipSettings && (
                <button
                  className="btn-text-icon"
                  onClick={onOpenAutoSkipSettings}
                  title="自動スキップ設定を編集"
                >
                  <span className="material-symbols-outlined icon">tune</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 中央: メイン操作クラスター (コマ戻し - 再生/一時停止 - コマ送り) + 精密ステッパー */}
      <div className="transport-main-cluster">
        {/* コマ戻し */}
        <button
          className="btn-step"
          onClick={() => handleStep(-1)}
          title="1ティック戻る (コマ送り)"
        >
          <span className="material-symbols-outlined icon">skip_previous</span>
          <span className="step-tag">1T</span>
        </button>

        {/* メイン再生/一時停止ボタン (大型・発光) */}
        <button
          className={`btn-play-master ${isPlaying ? "playing" : "paused"}`}
          onClick={handlePlayPause}
          title={isPlaying ? "一時停止 (Space)" : "再生 (Space)"}
        >
          <span className="material-symbols-outlined icon">
            {isPlaying ? "pause" : "play_arrow"}
          </span>
        </button>

        {/* コマ送り */}
        <button
          className="btn-step"
          onClick={() => handleStep(1)}
          title="1ティック進む (コマ送り)"
        >
          <span className="step-tag">1T</span>
          <span className="material-symbols-outlined icon">skip_next</span>
        </button>
      </div>

      {/* 速度精密ステッパーバー */}
      <div className="speed-stepper-bar">
        <button
          className="stepper-sub-btn"
          onClick={() => handleCoarseSpeed(false)}
          title="プリセット一段下げる"
        >
          &lt;&lt;
        </button>
        <button
          className="stepper-sub-btn"
          onClick={() => handleMediumSpeed(false)}
          title={speedMode === "TEMPORAL" ? "-1.0x" : "-10T"}
        >
          &lt;
        </button>
        <button
          className="stepper-sub-btn"
          onClick={() => handleFineSpeed(false)}
          title={speedMode === "TEMPORAL" ? "-0.1x" : "-1T"}
        >
          -
        </button>

        <div className="stepper-value-display font-data">
          {speedMode === "TEMPORAL" ? `${safeMultiplier.toFixed(1)}x` : `${tickStep}T`}
        </div>

        <button
          className="stepper-sub-btn"
          onClick={() => handleFineSpeed(true)}
          title={speedMode === "TEMPORAL" ? "+0.1x" : "+1T"}
        >
          +
        </button>
        <button
          className="stepper-sub-btn"
          onClick={() => handleMediumSpeed(true)}
          title={speedMode === "TEMPORAL" ? "+1.0x" : "+10T"}
        >
          &gt;
        </button>
        <button
          className="stepper-sub-btn"
          onClick={() => handleCoarseSpeed(true)}
          title="プリセット一段上げる"
        >
          &gt;&gt;
        </button>
      </div>
    </>
  );
});

interface JumpMatrixProps {
  timeSteps: TimeStepItem[];
  dayOffset: string;
  handleSessionJump: (session: string, dir: "PREV" | "NEXT") => void;
  handleTimeJump: (sec: number) => void;
  onOpenTimeSteps: () => void;
}

const JumpMatrix: React.FC<JumpMatrixProps> = React.memo(({
  timeSteps,
  dayOffset,
  handleSessionJump,
  handleTimeJump,
  onOpenTimeSteps,
}) => {
  return (
    <div className="control-card-compact jump-card">
      {/* セッションジャンプ行 */}
      <div className="session-jump-row">
        {/* 東京 */}
        <div className="session-jump-box tyo">
          <button
            className="jump-stepper-btn"
            onClick={() => handleSessionJump("TYO", "PREV")}
            title="前回の東京セッション (09:00)"
          >
            <span className="material-symbols-outlined icon">remove</span>
          </button>
          <button
            className="jump-session-name"
            onClick={() => handleSessionJump("TYO", "NEXT")}
            title="直近の東京セッションへ移動"
          >
            <span className="jump-dot tyo" />
            <span>TYO</span>
          </button>
          <button
            className="jump-stepper-btn"
            onClick={() => handleSessionJump("TYO", "NEXT")}
            title="次回の東京セッション (09:00)"
          >
            <span className="material-symbols-outlined icon">add</span>
          </button>
        </div>

        {/* ロンドン */}
        <div className="session-jump-box ldn">
          <button
            className="jump-stepper-btn"
            onClick={() => handleSessionJump("LDN", "PREV")}
            title="前回のロンドンセッション (16:00)"
          >
            <span className="material-symbols-outlined icon">remove</span>
          </button>
          <button
            className="jump-session-name"
            onClick={() => handleSessionJump("LDN", "NEXT")}
            title="直近のロンドンセッションへ移動"
          >
            <span className="jump-dot ldn" />
            <span>LDN</span>
          </button>
          <button
            className="jump-stepper-btn"
            onClick={() => handleSessionJump("LDN", "NEXT")}
            title="次回のロンドンセッション (16:00)"
          >
            <span className="material-symbols-outlined icon">add</span>
          </button>
        </div>

        {/* ニューヨーク */}
        <div className="session-jump-box ny">
          <button
            className="jump-stepper-btn"
            onClick={() => handleSessionJump("NY", "PREV")}
            title="前回のニューヨークセッション (21:00)"
          >
            <span className="material-symbols-outlined icon">remove</span>
          </button>
          <button
            className="jump-session-name"
            onClick={() => handleSessionJump("NY", "NEXT")}
            title="直近のニューヨークセッションへ移動"
          >
            <span className="jump-dot ny" />
            <span>NY</span>
          </button>
          <button
            className="jump-stepper-btn"
            onClick={() => handleSessionJump("NY", "NEXT")}
            title="次回のニューヨークセッション (21:00)"
          >
            <span className="material-symbols-outlined icon">add</span>
          </button>
        </div>
      </div>

      {/* 時間ジャンプグリッド */}
      <div className="time-jump-row">
        <div className="time-jump-scroll-track">
          {timeSteps.map((step) => (
            <div className="time-step-item" key={step.id}>
              <button
                className="time-step-arrow"
                onClick={() => handleTimeJump(-step.seconds)}
                title={`-${step.label}`}
              >
                <span className="material-symbols-outlined icon">remove</span>
              </button>
              <span className="time-step-label font-data">{step.label}</span>
              <button
                className="time-step-arrow"
                onClick={() => handleTimeJump(step.seconds)}
                title={`+${step.label}`}
              >
                <span className="material-symbols-outlined icon">add</span>
              </button>
            </div>
          ))}
        </div>

        {/* 日付ジャンプ・Step設定 */}
        <div className="date-jump-cluster">
          <button
            className="btn-date-arrow"
            onClick={() => handleSessionJump("ANY", "PREV")}
            title="前日へジャンプ"
          >
            <span className="material-symbols-outlined icon">chevron_left</span>
          </button>
          <span className="date-offset-badge font-data">{dayOffset}</span>
          <button
            className="btn-date-arrow"
            onClick={() => handleSessionJump("ANY", "NEXT")}
            title="翌日へジャンプ"
          >
            <span className="material-symbols-outlined icon">chevron_right</span>
          </button>
          <button
            className="btn-text-icon"
            onClick={onOpenTimeSteps}
            title="タイムステップを編集"
          >
            <span className="material-symbols-outlined icon">tune</span>
          </button>
        </div>
      </div>
    </div>
  );
});

interface LoopMatrixProps {
  loopActive: boolean;
  loopA: number;
  loopB: number;
  loopAIdx: number;
  loopBIdx: number;
  handleSetLoopA: () => void;
  handleSetLoopB: () => void;
  handleClearLoop: () => void;
}

const LoopMatrix: React.FC<LoopMatrixProps> = React.memo(({
  loopActive,
  loopA,
  loopB,
  loopAIdx,
  loopBIdx,
  handleSetLoopA,
  handleSetLoopB,
  handleClearLoop,
}) => {
  return (
    <div className="control-card-compact loop-card">
      <div className="loop-status-left">
        <span className="material-symbols-outlined loop-icon">all_inclusive</span>
        <span className="loop-title">A-B Loop</span>
        {loopActive && <span className="loop-active-badge">Active</span>}
        {loopAIdx !== -1 && (
          <span className="loop-points-text font-data">
            A: {loopAIdx.toLocaleString()} {loopBIdx !== -1 ? `⇄ B: ${loopBIdx.toLocaleString()}` : ""}
          </span>
        )}
      </div>

      <div className="loop-btn-cluster">
        <button
          className={`btn-loop ${loopA !== -1 ? "set" : ""}`}
          onClick={handleSetLoopA}
          title="現在の位置をループ開始点 A にセット"
        >
          SET A
        </button>
        <button
          className={`btn-loop ${loopB !== -1 ? "set" : ""}`}
          onClick={handleSetLoopB}
          title="現在の位置をループ終了点 B にセットしループ再生開始"
        >
          SET B
        </button>
        <button
          className="btn-loop-clear"
          onClick={handleClearLoop}
          title="A-Bループを解除"
        >
          <span className="material-symbols-outlined icon">sync_disabled</span>
          CLEAR
        </button>
      </div>
    </div>
  );
});

const ControlDashboardComponent: React.FC<ControlDashboardProps> = ({
  speedMode,
  multiplier,
  tickStep,
  timePresets,
  tickPresets,
  updateSpeed,
  handlePlayPause,
  isPlaying,
  handleStep,
  handleCoarseSpeed,
  handleMediumSpeed,
  handleFineSpeed,
  setIsSpeedPresetsModalOpen,
  loopActive,
  loopA,
  loopB,
  loopAIdx,
  loopBIdx,
  handleSetLoopA,
  handleSetLoopB,
  handleClearLoop,
  totalTicks,
  currentIdx,
  setCurrentIdx,
  sendSeekCommand,
  isDraggingRef,
  progressPercent,
  timeSteps,
  setIsTimeStepsModalOpen,
  handleSessionJump,
  handleTimeJump,
  getDayOffset,
  startTime: _startTime,
  endTime: _endTime,
  virtualTimeMsc,
  timezoneMode,
  timelineActivity,
  sendSeekTimeCommand,
  autoSkipFlat,
  setAutoSkipFlat,
  onOpenAutoSkipSettings,
}) => {
  const safeMultiplier = typeof multiplier === "number" ? multiplier : parseFloat(String(multiplier)) || 1.0;
  const [dragSec, setDragSec] = useState<number | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{
    sec: number;
    clientX: number;
    trackWidth: number;
  } | null>(null);

  const handleOpenSpeedPresets = React.useCallback(() => {
    setIsSpeedPresetsModalOpen(true);
  }, [setIsSpeedPresetsModalOpen]);

  const handleOpenTimeSteps = React.useCallback(() => {
    setIsTimeStepsModalOpen(true);
  }, [setIsTimeStepsModalOpen]);

  // サーバー日の当日秒数 (0..86400)
  const isServerDayMode = Boolean(timelineActivity && timelineActivity.day_start_msc > 0);
  const currentSecInDay = isServerDayMode
    ? getSecondsIntoDay(virtualTimeMsc, timelineActivity!.day_start_msc)
    : 0;

  const handleTrackMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isServerDayMode || !timelineActivity) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const sec = Math.floor((relX / rect.width) * 86400);
    setHoverInfo({
      sec,
      clientX: relX,
      trackWidth: rect.width,
    });
  };

  const handleTrackMouseLeave = () => {
    setHoverInfo(null);
  };

  return (
    <div className="controls-container-compact">
      {/* 1. トランスポート (再生コントロール & 速度) */}
      <div className="control-card-compact transport-card">
        <TransportControls
          speedMode={speedMode}
          safeMultiplier={safeMultiplier}
          tickStep={tickStep}
          timePresets={timePresets}
          tickPresets={tickPresets}
          isPlaying={isPlaying}
          updateSpeed={updateSpeed}
          handlePlayPause={handlePlayPause}
          handleStep={handleStep}
          handleCoarseSpeed={handleCoarseSpeed}
          handleMediumSpeed={handleMediumSpeed}
          handleFineSpeed={handleFineSpeed}
          onOpenSpeedPresets={handleOpenSpeedPresets}
          autoSkipFlat={autoSkipFlat}
          setAutoSkipFlat={setAutoSkipFlat}
          onOpenAutoSkipSettings={onOpenAutoSkipSettings}
        />

        {/* タイムラインシーカー */}
        <div className="timeline-seeker-block">
          <div
            className="seeker-track-wrapper"
            style={{ position: "relative" }}
            onMouseMove={handleTrackMouseMove}
            onMouseLeave={handleTrackMouseLeave}
          >
            {isServerDayMode && hoverInfo && timelineActivity && (
              <TimelineInspectorTooltip
                sec={hoverInfo.sec}
                clientX={hoverInfo.clientX}
                trackWidth={hoverInfo.trackWidth}
                activity={timelineActivity}
                currentSecInDay={dragSec !== null ? dragSec : currentSecInDay}
                timezoneMode={timezoneMode}
              />
            )}
            {isServerDayMode && (
              <MiniWaveformTrack
                activity={timelineActivity || null}
                currentSecInDay={dragSec !== null ? dragSec : currentSecInDay}
              />
            )}
            <input
              type="range"
              min={0}
              max={isServerDayMode ? 86400 : (totalTicks > 0 ? totalTicks : 100)}
              value={isServerDayMode ? (dragSec !== null ? dragSec : currentSecInDay) : currentIdx}
              onMouseDown={() => {
                isDraggingRef.current = true;
              }}
              onTouchStart={() => {
                isDraggingRef.current = true;
              }}
              onMouseUp={(e) => {
                isDraggingRef.current = false;
                const val = parseInt((e.target as HTMLInputElement).value);
                if (!isNaN(val)) {
                  if (isServerDayMode && sendSeekTimeCommand && timelineActivity) {
                    setDragSec(null);
                    sendSeekTimeCommand(timelineActivity.day_start_msc + val * 1000, true);
                  } else {
                    sendSeekCommand(val, true);
                  }
                }
              }}
              onTouchEnd={(e) => {
                isDraggingRef.current = false;
                const val = parseInt((e.target as HTMLInputElement).value);
                if (!isNaN(val)) {
                  if (isServerDayMode && sendSeekTimeCommand && timelineActivity) {
                    setDragSec(null);
                    sendSeekTimeCommand(timelineActivity.day_start_msc + val * 1000, true);
                  } else {
                    sendSeekCommand(val, true);
                  }
                }
              }}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                if (isServerDayMode && sendSeekTimeCommand && timelineActivity) {
                  setDragSec(val);
                  sendSeekTimeCommand(timelineActivity.day_start_msc + val * 1000, false);
                } else {
                  setCurrentIdx(val);
                  sendSeekCommand(val);
                }
              }}
              className="seeker-slider-compact"
            />
          </div>

          <div className="seeker-labels-row font-data">
            <div className="seeker-label-side-group">
              <button
                type="button"
                className="btn-seeker-day-step"
                onClick={() => handleSessionJump("ANY", "PREV")}
                title="前日へジャンプ"
              >
                <span className="material-symbols-outlined icon">chevron_left</span>
              </button>
              <span className="seeker-time-start">00:00</span>
            </div>

            <div className="seeker-current-info">
              {timelineActivity?.date_str ? (
                <span className="seeker-current-date-badge">{timelineActivity.date_str}</span>
              ) : null}
              <span className="current-time-accent">
                {timezoneMode === "JST"
                  ? formatJstTime(virtualTimeMsc).substring(11, 19)
                  : formatServerTime(virtualTimeMsc).substring(11, 19)}
              </span>
              <span className="current-percent">({progressPercent.toFixed(1)}%)</span>
            </div>

            <div className="seeker-label-side-group">
              <span className="seeker-time-end">24:00</span>
              <button
                type="button"
                className="btn-seeker-day-step"
                onClick={() => handleSessionJump("ANY", "NEXT")}
                title="翌日へジャンプ"
              >
                <span className="material-symbols-outlined icon">chevron_right</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 2. セッション & 時間ジャンプ マトリクス */}
      <JumpMatrix
        timeSteps={timeSteps}
        dayOffset={getDayOffset()}
        handleSessionJump={handleSessionJump}
        handleTimeJump={handleTimeJump}
        onOpenTimeSteps={handleOpenTimeSteps}
      />

      {/* 3. A-B ループコントロール */}
      <LoopMatrix
        loopActive={loopActive}
        loopA={loopA}
        loopB={loopB}
        loopAIdx={loopAIdx}
        loopBIdx={loopBIdx}
        handleSetLoopA={handleSetLoopA}
        handleSetLoopB={handleSetLoopB}
        handleClearLoop={handleClearLoop}
      />
    </div>
  );
};

export const ControlDashboard = React.memo(ControlDashboardComponent);

