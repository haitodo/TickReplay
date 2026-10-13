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
  const slot1hIdx = Math.max(0, Math.min(23, Math.floor(sec / 3600)));
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
  const zoomSlots: { idx: number; intensity: number; isCurrent: boolean }[] = [];
  for (let i = startSlot; i <= endSlot; i++) {
    zoomSlots.push({
      idx: i,
      intensity: activity.slots_15m[i] || 0,
      isCurrent: i === slot15Idx,
    });
  }

  // ポップアップが画面端で見切れないようにX座標をクランプ
  const tooltipLeft = Math.max(110, Math.min(trackWidth - 110, clientX));

  return (
    <div
      className="seeker-inspector-tooltip"
      style={{
        left: `${tooltipLeft}px`,
      }}
    >
      {/* 上部: 時刻 ＆ セッションタグ */}
      <div className="inspector-header">
        <span className={`inspector-session-badge ${sessionClass}`}>
          {sessionName}
        </span>
        <span className="inspector-time font-data">
          {timeSlotStr} <span className="inspector-tz-tag">{timezoneMode}</span>
        </span>
      </div>

      {/* 中央: ルーペ（拡大ミニ波形） */}
      <div className="inspector-loupe-area">
        {isPast ? (
          // 過去（再生済み）: 15分ごとの高解像度ズームバー
          <div className="inspector-bars-track">
            {zoomSlots.map((slot) => {
              const barH = Math.max(3, Math.round(slot.intensity * 38));
              let color = "rgba(148, 163, 184, 0.45)";
              if (slot.intensity >= 0.7) color = "#f59e0b";
              else if (slot.intensity >= 0.35) color = "#38bdf8";

              return (
                <div
                  key={slot.idx}
                  className={`inspector-bar-col ${slot.isCurrent ? "current" : ""}`}
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
        ) : (
          // 未来（未再生）: 1時間単位の滑らかなぼかし帯（急変の正確な時刻は伏せる）
          <div className="inspector-future-blur-box">
            <span className="inspector-future-text">
              1h帯活動傾向: {Math.round((activity.slots_1h[slot1hIdx] || 0) * 100)}%
            </span>
            <div
              className="inspector-future-gradient-bar"
              style={{
                opacity: Math.max(0.2, activity.slots_1h[slot1hIdx] || 0),
              }}
            />
          </div>
        )}
      </div>

      {/* 下部: 活動度サマリー */}
      <div className="inspector-footer font-data">
        {isPast ? (
          <span>
            活動強度:{" "}
            <strong className="text-accent">
              {Math.round((activity.slots_15m[slot15Idx] || 0) * 100)}%
            </strong>
          </span>
        ) : (
          <span className="text-muted">未再生区間 (概略表示)</span>
        )}
      </div>

      {/* 下向き矢印ピン */}
      <div className="inspector-arrow" />
    </div>
  );
});
