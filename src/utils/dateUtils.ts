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
