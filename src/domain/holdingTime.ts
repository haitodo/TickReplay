import type { VirtualPosition } from "../types/trading";

export interface StopwatchItem {
  accumulatedMs: number;
  lastActiveTime: number | null;
}

/** 保有時間の注意・警告しきい値 (ミリ秒: デフォルト固定値) */
export const HOLDING_WARN_MS = 60_000;
export const HOLDING_OVER_MS = 180_000;

/** 経過時間から表示上のプレッシャー区分を返す */
export function getHoldingPressure(
  elapsedMs: number,
  limitSec?: number
): "warn" | "over" | null {
  if (limitSec && limitSec > 0) {
    const limitMs = limitSec * 1000;
    const warnMs = limitMs * 0.7; // 制限時間の70%経過で警告（アンバー）
    if (elapsedMs >= limitMs) return "over";
    if (elapsedMs >= warnMs) return "warn";
    return null;
  }
  if (elapsedMs >= HOLDING_OVER_MS) return "over";
  if (elapsedMs >= HOLDING_WARN_MS) return "warn";
  return null;
}

/**
 * 制限時間に対する残り割合（0.0 〜 1.0）
 * 1.0: 開始直後（残り100%）
 * 0.0: タイムアップ（残り0%）
 */
export function calculateRemainingRatio(
  elapsedMs: number,
  limitSec: number
): number {
  if (!limitSec || limitSec <= 0) return 1.0;
  const limitMs = limitSec * 1000;
  const remaining = Math.max(0, limitMs - elapsedMs);
  return remaining / limitMs;
}

/**
 * 制限時間ありの場合の経過・残り時間表示文字列
 */
export function formatHoldingTimeWithLimit(
  elapsedMs: number,
  limitSec: number
): string {
  if (!limitSec || limitSec <= 0) {
    return formatElapsedTime(elapsedMs);
  }
  const limitMs = limitSec * 1000;
  const elapsedSecFormatted = formatElapsedTime(elapsedMs);
  if (elapsedMs >= limitMs) {
    const overSec = ((elapsedMs - limitMs) / 1000).toFixed(1);
    return `${elapsedSecFormatted} / ${limitSec}秒 (+${overSec}s)`;
  }
  const remainingSec = ((limitMs - elapsedMs) / 1000).toFixed(1);
  return `${elapsedSecFormatted} / ${limitSec}秒 (残 ${remainingSec}s)`;
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
  const tenths = Math.floor((ms % 1000) / 100);

  if (hours > 0) {
    return `${hours}時間${minutes}分${seconds}秒`;
  }
  if (minutes > 0) {
    const secPad = seconds < 10 ? `0${seconds}` : `${seconds}`;
    return `${minutes}分${secPad}.${tenths}秒`;
  }
  return `${seconds}.${tenths}秒`;
}
