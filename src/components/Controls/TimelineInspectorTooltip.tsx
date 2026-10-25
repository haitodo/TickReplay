import React from "react";
import type { DayTimelineActivity } from "../../types/replay";
import { getTimelineInspectorViewData } from "../../utils/timelineInspector";

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
  const {
    slot15Idx,
    isPast,
    timeSlotStr,
    sessionName,
    sessionClass,
    rangeStartSec,
    isPlayheadInLoupe,
    playheadPercent,
    zoomSlots,
    deltaSec,
    deltaMin,
    isNearCurrent,
  } = getTimelineInspectorViewData(activity, sec, currentSecInDay, timezoneMode);

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
            const slotIsPast = slot.isPast;
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
