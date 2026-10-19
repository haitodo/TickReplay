import React from "react";
import type { DayTimelineActivity } from "../../types/replay";
import { formatJstTime, formatServerTime } from "../../utils/timeUtils";

interface TimelineInspectorTooltipProps {
  sec: number;
  clientX: number;
  trackWidth: number;
  activity: DayTimelineActivity;
  currentSecInDay: number;
  timezoneMode: "JST" | "SERVER";
}

export const TimelineInspectorTooltip: React.FC<TimelineInspectorTooltipProps> = React.memo(({
  sec,
  clientX,
  trackWidth,
  activity,
  currentSecInDay,
  timezoneMode,
}) => {
  const slot15Idx = Math.max(0, Math.min(95, Math.floor(sec / 900)));
  const isPast = sec <= currentSecInDay;

  // 15分スロットの時刻範囲フォールバック (秒計算)
  const formatTimeSlotFallback = (startSec: number, endSec: number) => {
    const sH = Math.floor(startSec / 3600).toString().padStart(2, "0");
    const sM = Math.floor((startSec % 3600) / 60).toString().padStart(2, "0");
    const eH = Math.floor(endSec / 3600).toString().padStart(2, "0");
    const eM = Math.floor((endSec % 3600) / 60).toString().padStart(2, "0");
    return `${sH}:${sM} - ${eH}:${eM}`;
  };

  // timezoneMode (JST または SERVER) に応じた時刻スロット文字列生成
  const getTimeSlotStr = () => {
    if (!activity.day_start_msc) {
      return formatTimeSlotFallback(slot15Idx * 900, Math.min(86400, (slot15Idx + 1) * 900));
    }
    const startMsc = activity.day_start_msc + slot15Idx * 900 * 1000;
    const endMsc = activity.day_start_msc + Math.min(86400, (slot15Idx + 1) * 900) * 1000;

    if (timezoneMode === "JST") {
      const s = formatJstTime(startMsc).substring(11, 16);
      const e = formatJstTime(endMsc).substring(11, 16);
      return `${s} - ${e}`;
    } else {
      const s = formatServerTime(startMsc).substring(11, 16);
      const e = slot15Idx === 95 ? "24:00" : formatServerTime(endMsc).substring(11, 16);
      return `${s} - ${e}`;
    }
  };

  const timeSlotStr = getTimeSlotStr();

  // 所属セッション判定
  const tyo = activity.tyo_start_sec;
  const ldn = activity.ldn_start_sec;
  const ny = activity.ny_start_sec;
  let sessionName = "Early Asia";
  let sessionClass = "asia";

  if (sec >= ny) {
    sessionName = "New York";
    sessionClass = "ny";
  } else if (sec >= ldn) {
    sessionName = "London";
    sessionClass = "ldn";
  } else if (sec >= tyo) {
    sessionName = "Tokyo";
    sessionClass = "tyo";
  }

  // ルーペ（前後4スロットの拡大ミニグラフ: 計9本 / 約2時間15分分）
  const startSlot = Math.max(0, slot15Idx - 4);
  const endSlot = Math.min(95, slot15Idx + 4);
  const rangeStartSec = startSlot * 900;
  const rangeEndSec = (endSlot + 1) * 900;
  const rangeDuration = rangeEndSec - rangeStartSec;

  // 現在再生位置（playhead）がルーペ内にあるかどうかの判定と位置計算
  const isPlayheadInLoupe = currentSecInDay >= rangeStartSec && currentSecInDay <= rangeEndSec;
  const playheadPercent = isPlayheadInLoupe && rangeDuration > 0
    ? ((currentSecInDay - rangeStartSec) / rangeDuration) * 100
    : 0;
  const playingSlotIdx = Math.floor(currentSecInDay / 900);

  const zoomSlots: { idx: number; intensity: number; isHoverTarget: boolean; isPlayingSlot: boolean }[] = [];
  for (let i = startSlot; i <= endSlot; i++) {
    zoomSlots.push({
      idx: i,
      intensity: activity.slots_15m[i] || 0,
      isHoverTarget: i === slot15Idx,
      isPlayingSlot: i === playingSlotIdx,
    });
  }

  // ホバー時刻と現在再生時刻の差分（分単位）
  const deltaSec = sec - currentSecInDay;
  const deltaMin = Math.round(Math.abs(deltaSec) / 60);
  const isNearCurrent = Math.abs(deltaSec) < 30;

  // ポップアップが画面端で見切れないようにX座標をクランプ
  const tooltipLeft = Math.max(110, Math.min(trackWidth - 110, clientX));

  return (
    <div
      className="seeker-inspector-tooltip"
      style={{
        left: `${tooltipLeft}px`,
      }}
    >
      {/* 上部: 時刻 ＆ セッションタグ ＆ 現在地との時間差 */}
      <div className="inspector-header">
        <span className={`inspector-session-badge ${sessionClass}`}>
          {sessionName}
        </span>
        <span className="inspector-time font-data">
          {timeSlotStr} <span className="inspector-tz-tag">{timezoneMode}</span>
          {isNearCurrent ? (
            <span className="inspector-delta-tag now">NOW</span>
          ) : deltaSec > 0 ? (
            <span className="inspector-delta-tag">+{deltaMin}m</span>
          ) : (
            <span className="inspector-delta-tag">-{deltaMin}m</span>
          )}
        </span>
      </div>

      {/* 中央: ルーペ（拡大ミニ波形: 前後4スロットの15分足バー ＆ リアルタイム再生針） */}
      <div className="inspector-loupe-area">
        <div className="inspector-bars-track">
          {/* 現在再生針 (Playhead Needle) */}
          {isPlayheadInLoupe && (
            <div
              className="inspector-playhead-line"
              style={{ left: `${playheadPercent}%` }}
              title="現在再生位置"
            >
              <div className="inspector-playhead-pin" />
              <div className="inspector-playhead-dot" />
            </div>
          )}

          {zoomSlots.map((slot) => {
            const barH = Math.max(3, Math.round(slot.intensity * 38));
            const slotIsPast = (slot.idx + 0.5) * 900 <= currentSecInDay;
            let color = slotIsPast ? "rgba(148, 163, 184, 0.55)" : "rgba(148, 163, 184, 0.35)";
            if (slot.intensity >= 0.7) {
              color = slotIsPast ? "#f59e0b" : "rgba(245, 158, 11, 0.55)";
            } else if (slot.intensity >= 0.35) {
              color = slotIsPast ? "#38bdf8" : "rgba(56, 189, 248, 0.50)";
            }

            const colClass = [
              "inspector-bar-col",
              slot.isHoverTarget ? "hover-target" : "",
              slot.isPlayingSlot ? "playing-slot" : "",
            ].filter(Boolean).join(" ");

            return (
              <div
                key={slot.idx}
                className={colClass}
                title={slot.isPlayingSlot ? "再生中スロット" : undefined}
              >
                <div
                  className="inspector-bar-fill"
                  style={{
                    height: `${barH}px`,
                    backgroundColor: color,
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* 下部: 活動度サマリー ＆ 範囲外ナビ */}
      <div className="inspector-footer font-data">
        <div>
          活動強度:{" "}
          <strong className="text-accent">
            {Math.round((activity.slots_15m[slot15Idx] || 0) * 100)}%
          </strong>
          {!isPast && <span className="text-muted" style={{ marginLeft: "6px", fontSize: "10px" }}>(未再生)</span>}
        </div>
        {!isPlayheadInLoupe && (
          <div className="inspector-out-range-nav">
            <span className="material-symbols-outlined" style={{ fontSize: "11px", verticalAlign: "middle" }}>
              {currentSecInDay < rangeStartSec ? "arrow_back" : "arrow_forward"}
            </span>
            <span>現在地は{currentSecInDay < rangeStartSec ? "左側" : "右側"} ({deltaMin}分差)</span>
          </div>
        )}
      </div>

      {/* 下向き矢印ピン */}
      <div className="inspector-arrow" />
    </div>
  );
});
