import { describe, it, expect } from "vitest";
import {
  isUsDst,
  isMscUsDst,
  getServerToJstOffsetHours,
  getServerToUtcOffsetHours,
  getTrueUtcMs,
  parseTimeStrToUtcMs,
  formatUtcMsToDateTimeStr,
  formatJstTime,
  formatServerTime,
  convertServerStrToJstStr,
  convertJstStrToServerStr,
  getNewsTimeForDisplay,
  formatShortDateTimeStr,
  splitShortDateTime,
} from "../timeUtils";

describe("timeUtils", () => {
  describe("isUsDst and isMscUsDst", () => {
    it("identifies summer time correctly (April-October)", () => {
      expect(isUsDst(2025, 4, 1)).toBe(true);
      expect(isUsDst(2025, 7, 15)).toBe(true);
      expect(isUsDst(2025, 10, 31)).toBe(true);
      expect(isMscUsDst(Date.UTC(2025, 6, 15))).toBe(true);
    });

    it("identifies winter time correctly (January-February, December)", () => {
      expect(isUsDst(2025, 1, 15)).toBe(false);
      expect(isUsDst(2025, 2, 28)).toBe(false);
      expect(isUsDst(2025, 12, 1)).toBe(false);
      expect(isMscUsDst(Date.UTC(2025, 0, 15))).toBe(false);
    });

    it("handles March DST boundary (second Sunday of March)", () => {
      expect(isUsDst(2025, 3, 8)).toBe(false);
      expect(isUsDst(2025, 3, 9)).toBe(true);
      expect(isUsDst(2025, 3, 10)).toBe(true);
    });

    it("handles November DST boundary (first Sunday of November)", () => {
      expect(isUsDst(2025, 11, 1)).toBe(true);
      expect(isUsDst(2025, 11, 2)).toBe(false);
      expect(isUsDst(2025, 11, 3)).toBe(false);
    });
  });

  describe("getServerToJstOffsetHours and getServerToUtcOffsetHours and getTrueUtcMs", () => {
    it("returns +6 for JST and +3 for UTC in summer", () => {
      const summerMsc = Date.UTC(2025, 6, 1, 12, 0, 0); // July 1
      expect(getServerToJstOffsetHours(summerMsc)).toBe(6);
      expect(getServerToUtcOffsetHours(summerMsc)).toBe(3);
      expect(getTrueUtcMs(summerMsc)).toBe(summerMsc - 3 * 3600 * 1000);
    });

    it("returns +7 for JST and +2 for UTC in winter", () => {
      const winterMsc = Date.UTC(2025, 0, 15, 12, 0, 0); // Jan 15
      expect(getServerToJstOffsetHours(winterMsc)).toBe(7);
      expect(getServerToUtcOffsetHours(winterMsc)).toBe(2);
      expect(getTrueUtcMs(winterMsc)).toBe(winterMsc - 2 * 3600 * 1000);
    });

    it("handles invalid or zero timestamps in getTrueUtcMs", () => {
      expect(getTrueUtcMs(0)).toBe(0);
      expect(getTrueUtcMs(-1)).toBe(0);
    });
  });

  describe("parseTimeStrToUtcMs and formatUtcMsToDateTimeStr", () => {
    it("parses date string to UTC ms and formats back identically", () => {
      const dateStr = "2025-06-15 14:30:45";
      const ms = parseTimeStrToUtcMs(dateStr);
      expect(ms).toBe(Date.UTC(2025, 5, 15, 14, 30, 45));
      expect(formatUtcMsToDateTimeStr(ms)).toBe("2025-06-15 14:30:45");
    });

    it("handles dot notation format YYYY.MM.DD HH:mm:ss", () => {
      const dotStr = "2025.06.15 14:30:45";
      const ms = parseTimeStrToUtcMs(dotStr);
      expect(ms).toBe(Date.UTC(2025, 5, 15, 14, 30, 45));
      expect(formatUtcMsToDateTimeStr(ms)).toBe("2025-06-15 14:30:45");
    });

    it("returns --:--:-- on invalid or zero timestamp", () => {
      expect(formatUtcMsToDateTimeStr(0)).toBe("--:--:--");
      expect(formatUtcMsToDateTimeStr(NaN)).toBe("--:--:--");
    });
  });

  describe("formatJstTime and formatServerTime", () => {
    it("formats virtual server time as JST time string", () => {
      const serverMsc = Date.UTC(2025, 6, 1, 10, 0, 0);
      expect(formatJstTime(serverMsc)).toBe("2025-07-01 16:00:00");
    });

    it("formats virtual server time as server time string", () => {
      const serverMsc = Date.UTC(2025, 6, 1, 10, 0, 0);
      expect(formatServerTime(serverMsc)).toBe("2025-07-01 10:00:00");
    });

    it("returns --:--:-- on invalid or zero time", () => {
      expect(formatJstTime(0)).toBe("--:--:--");
      expect(formatServerTime(0)).toBe("--:--:--");
    });
  });

  describe("convertServerStrToJstStr and convertJstStrToServerStr", () => {
    it("converts summer server time to JST (+6 hours)", () => {
      const serverStr = "2025-07-01 10:00:00";
      expect(convertServerStrToJstStr(serverStr)).toBe("2025-07-01 16:00:00");
    });

    it("converts winter server time to JST (+7 hours)", () => {
      const serverStr = "2025-01-15 10:00:00";
      expect(convertServerStrToJstStr(serverStr)).toBe("2025-01-15 17:00:00");
    });

    it("converts summer JST time back to server time (-6 hours)", () => {
      const jstStr = "2025-07-01 16:00:00";
      expect(convertJstStrToServerStr(jstStr)).toBe("2025-07-01 10:00:00");
    });

    it("converts winter JST time back to server time (-7 hours)", () => {
      const jstStr = "2025-01-15 17:00:00";
      expect(convertJstStrToServerStr(jstStr)).toBe("2025-01-15 10:00:00");
    });
  });

  describe("getNewsTimeForDisplay", () => {
    it("formats news time in JST", () => {
      expect(getNewsTimeForDisplay("2025.07.01 16:00:00", "JST")).toBe("2025-07-01 16:00:00");
    });

    it("converts news time to Server time", () => {
      expect(getNewsTimeForDisplay("2025-07-01 16:00:00", "SERVER")).toBe("2025-07-01 10:00:00");
    });
  });

  describe("formatShortDateTimeStr", () => {
    it("formats YYYY-MM-DD HH:mm:ss to MM/DD HH:mm:ss", () => {
      expect(formatShortDateTimeStr("2025-06-15 14:30:45")).toBe("06/15 14:30:45");
    });

    it("handles invalid or --:--:-- correctly", () => {
      expect(formatShortDateTimeStr("--:--:--")).toBe("--:--:--");
      expect(formatShortDateTimeStr("")).toBe("--:--:--");
    });
  });

  describe("splitShortDateTime", () => {
    it("splits YYYY-MM-DD HH:mm:ss into datePart and timePart", () => {
      const res = splitShortDateTime("2025-06-15 14:30:45");
      expect(res.datePart).toBe("06/15");
      expect(res.timePart).toBe("14:30:45");
    });

    it("handles invalid or --:--:-- correctly", () => {
      const res = splitShortDateTime("--:--:--");
      expect(res.datePart).toBe("");
      expect(res.timePart).toBe("--:--:--");
    });
  });
});
