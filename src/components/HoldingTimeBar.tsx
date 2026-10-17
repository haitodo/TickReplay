import React, { useState, useEffect, memo } from "react";
import type { VirtualPosition } from "../types/trading";
import {
  calculatePositionElapsedTime,
  formatElapsedTime,
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
    if (!showHoldingTime) return null;

    // 50ms (秒間20fps) でタイマーを更新。
    // 親コンポーネント全体を巻き込まず、このバー内部のみが再描画される。
    const [_, setTrigger] = useState(0);

    useEffect(() => {
      if (positions.length === 0 || !isPlaying) {
        return;
      }
      const interval = setInterval(() => {
        setTrigger((t) => t + 1);
      }, 50);
      return () => clearInterval(interval);
    }, [positions.length, isPlaying]);

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

    return (
      <div className={`speed-holding-time-bar ${positions.length === 0 ? "inactive" : ""}`}>
        <span className="holding-time-label">
          <span
            className="material-symbols-outlined"
            style={{ fontSize: "12px", verticalAlign: "middle" }}
          >
            schedule
          </span>
          最古ポジション保有時間 ({holdingTimeMode === "pc" ? "PC" : "Chart"})
        </span>
        <span className="holding-time-val font-data">
          {positions.length > 0 ? formatElapsedTime(elapsed) : "--"}
        </span>
      </div>
    );
  }
);

HoldingTimeBar.displayName = "HoldingTimeBar";
