import { describe, it, expect } from "vitest";
import { parseDateTimeStr, formatDateTimeStr } from "../dateUtils";

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
});
