/**
 * タイムゾーンおよび日時変換ヘルパー
 * MT5サーバー時間 (GMT+3夏 / GMT+2冬)、JST (GMT+9)、UTC (GMT+0) の統一的かつ高精度な変換を提供します。
 */

/**
 * UTC年・月・日から米国夏時間(DST)かどうかを判定する
 * 米国DST: 3月第2日曜日 〜 11月第1日曜日
 */
export const isUsDst = (year: number, month: number, day: number): boolean => {
  if (month < 3 || month > 11) return false;
  if (month > 3 && month < 11) return true;

  if (month === 3) {
    const march1 = new Date(Date.UTC(year, 2, 1));
    const march1Day = march1.getUTCDay();
    const secondSunday = 1 + (march1Day === 0 ? 7 : 7 - march1Day + 7);
    return day >= secondSunday;
  }

  if (month === 11) {
    const nov1 = new Date(Date.UTC(year, 10, 1));
    const nov1Day = nov1.getUTCDay();
    const firstSunday = 1 + (nov1Day === 0 ? 0 : 7 - nov1Day);
    return day < firstSunday;
  }

  return false;
};

/**
 * タイムスタンプ(ms)が米国夏時間(DST)内にあるか判定
 */
export const isMscUsDst = (msc: number): boolean => {
  if (!msc || msc <= 0) return false;
  const d = new Date(msc);
  return isUsDst(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
};

/**
 * MT5サーバー時間 -> JST 変換時の加算時間 (時間)
 * 夏時間(GMT+3) -> JST(GMT+9): +6時間
 * 冬時間(GMT+2) -> JST(GMT+9): +7時間
 */
export const getServerToJstOffsetHours = (virtualTimeMsc: number): number => {
  return isMscUsDst(virtualTimeMsc) ? 6 : 7;
};

/**
 * MT5サーバー時間 -> UTC 変換時の減算時間 (時間)
 * 夏時間(GMT+3) -> UTC(GMT+0): 3時間
 * 冬時間(GMT+2) -> UTC(GMT+0): 2時間
 */
export const getServerToUtcOffsetHours = (virtualTimeMsc: number): number => {
  return isMscUsDst(virtualTimeMsc) ? 3 : 2;
};

/**
 * MT5仮想サーバー時間(ms)から真のUTCミリ秒タイムスタンプを算出
 */
export const getTrueUtcMs = (virtualTimeMsc: number): number => {
  if (!virtualTimeMsc || virtualTimeMsc <= 0) return 0;
  const offsetHours = getServerToUtcOffsetHours(virtualTimeMsc);
  return virtualTimeMsc - offsetHours * 3600 * 1000;
};

/**
 * 日時文字列 ("YYYY-MM-DD HH:mm:ss" または "YYYY.MM.DD HH:mm:ss" 等) を
 * ブラウザ/OSのローカルタイムゾーンの影響を受けずに純粋なUTCミリ秒表現へパース
 */
export const parseTimeStrToUtcMs = (timeStr: string): number => {
  if (!timeStr) return NaN;
  const cleanStr = timeStr.replace(/\./g, "-").trim();
  const match = cleanStr.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}):(\d{2}))?/);
  if (!match) return NaN;

  const y = parseInt(match[1], 10);
  const m = parseInt(match[2], 10) - 1; // 0-11
  const d = parseInt(match[3], 10);
  const hh = match[4] ? parseInt(match[4], 10) : 0;
  const mm = match[5] ? parseInt(match[5], 10) : 0;
  const ss = match[6] ? parseInt(match[6], 10) : 0;

  return Date.UTC(y, m, d, hh, mm, ss);
};

/**
 * UTCミリ秒表現を "YYYY-MM-DD HH:mm:ss" 形式の文字列へフォーマット
 */
export const formatUtcMsToDateTimeStr = (utcMsc: number): string => {
  if (!utcMsc || isNaN(utcMsc) || utcMsc <= 0) return "--:--:--";
  const d = new Date(utcMsc);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
    d.getUTCHours()
  )}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};

/**
 * MT5仮想サーバー時間(ms)を JST日時の文字列 ("YYYY-MM-DD HH:mm:ss") へ変換
 */
