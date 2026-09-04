import { describe, it, expect } from "vitest";
import {
  isEconomicSpreadActive,
  getYearMonthFromMsc,
  formatYearMonthJapanese,
} from "../economicDataUtils";

describe("economicDataUtils", () => {
  describe("getYearMonthFromMsc", () => {
    it("仮想時刻msからYYYY-MM形式の年月文字列を返す", () => {
      const msc = Date.UTC(2025, 6, 1, 12, 0, 0); // 2025-07
      expect(getYearMonthFromMsc(msc)).toBe("2025-07");
    });

    it("無効なタイムスタンプの場合は空文字を返す", () => {
      expect(getYearMonthFromMsc(0)).toBe("");
      expect(getYearMonthFromMsc(-100)).toBe("");
    });
  });

  describe("isEconomicSpreadActive", () => {
    it("指定年月のデータが存在する場合にtrueを返す", () => {
      const msc = Date.UTC(2025, 6, 1, 12, 0, 0); // 2025-07
      const map = {
        "2025-06": true,
        "2025-07": true,
        "2025-08": false,
      };
      expect(isEconomicSpreadActive(msc, map)).toBe(true);
    });

    it("指定年月のデータが存在しない場合にfalseを返す", () => {
      const msc = Date.UTC(2025, 7, 1, 12, 0, 0); // 2025-08
      const map = {
        "2025-06": true,
        "2025-07": true,
        "2025-08": false,
      };
      expect(isEconomicSpreadActive(msc, map)).toBe(false);
    });

    it("マップに指定年月がない場合、マップ内のいずれかがtrueならtrueを返す", () => {
      const msc = Date.UTC(2025, 9, 1, 12, 0, 0); // 2025-10 (未登録)
      const map = {
        "2025-06": false,
        "2025-07": true,
      };
      expect(isEconomicSpreadActive(msc, map)).toBe(true);
    });

    it("マップがすべてfalseの場合はfalseを返す", () => {
      const msc = Date.UTC(2025, 9, 1, 12, 0, 0);
      const map = {
        "2025-06": false,
        "2025-07": false,
      };
      expect(isEconomicSpreadActive(msc, map)).toBe(false);
    });
  });

  describe("formatYearMonthJapanese", () => {
    it("YYYY-MM形式を日本語表記にフォーマットする", () => {
      expect(formatYearMonthJapanese("2025-07")).toBe("2025年07月");
    });

    it("不正な文字列の場合はそのまま返す", () => {
      expect(formatYearMonthJapanese("")).toBe("");
      expect(formatYearMonthJapanese("invalid")).toBe("invalid");
    });
  });
});
