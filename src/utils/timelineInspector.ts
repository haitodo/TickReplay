import type { DayTimelineActivity, TimezoneMode } from "../types/replay";
import { formatJstTime, formatServerTime } from "./timeUtils";

const SECONDS_PER_SLOT = 15 * 60;
const SECONDS_PER_DAY = 24 * 60 * 60;
const SLOT_COUNT = SECONDS_PER_DAY / SECONDS_PER_SLOT;
const LAST_SLOT_INDEX = SLOT_COUNT - 1;
const LOUPE_SLOT_RADIUS = 4;

export interface TimelineZoomSlot {
  idx: number;
  intensity: number;
  isHoverTarget: boolean;
  isPlayingSlot: boolean;
  isPast: boolean;
}

export interface TimelineInspectorViewData {
  slot15Idx: number;
  isPast: boolean;
  timeSlotStr: string;
  sessionName: string;
  sessionClass: string;
  rangeStartSec: number;
  isPlayheadInLoupe: boolean;
  playheadPercent: number;
  zoomSlots: TimelineZoomSlot[];
  deltaSec: number;
  deltaMin: number;
  isNearCurrent: boolean;
}

const formatTimeSlotFallback = (startSec: number, endSec: number): string => {
  const startHour = Math.floor(startSec / 3600).toString().padStart(2, "0");
  const startMinute = Math.floor((startSec % 3600) / 60).toString().padStart(2, "0");
  const endHour = Math.floor(endSec / 3600).toString().padStart(2, "0");
  const endMinute = Math.floor((endSec % 3600) / 60).toString().padStart(2, "0");
  return `${startHour}:${startMinute} - ${endHour}:${endMinute}`;
};

const getTimeSlotStr = (
  activity: DayTimelineActivity,
  slot15Idx: number,
  timezoneMode: TimezoneMode
): string => {
  const startSec = slot15Idx * SECONDS_PER_SLOT;
  const endSec = Math.min(SECONDS_PER_DAY, (slot15Idx + 1) * SECONDS_PER_SLOT);
  if (!activity.day_start_msc) {
    return formatTimeSlotFallback(startSec, endSec);
  }

  const startMsc = activity.day_start_msc + startSec * 1000;
  const endMsc = activity.day_start_msc + endSec * 1000;
  if (timezoneMode === "JST") {
    const start = formatJstTime(startMsc).substring(11, 16);
    const end = formatJstTime(endMsc).substring(11, 16);
    return `${start} - ${end}`;
  }

  const start = formatServerTime(startMsc).substring(11, 16);
  const end = slot15Idx === LAST_SLOT_INDEX ? "24:00" : formatServerTime(endMsc).substring(11, 16);
  return `${start} - ${end}`;
};

const getSessionBadge = (
  activity: DayTimelineActivity,
  sec: number
): { sessionName: string; sessionClass: string } => {
  if (sec >= activity.ny_start_sec) return { sessionName: "New York", sessionClass: "ny" };
  if (sec >= activity.ldn_start_sec) return { sessionName: "London", sessionClass: "ldn" };
  if (sec >= activity.tyo_start_sec) return { sessionName: "Tokyo", sessionClass: "tyo" };
  return { sessionName: "Early Asia", sessionClass: "asia" };
};

export const getTimelineInspectorViewData = (
  activity: DayTimelineActivity,
  sec: number,
  currentSecInDay: number,
  timezoneMode: TimezoneMode
): TimelineInspectorViewData => {
  const slot15Idx = Math.max(0, Math.min(LAST_SLOT_INDEX, Math.floor(sec / SECONDS_PER_SLOT)));
  const isPast = sec <= currentSecInDay;
  const timeSlotStr = getTimeSlotStr(activity, slot15Idx, timezoneMode);
  const { sessionName, sessionClass } = getSessionBadge(activity, sec);

  const startSlot = Math.max(0, slot15Idx - LOUPE_SLOT_RADIUS);
  const endSlot = Math.min(LAST_SLOT_INDEX, slot15Idx + LOUPE_SLOT_RADIUS);
  const rangeStartSec = startSlot * SECONDS_PER_SLOT;
  const rangeEndSec = (endSlot + 1) * SECONDS_PER_SLOT;
  const rangeDuration = rangeEndSec - rangeStartSec;
  const isPlayheadInLoupe = currentSecInDay >= rangeStartSec && currentSecInDay <= rangeEndSec;
  const playheadPercent = isPlayheadInLoupe && rangeDuration > 0
    ? ((currentSecInDay - rangeStartSec) / rangeDuration) * 100
    : 0;
  const playingSlotIdx = Math.floor(currentSecInDay / SECONDS_PER_SLOT);

  const zoomSlots: TimelineZoomSlot[] = [];
  for (let idx = startSlot; idx <= endSlot; idx++) {
    zoomSlots.push({
      idx,
      intensity: activity.slots_15m[idx] || 0,
      isHoverTarget: idx === slot15Idx,
      isPlayingSlot: idx === playingSlotIdx,
      isPast: (idx + 0.5) * SECONDS_PER_SLOT <= currentSecInDay,
    });
  }

  const deltaSec = sec - currentSecInDay;
  const deltaMin = Math.round(Math.abs(deltaSec) / 60);
  const isNearCurrent = Math.abs(deltaSec) < 30;

  return {
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
  };
};
