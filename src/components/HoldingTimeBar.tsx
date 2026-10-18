import React, { useState, useEffect, memo } from "react";
import type { VirtualPosition } from "../types/trading";
import {
  calculatePositionElapsedTime,
  formatElapsedTime,
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

    const pressure = positions.length > 0 ? getHoldingPressure(elapsed) : null;

    return (
      <div
        className={`speed-holding-time-bar ${positions.length === 0 ? "inactive" : ""} ${pressure ?? ""}`}
        title="最も古いポジションの保有時間"
      >
        <span className="holding-time-label">
          <span className="material-symbols-outlined" aria-hidden="true">
            schedule
          </span>
          保有時間
          <span className="holding-time-mode">
            {holdingTimeMode === "pc" ? "PC" : "CHART"}
          </span>
        </span>
        <span className="holding-time-val font-data">
          {positions.length > 0 ? formatElapsedTime(elapsed) : "--"}
        </span>
      </div>
    );
  }
);

HoldingTimeBar.displayName = "HoldingTimeBar";
