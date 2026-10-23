import { isUsDst } from "./timeUtils";

// --- 日付・時間解析およびフォーマットヘルパー
export const parseDateTimeStr = (str: string) => {
  const defaultVal = { year: 2026, month: 5, day: 1, hour: 0, minute: 0, second: 0 };
  if (!str) return defaultVal;
  const match = str.trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (match) {
    return {
      year: parseInt(match[1]),
      month: parseInt(match[2]), // 1-12
      day: parseInt(match[3]),
      hour: parseInt(match[4]),
      minute: parseInt(match[5]),
      second: parseInt(match[6])
    };
  }
  const parsed = new Date(str.replace(" ", "T"));
  if (isNaN(parsed.getTime())) return defaultVal;
  return {
    year: parsed.getFullYear(),
    month: parsed.getMonth() + 1,
    day: parsed.getDate(),
    hour: parsed.getHours(),
    minute: parsed.getMinutes(),
    second: parsed.getSeconds()
  };
};

export const formatDateTimeStr = (year: number, month: number, day: number, hour: number, minute: number, second: number = 0) => {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)}`;
};

/**
 * 指定した年・月の日数（うるう年対応）を取得する
 * @param year 西暦年
 * @param month 月 (1-12)
 */
export const getDaysInMonth = (year: number, month: number): number => {
  return new Date(year, month, 0).getDate();
};

/**
 * 指定した年・月の月初（01日 00:00:00）から月末（最終日 23:59:59）までの期間文字列を生成する
 * @param year 西暦年 (例: 2024)
 * @param month 月 (1-12)
 */
export const getMonthRange = (year: number, month: number): { start: string; end: string } => {
  const lastDay = getDaysInMonth(year, month);
  return {
    start: formatDateTimeStr(year, month, 1, 0, 0, 0),
    end: formatDateTimeStr(year, month, lastDay, 23, 59, 59)
  };
};

/**
 * 指定した年・月の取引可能期間（第1営業日オープン〜末日 23:59:59）を生成する
 * - 1日が土曜の場合: 3日(月)のオープン
 * - 1日が日曜の場合: 2日(月)のオープン
 * - 1日が月曜の場合: 1日(月)のオープン (JST: 夏06:00/冬07:00, SERVER: 00:00)
 * - 1日が火〜金の場合: 1日 00:00:00 (平日深夜・市場稼働中)
 *
 * @param year 西暦年 (例: 2026)
 * @param month 月 (1-12)
 * @param timezoneMode "JST" | "SERVER" (デフォルト: "JST")
 */
export const getTradingMonthRange = (
  year: number,
  month: number,
  timezoneMode: "JST" | "SERVER" = "JST"
): { start: string; end: string } => {
  let startDay: number;
  const firstDate = new Date(Date.UTC(year, month - 1, 1));
  const dayOfWeek = firstDate.getUTCDay(); // 0: 日, 1: 月, ..., 6: 土

  let isMondayOpen: boolean;

  if (dayOfWeek === 6) {
    // 1日が土曜 -> 3日(月)
    startDay = 3;
    isMondayOpen = true;
  } else if (dayOfWeek === 0) {
    // 1日が日曜 -> 2日(月)
    startDay = 2;
    isMondayOpen = true;
  } else if (dayOfWeek === 1) {
    // 1日が月曜 -> 1日(月)
    startDay = 1;
    isMondayOpen = true;
  } else {
    // 1日が火〜金 -> 1日 00:00:00 (平日深夜市場稼働中)
    startDay = 1;
    isMondayOpen = false;
  }

  let startHour = 0;
  const startMinute = 0;
  const startSecond = 0;

  if (isMondayOpen) {
    if (timezoneMode === "SERVER") {
      startHour = 1; // MT5サーバー時間(GMT+2冬 / GMT+3夏)では月曜01:00オープン (JST冬08:00 / 夏07:00)
    } else {
      // JSTの場合: 米国夏時間判定
      // 国内FX業者(JFX等): 夏時間(DST)は月曜 07:00 JST、冬時間は月曜 08:00 JST オープン
      const dst = isUsDst(year, month, startDay);
      startHour = dst ? 7 : 8;
    }
  }

  const lastDay = getDaysInMonth(year, month);
  return {
    start: formatDateTimeStr(year, month, startDay, startHour, startMinute, startSecond),
    end: formatDateTimeStr(year, month, lastDay, 23, 59, 59)
  };
};

/**
 * 指定した西暦年の1年間全期間（01-01 00:00:00 〜 12-31 23:59:59）を生成する
 * @param year 西暦年 (例: 2024)
 */
export const getYearRange = (year: number): { start: string; end: string } => {
  return {
    start: formatDateTimeStr(year, 1, 1, 0, 0, 0),
    end: formatDateTimeStr(year, 12, 31, 23, 59, 59)
  };
};

const shiftYearMonth = (
  year: number,
  month: number,
  deltaMonths: number
): { year: number; month: number } => {
  let shiftedYear = year;
  let shiftedMonth = month + deltaMonths;
  while (shiftedMonth > 12) {
    shiftedMonth -= 12;
    shiftedYear += 1;
  }
  while (shiftedMonth < 1) {
    shiftedMonth += 12;
    shiftedYear -= 1;
  }
  return { year: shiftedYear, month: shiftedMonth };
};

/**
 * 開始・終了日時を指定月数分前後にシフトした期間を取得する
 * @param startStr 開始日時文字列 (YYYY-MM-DD HH:mm:ss)
 * @param endStr 終了日時文字列 (YYYY-MM-DD HH:mm:ss)
 * @param deltaMonths シフト月数 (正: 次月方向, 負: 前月方向)
 * @param isTradingOpen 市場オープン時刻にスナップするか (デフォルト: false)
 * @param timezoneMode "JST" | "SERVER"
 */
export const shiftDateRangeByMonth = (
  startStr: string,
  endStr: string,
  deltaMonths: number,
  isTradingOpen: boolean = false,
  timezoneMode: "JST" | "SERVER" = "JST"
): { start: string; end: string } => {
  const startParsed = parseDateTimeStr(startStr);
  const endParsed = parseDateTimeStr(endStr);

  const isFullMonthCheck = isSingleFullMonth(startStr, endStr);
  if (isFullMonthCheck.isFullMonth) {
    const { year: targetYear, month: targetMonth } = shiftYearMonth(
      startParsed.year,
      startParsed.month,
      deltaMonths
    );
    return isTradingOpen
      ? getTradingMonthRange(targetYear, targetMonth, timezoneMode)
      : getMonthRange(targetYear, targetMonth);
  }

  // 任意期間の場合: 年月をdeltaMonths分シフト
  const shiftSingle = (parsed: typeof startParsed) => {
    const { year: y, month: m } = shiftYearMonth(parsed.year, parsed.month, deltaMonths);
    const maxDays = getDaysInMonth(y, m);
    const d = Math.min(parsed.day, maxDays);
    return formatDateTimeStr(y, m, d, parsed.hour, parsed.minute, parsed.second);
  };

  return {
    start: shiftSingle(startParsed),
    end: shiftSingle(endParsed)
  };
};

/**
 * 開始・終了日時が単一の月（1日または第1営業日オープン 〜 末日 23:59:59 または同一月内）に該当するかを判定する
 */
export const isSingleFullMonth = (
  startStr: string,
  endStr: string
): { isFullMonth: boolean; year: number; month: number } => {
  const startParsed = parseDateTimeStr(startStr);
  const endParsed = parseDateTimeStr(endStr);

  if (startParsed.year === endParsed.year && startParsed.month === endParsed.month) {
    const isStartFirstDay = startParsed.day === 1 && startParsed.hour === 0 && startParsed.minute === 0;
    const isStartTradingOpen = (startParsed.day <= 3 && (startParsed.hour === 0 || startParsed.hour === 1 || startParsed.hour === 6 || startParsed.hour === 7 || startParsed.hour === 8) && startParsed.minute === 0);
    const isEndLastDay = endParsed.day === getDaysInMonth(endParsed.year, endParsed.month) && endParsed.hour === 23 && endParsed.minute === 59;
    return {
      isFullMonth: (isStartFirstDay || isStartTradingOpen) && isEndLastDay,
      year: startParsed.year,
      month: startParsed.month
    };
  }

  return {
    isFullMonth: false,
    year: startParsed.year,
    month: startParsed.month
  };
};

/**
 * 開始・終了日時の月・日・時刻を維持したまま、年度のみを指定したターゲット年に変換する
 * @param startStr 開始日時文字列 (YYYY-MM-DD HH:mm:ss)
 * @param endStr 終了日時文字列 (YYYY-MM-DD HH:mm:ss)
 * @param targetYear ターゲット西暦年 (例: 2024)
 * @param isTradingOpen 市場オープン時刻にスナップするか (デフォルト: false)
 * @param timezoneMode "JST" | "SERVER"
 */
export const alignDateRangeToYear = (
  startStr: string,
  endStr: string,
  targetYear: number,
  isTradingOpen: boolean = false,
  timezoneMode: "JST" | "SERVER" = "JST"
): { start: string; end: string } => {
  const startParsed = parseDateTimeStr(startStr);
  const endParsed = parseDateTimeStr(endStr);

  const isFullMonthCheck = isSingleFullMonth(startStr, endStr);
  if (isFullMonthCheck.isFullMonth) {
    return isTradingOpen
      ? getTradingMonthRange(targetYear, isFullMonthCheck.month, timezoneMode)
      : getMonthRange(targetYear, isFullMonthCheck.month);
  }

  // 1年全期間（1/1 00:00:00 〜 12/31 23:59:59）の場合
  const isStartJan1 = startParsed.month === 1 && startParsed.day === 1 && startParsed.hour === 0 && startParsed.minute === 0;
  const isEndDec31 = endParsed.month === 12 && endParsed.day === 31 && endParsed.hour === 23 && endParsed.minute === 59;
  if (isStartJan1 && isEndDec31) {
    return getYearRange(targetYear);
  }

  // 任意期間の場合: targetYear に合わせる
  const yearDiff = endParsed.year - startParsed.year;
  const targetEndYear = targetYear + yearDiff;

  const clampDate = (y: number, m: number, d: number, h: number, min: number, s: number) => {
    const maxDays = getDaysInMonth(y, m);
    const safeDay = Math.min(d, maxDays);
    return formatDateTimeStr(y, m, safeDay, h, min, s);
  };

  return {
    start: clampDate(targetYear, startParsed.month, startParsed.day, startParsed.hour, startParsed.minute, startParsed.second),
    end: clampDate(targetEndYear, endParsed.month, endParsed.day, endParsed.hour, endParsed.minute, endParsed.second)
  };
};
