import type { TimeStepItem } from "../types/replay";

export const DEFAULT_TIME_STEPS: TimeStepItem[] = [
  { id: "ts-1", seconds: 10, label: "10S" },
  { id: "ts-2", seconds: 60, label: "1M" },
  { id: "ts-3", seconds: 600, label: "10M" },
  { id: "ts-4", seconds: 3600, label: "1H" },
];

export const PRESET_TIME_OPTIONS: { seconds: number; label: string }[] = [
  { seconds: 5, label: "5S" },
  { seconds: 10, label: "10S" },
  { seconds: 30, label: "30S" },
  { seconds: 60, label: "1M" },
  { seconds: 300, label: "5M" },
  { seconds: 600, label: "10M" },
  { seconds: 900, label: "15M" },
  { seconds: 1800, label: "30M" },
  { seconds: 3600, label: "1H" },
  { seconds: 14400, label: "4H" },
];

export const formatSecondsToLabel = (sec: number): string => {
  if (sec < 60) return `${sec}S`;
  if (sec < 3600 && sec % 60 === 0) return `${sec / 60}M`;
  if (sec % 3600 === 0) return `${sec / 3600}H`;
  if (sec >= 3600) return `${(sec / 3600).toFixed(1)}H`;
  return `${(sec / 60).toFixed(1)}M`;
};

export const formatTimeStepLabel = (sec: number): string => {
  if (sec < 60) return `${sec}S`;
  if (sec >= 86400) return `${(sec / 86400).toFixed(0)}D`;
  if (sec >= 3600) return `${(sec / 3600).toFixed(0)}H`;
  return `${(sec / 60).toFixed(1)}M`;
};
