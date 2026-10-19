import React, { useState, useEffect, memo } from "react";
import type { TimeStopMode, VirtualPosition } from "../types/trading";
import {
  calculatePositionElapsedTime,
  calculateRemainingRatio,
  formatElapsedTime,
  formatHoldingTimeWithLimit,
  getHoldingPressure,
  type StopwatchItem,
} from "../domain/holdingTime";

export interface HoldingTimeBarProps {
  showHoldingTime: boolean;
  positions: VirtualPosition[];
  holdingTimeMode: "pc" | "server";
  isPlaying: boolean;
  virtualTimeMsc: number;
  virtualTimeMscRef: React.MutableRefObject<number>;
  stopwatchStateRef: React.MutableRefObject<Record<string, StopwatchItem>>;
  limitSeconds?: number;
  timeStopEnabled?: boolean;
  timeStopMode?: TimeStopMode;
  onToggleTimeStop?: () => void;
}

export const HoldingTimeBar: React.FC<HoldingTimeBarProps> = memo(
  ({
    showHoldingTime,
    positions,
    holdingTimeMode,
    isPlaying,
    virtualTimeMsc,
    virtualTimeMscRef,
    stopwatchStateRef,
    limitSeconds = 0,
    timeStopEnabled = false,
    timeStopMode = "loss_only",
    onToggleTimeStop,
  }) => {
    // 50ms (秒間20fps) でタイマーを更新。
    // 親コンポーネント全体を巻き込まず、このバー内部のみが再描画される。
    const [, setTrigger] = useState(0);

    useEffect(() => {
      if (!showHoldingTime || positions.length === 0 || !isPlaying) {
        return;
      }
      const interval = setInterval(() => {
        setTrigger((t) => t + 1);
      }, 50);
      return () => clearInterval(interval);
    }, [showHoldingTime, positions.length, isPlaying]);

    if (!showHoldingTime) return null;

    const currentVirtualTime = virtualTimeMscRef.current || virtualTimeMsc;
    const elapsed =
      positions.length > 0
        ? calculatePositionElapsedTime(
            positions,
            holdingTimeMode,
            currentVirtualTime,
            stopwatchStateRef.current,
            Date.now()
          )
        : 0;

    const pressure = positions.length > 0 ? getHoldingPressure(elapsed, limitSeconds) : null;
    const remainingRatio =
      positions.length > 0 && limitSeconds > 0
        ? calculateRemainingRatio(elapsed, limitSeconds)
        : 1.0;

    const formattedValue =
      positions.length > 0
        ? limitSeconds > 0
          ? formatHoldingTimeWithLimit(elapsed, limitSeconds)
          : formatElapsedTime(elapsed)
        : "--";

    const titleText =
      positions.length > 0
        ? `最古ポジション保有時間${limitSeconds > 0 ? ` (制限: ${limitSeconds}秒)` : ""}${
            timeStopEnabled
              ? ` [自動決済: ${timeStopMode === "loss_only" ? "含み損/同値のみ撤退" : "無条件撤退"}]`
              : ""
          }`
        : "最古ポジションの保有時間";

    return (
      <div
        className={`speed-holding-time-bar ${positions.length === 0 ? "inactive" : ""} ${pressure ?? ""}`}
        title={titleText}
      >
        {/* 残り時間カウントダウンプログレスバー */}
        {positions.length > 0 && limitSeconds > 0 && (
          <div
            className="holding-time-progress-bar"
            style={{ width: `${Math.max(0, Math.min(100, remainingRatio * 100))}%` }}
          />
        )}

        <span className="holding-time-label">
          <span className="material-symbols-outlined" aria-hidden="true">
            schedule
          </span>
          保有時間
          {onToggleTimeStop && (
            <button
              type="button"
              className={`holding-time-autoclose-btn ${timeStopEnabled ? "active" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggleTimeStop();
              }}
              title={`クリックで自動決済のON/OFF切替 (${
                timeStopEnabled
                  ? `現在: 有効 [${timeStopMode === "loss_only" ? "含み損/同値撤退" : "無条件撤退"}]`
                  : "現在: 無効"
              })`}
            >
              自動決済: {timeStopEnabled ? "ON" : "OFF"}
            </button>
          )}
        </span>
        <span className="holding-time-val font-data">
          {formattedValue}
        </span>
      </div>
    );
  }
);

HoldingTimeBar.displayName = "HoldingTimeBar";
