import { invoke } from "@tauri-apps/api/core";
import { STORAGE_KEYS } from "../constants/storageKeys";

export interface EconomicMonthStatus {
  year_month: string;
  exists: boolean;
  event_count: number;
}

export interface EconomicDataAvailability {
  symbol: string;
  pair: string;
  is_all_available: boolean;
  has_any_data: boolean;
  total_events: number;
  months: EconomicMonthStatus[];
  missing_months: string[];
  available_months: string[];
}

export const ECONOMIC_DIR_STORAGE_KEY = STORAGE_KEYS.replayEconomicDataDir;
const STORAGE_KEY = "replay-economic-availability";
const SYMBOL_KEY = "replay-economic-symbol";

// メモリ内キャッシュ
let inMemoryAvailabilityMap: Record<string, boolean> = {};

/**
 * localStorageから保存済みの経済指標データディレクトリパスを取得
 */
export function getStoredEconomicDataDir(): string {
  return localStorage.getItem(ECONOMIC_DIR_STORAGE_KEY) || "";
}

/**
 * 経済指標データディレクトリパスをlocalStorageに保存
 */
export function setStoredEconomicDataDir(dir: string): void {
  localStorage.setItem(ECONOMIC_DIR_STORAGE_KEY, dir);
}

/**
 * localStorageからキャッシュ済みの年月別経済指標充足マップを取得
 */
export function getCachedEconomicAvailabilityMap(): Record<string, boolean> {
  if (Object.keys(inMemoryAvailabilityMap).length > 0) {
    return inMemoryAvailabilityMap;
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      inMemoryAvailabilityMap = JSON.parse(saved);
      return inMemoryAvailabilityMap;
    }
  } catch (e) {
    console.error("Failed to parse cached economic availability:", e);
  }
  return {};
}

/**
 * 期間内の経済指標データ充足状況を確認し、ロード＆キャッシュを行う (単一パス/IO重複排除)
 */
export async function checkEconomicDataAvailability(
  symbol: string,
  startTime: string,
  endTime: string,
  preloadMode?: string,
  preloadDate?: string,
  customDir?: string
): Promise<EconomicDataAvailability> {
  const targetDir = customDir !== undefined ? customDir : getStoredEconomicDataDir();
  const result = await invoke<EconomicDataAvailability>("check_economic_data_availability", {
    symbol,
    startTime,
    endTime,
    preloadMode,
    preloadDate,
    customDir: targetDir && targetDir.trim() ? targetDir.trim() : null,
  });

  const newMap: Record<string, boolean> = {};
  if (result && Array.isArray(result.months)) {
    result.months.forEach((m) => {
      newMap[m.year_month] = m.exists;
    });
  }

  inMemoryAvailabilityMap = newMap;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newMap));
    localStorage.setItem(SYMBOL_KEY, symbol);
    // 他のウィンドウ (Controller/SpeedOrder) に同期通知
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: STORAGE_KEY,
        newValue: JSON.stringify(newMap),
      })
    );
  } catch (e) {
    console.error("Failed to save economic availability to storage:", e);
  }

  return result;
}

/**
 * 仮想時刻（ミリ秒）から年月文字列 (YYYY-MM) を抽出
 */
export function getYearMonthFromMsc(virtualTimeMsc: number): string {
  if (!virtualTimeMsc || virtualTimeMsc <= 0) return "";
  const d = new Date(virtualTimeMsc);
  if (isNaN(d.getTime())) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * 現在の仮想時刻において「指標連動スプレッドモード」が有効かどうかを判定
 */
export function isEconomicSpreadActive(
  virtualTimeMsc: number,
  customMap?: Record<string, boolean>
): boolean {
  const map = customMap || getCachedEconomicAvailabilityMap();
  const ym = getYearMonthFromMsc(virtualTimeMsc);
  if (ym && ym in map) {
    return Boolean(map[ym]);
  }
  // 年月が特定できない場合、マップ内に有効データが1つでもあればtrue、全滅ならfalse
  const values = Object.values(map);
  if (values.length > 0) {
    return values.some(Boolean);
  }
  return false;
}

/**
 * 年月文字列 (YYYY-MM) を日本語表記 (YYYY年MM月) に整形
 */
export function formatYearMonthJapanese(ym: string): string {
  if (!ym) return "";
  const parts = ym.split("-");
  if (parts.length >= 2) {
    return `${parts[0]}年${parts[1]}月`;
  }
  return ym;
}
