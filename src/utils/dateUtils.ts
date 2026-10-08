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
 * （1ヶ月の期間指定であれば、翌月1日〜翌月末日へ綺麗にシフトする）
 * @param startStr 開始日時文字列 (YYYY-MM-DD HH:mm:ss)
 * @param endStr 終了日時文字列 (YYYY-MM-DD HH:mm:ss)
 * @param deltaMonths シフト月数 (正: 次月方向, 負: 前月方向)
 */
export const shiftDateRangeByMonth = (
  startStr: string,
  endStr: string,
  deltaMonths: number
): { start: string; end: string } => {
  const startParsed = parseDateTimeStr(startStr);
  const endParsed = parseDateTimeStr(endStr);

  // 1ヶ月全期間（1日〜末日）の場合、ターゲット月の1日〜末日に綺麗に揃える
  const isStartFirstDay = startParsed.day === 1 && startParsed.hour === 0 && startParsed.minute === 0 && startParsed.second === 0;
  const isEndLastDay = endParsed.day === getDaysInMonth(endParsed.year, endParsed.month) && endParsed.hour === 23 && endParsed.minute === 59;
  const isSameMonth = startParsed.year === endParsed.year && startParsed.month === endParsed.month;

  if (isSameMonth && isStartFirstDay && isEndLastDay) {
    const { year: targetYear, month: targetMonth } = shiftYearMonth(
      startParsed.year,
      startParsed.month,
      deltaMonths
    );
    return getMonthRange(targetYear, targetMonth);
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
 * 開始・終了日時が単一の月（1日 00:00:00 〜 末日 23:59:59 または同一月内）に該当するかを判定する
 */
export const isSingleFullMonth = (
  startStr: string,
  endStr: string
): { isFullMonth: boolean; year: number; month: number } => {
  const startParsed = parseDateTimeStr(startStr);
  const endParsed = parseDateTimeStr(endStr);

  if (startParsed.year === endParsed.year && startParsed.month === endParsed.month) {
    const isStartFirstDay = startParsed.day === 1 && startParsed.hour === 0 && startParsed.minute === 0;
    const isEndLastDay = endParsed.day === getDaysInMonth(endParsed.year, endParsed.month) && endParsed.hour === 23 && endParsed.minute === 59;
    return {
      isFullMonth: isStartFirstDay && isEndLastDay,
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
 */
export const alignDateRangeToYear = (
  startStr: string,
  endStr: string,
  targetYear: number
): { start: string; end: string } => {
  const startParsed = parseDateTimeStr(startStr);
  const endParsed = parseDateTimeStr(endStr);

  const isFullMonthCheck = isSingleFullMonth(startStr, endStr);
  if (isFullMonthCheck.isFullMonth) {
    return getMonthRange(targetYear, isFullMonthCheck.month);
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

