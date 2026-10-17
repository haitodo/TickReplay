import type { VirtualPosition } from "../types/trading";

export interface StopwatchItem {
  accumulatedMs: number;
  lastActiveTime: number | null;
}

/**
 * 最古ポジションの経過時間を計算 (ミリ秒)
 */
export function calculatePositionElapsedTime(
  positions: VirtualPosition[],
  holdingTimeMode: "pc" | "server",
  virtualTimeMsc: number,
  stopwatchStates: Record<string, StopwatchItem>,
  nowMs: number = Date.now()
): number {
  if (positions.length === 0) return 0;
  const oldest = positions.reduce(
    (old, p) => (p.open_time_msc < old.open_time_msc ? p : old),
    positions[0]
  );

  if (holdingTimeMode === "server") {
    if (!virtualTimeMsc || virtualTimeMsc <= 0) return 0;
    let openTime = oldest.open_time_msc;
    if (!openTime || openTime <= 0) {
      openTime = oldest.open_time ? oldest.open_time * 1000 : virtualTimeMsc;
    } else if (openTime < 10000000000) {
      // openTime が秒単位で渡されていた場合はミリ秒に正規化
      openTime = openTime * 1000;
    }
    const elapsed = virtualTimeMsc - openTime;
    return Math.max(0, elapsed);
  } else {
    const posKey = `${oldest.ticket}_${oldest.open_time_msc}`;
    const stopwatch =
      stopwatchStates[posKey] || (stopwatchStates as Record<string | number, StopwatchItem>)[oldest.ticket];
    if (!stopwatch) return 0;
    const elapsed =
      stopwatch.accumulatedMs +
      (stopwatch.lastActiveTime ? nowMs - stopwatch.lastActiveTime : 0);
    return Math.max(0, elapsed);
  }
}

/**
 * 経過ミリ秒を人間が読みやすい文字列にフォーマット
 */
export function formatElapsedTime(ms: number): string {
  if (isNaN(ms) || ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}時間${minutes}分${seconds}秒`;
  }
  if (minutes > 0) {
    return `${minutes}分${seconds}秒`;
  }
  const tenths = Math.floor((ms % 1000) / 100);
  return `${seconds}.${tenths}秒`;
}
