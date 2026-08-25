import { describe, it, expect } from "vitest";
import {
  parseDateTimeStr,
  formatDateTimeStr,
  getDaysInMonth,
  getMonthRange,
  getYearRange,
  shiftDateRangeByMonth,
  isSingleFullMonth,
  alignDateRangeToYear
} from "../dateUtils";

describe("dateUtils", () => {
  it("parseDateTimeStr correctly parses standard YYYY-MM-DD HH:mm:ss format", () => {
    const result = parseDateTimeStr("2026-05-15 14:30:45");
    expect(result).toEqual({
      year: 2026,
      month: 5,
      day: 15,
      hour: 14,
      minute: 30,
      second: 45
    });
  });

  it("parseDateTimeStr returns default object for empty or invalid string", () => {
    const defaultVal = { year: 2026, month: 5, day: 1, hour: 0, minute: 0, second: 0 };
    expect(parseDateTimeStr("")).toEqual(defaultVal);
    expect(parseDateTimeStr("invalid date")).toEqual(defaultVal);
  });

  it("formatDateTimeStr correctly formats date and time parts", () => {
    const str = formatDateTimeStr(2026, 5, 15, 14, 30, 45);
    expect(str).toBe("2026-05-15 14:30:45");
  });

  it("getDaysInMonth handles leap years and different month lengths", () => {
    expect(getDaysInMonth(2024, 2)).toBe(29); // Leap year 2024
    expect(getDaysInMonth(2023, 2)).toBe(28); // Regular year 2023
    expect(getDaysInMonth(2024, 4)).toBe(30); // April
    expect(getDaysInMonth(2024, 5)).toBe(31); // May
  });

  it("getMonthRange returns exact 1-month range from 1st 00:00:00 to last day 23:59:59", () => {
    const feb2024 = getMonthRange(2024, 2);
    expect(feb2024.start).toBe("2024-02-01 00:00:00");
    expect(feb2024.end).toBe("2024-02-29 23:59:59");

    const may2024 = getMonthRange(2024, 5);
    expect(may2024.start).toBe("2024-05-01 00:00:00");
    expect(may2024.end).toBe("2024-05-31 23:59:59");
  });

  it("getYearRange returns full year range", () => {
    const year2024 = getYearRange(2024);
    expect(year2024.start).toBe("2024-01-01 00:00:00");
    expect(year2024.end).toBe("2024-12-31 23:59:59");
  });

  it("shiftDateRangeByMonth correctly advances and rewinds full month ranges", () => {
    // Advancing from May 2024 (+1 month)
    const nextMonth = shiftDateRangeByMonth("2024-05-01 00:00:00", "2024-05-31 23:59:59", 1);
    expect(nextMonth.start).toBe("2024-06-01 00:00:00");
    expect(nextMonth.end).toBe("2024-06-30 23:59:59");

    // Rewinding from Jan 2024 (-1 month -> Dec 2023)
    const prevMonth = shiftDateRangeByMonth("2024-01-01 00:00:00", "2024-01-31 23:59:59", -1);
    expect(prevMonth.start).toBe("2023-12-01 00:00:00");
    expect(prevMonth.end).toBe("2023-12-31 23:59:59");

    // Crossing year boundary forward from Dec 2024 (+1 month -> Jan 2025)
    const nextYear = shiftDateRangeByMonth("2024-12-01 00:00:00", "2024-12-31 23:59:59", 1);
    expect(nextYear.start).toBe("2025-01-01 00:00:00");
    expect(nextYear.end).toBe("2025-01-31 23:59:59");
  });

  it("isSingleFullMonth detects if range matches full single month", () => {
    expect(isSingleFullMonth("2024-05-01 00:00:00", "2024-05-31 23:59:59")).toEqual({
      isFullMonth: true,
      year: 2024,
      month: 5
    });

    expect(isSingleFullMonth("2024-05-01 00:00:00", "2024-05-15 12:00:00")).toEqual({
      isFullMonth: false,
      year: 2024,
      month: 5
    });

    expect(isSingleFullMonth("2024-01-01 00:00:00", "2024-12-31 23:59:59")).toEqual({
      isFullMonth: false,
      year: 2024,
      month: 1
    });
  });

  describe("alignDateRangeToYear", () => {
    it("1ヶ月全期間の場合、対象年の該当年月の全期間に変換すること", () => {
      const res = alignDateRangeToYear("2026-05-01 00:00:00", "2026-05-31 23:59:59", 2024);
      expect(res.start).toBe("2024-05-01 00:00:00");
      expect(res.end).toBe("2024-05-31 23:59:59");
    });

    it("うるう年2月の1ヶ月全期間が正しく変換されること", () => {
      const res = alignDateRangeToYear("2023-02-01 00:00:00", "2023-02-28 23:59:59", 2024);
      expect(res.start).toBe("2024-02-01 00:00:00");
      expect(res.end).toBe("2024-02-29 23:59:59");
    });

    it("年間全期間の場合、対象年の1/1〜12/31に変換すること", () => {
      const res = alignDateRangeToYear("2026-01-01 00:00:00", "2026-12-31 23:59:59", 2023);
      expect(res.start).toBe("2023-01-01 00:00:00");
      expect(res.end).toBe("2023-12-31 23:59:59");
    });

    it("任意期間の月・日・時間を維持して年度のみ変換すること", () => {
      const res = alignDateRangeToYear("2026-03-15 10:30:00", "2026-04-20 18:00:00", 2024);
      expect(res.start).toBe("2024-03-15 10:30:00");
      expect(res.end).toBe("2024-04-20 18:00:00");
    });
  });
});