export const formatJstTime = (virtualTimeMsc: number): string => {
  if (!virtualTimeMsc || virtualTimeMsc <= 0) return "--:--:--";
  const offsetHours = getServerToJstOffsetHours(virtualTimeMsc);
  const jstMsc = virtualTimeMsc + offsetHours * 3600 * 1000;
  return formatUtcMsToDateTimeStr(jstMsc);
};

/**
 * MT5仮想サーバー時間(ms)を サーバー日時の文字列 ("YYYY-MM-DD HH:mm:ss") へ変換
 */
export const formatServerTime = (virtualTimeMsc: number): string => {
  if (!virtualTimeMsc || virtualTimeMsc <= 0) return "--:--:--";
  return formatUtcMsToDateTimeStr(virtualTimeMsc);
};

/**
 * 日時文字列 ("YYYY-MM-DD HH:mm:ss") を年を省略した形式 ("MM/DD HH:mm:ss") へ変換
 */
export const formatShortDateTimeStr = (dateTimeStr: string): string => {
  if (!dateTimeStr || dateTimeStr === "--:--:--") return "--:--:--";
  if (dateTimeStr.length >= 19) {
    return `${dateTimeStr.substring(5, 7)}/${dateTimeStr.substring(8, 10)} ${dateTimeStr.substring(11, 19)}`;
  }
  return dateTimeStr;
};

export interface FormattedShortTime {
  datePart: string;
  timePart: string;
}

/**
 * 日時文字列 ("YYYY-MM-DD HH:mm:ss") を日付部 ("MM/DD") と時刻部 ("HH:mm:ss") に分割
 */
export const splitShortDateTime = (dateTimeStr: string): FormattedShortTime => {
  if (!dateTimeStr || dateTimeStr === "--:--:--") {
    return { datePart: "", timePart: "--:--:--" };
  }
  if (dateTimeStr.length >= 19) {
    return {
      datePart: `${dateTimeStr.substring(5, 7)}/${dateTimeStr.substring(8, 10)}`,
      timePart: dateTimeStr.substring(11, 19),
    };
  }
  return { datePart: "", timePart: dateTimeStr };
};

/**
 * サーバー日時文字列 ("YYYY-MM-DD HH:mm:ss") を JST日時文字列へ変換
 */
export const convertServerStrToJstStr = (serverTimeStr: string): string => {
  if (!serverTimeStr) return "";
  const serverUtcMsc = parseTimeStrToUtcMs(serverTimeStr);
  if (isNaN(serverUtcMsc)) return serverTimeStr;
  const offsetHours = getServerToJstOffsetHours(serverUtcMsc);
  return formatUtcMsToDateTimeStr(serverUtcMsc + offsetHours * 3600 * 1000);
};

/**
 * JST日時文字列 ("YYYY-MM-DD HH:mm:ss") を サーバー日時文字列へ変換
 */
export const convertJstStrToServerStr = (jstTimeStr: string): string => {
  if (!jstTimeStr) return "";
  const jstUtcMsc = parseTimeStrToUtcMs(jstTimeStr);
  if (isNaN(jstUtcMsc)) return jstTimeStr;
  // JST基準のmsから9時間引き去って真のUTC msを算出
  const trueUtcMsc = jstUtcMsc - 9 * 3600 * 1000;
  // 真のUTC msのDST判定に基づき、サーバー時間を加算
  const isDst = isMscUsDst(trueUtcMsc);
  const serverOffset = isDst ? 3 : 2;
  return formatUtcMsToDateTimeStr(trueUtcMsc + serverOffset * 3600 * 1000);
};

/**
 * 指標アイテム等の時刻文字列を、指定された timezoneMode ("JST" | "SERVER") に合わせて表示用に変換
 * (itemTimeStr が元々 JST である前提)
 */
export const getNewsTimeForDisplay = (itemTimeStr: string, mode: "JST" | "SERVER"): string => {
  if (!itemTimeStr) return "";
  if (mode === "JST") {
    return itemTimeStr.replace(/\./g, "-");
  }
  return convertJstStrToServerStr(itemTimeStr);
};
