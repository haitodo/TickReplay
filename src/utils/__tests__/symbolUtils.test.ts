import { describe, it, expect } from "vitest";
import {
  isReplaySymbol,
  parseSymbolName,
  groupSymbolsByCategory,
  getCompanionSymbols,
  switchSymbolSuffix,
  getDualFeedCandidates,
  getAllBrokers,
  getAllYears,
  isJpyPair,
  isUsdStraight,
  isEuroCross
} from "../symbolUtils";

describe("symbolUtils", () => {
  describe("isReplaySymbol", () => {
    it("Replay単体および_Replayサフィックス付きシンボルを判定すること", () => {
      expect(isReplaySymbol("Replay")).toBe(true);
      expect(isReplaySymbol("replay")).toBe(true);
      expect(isReplaySymbol("REPLAY")).toBe(true);
      expect(isReplaySymbol("USDJPY_Replay")).toBe(true);
      expect(isReplaySymbol("USDJPY_replay")).toBe(true);
      expect(isReplaySymbol("EURUSD.replay")).toBe(true);

      // 通常シンボル
      expect(isReplaySymbol("USDJPY")).toBe(false);
      expect(isReplaySymbol("USDJPY_2024")).toBe(false);
      expect(isReplaySymbol("EURJPY_Custom")).toBe(false);
      expect(isReplaySymbol("")).toBe(false);
    });
  });

  describe("parseSymbolName", () => {
    it("年付きサフィックスを正しくパースすること (e.g. USDJPY_2016)", () => {
      const res = parseSymbolName("USDJPY_2016");
      expect(res.basePair).toBe("USDJPY");
      expect(res.suffix).toBe("2016");
      expect(res.isYear).toBe(true);
      expect(res.category).toBe("2016");
    });

    it("独自タグサフィックスを正しくパースすること (e.g. EURJPY_test)", () => {
      const res = parseSymbolName("EURJPY_test");
      expect(res.basePair).toBe("EURJPY");
      expect(res.suffix).toBe("test");
      expect(res.isYear).toBe(false);
      expect(res.category).toBe("test");
    });

    it("Customサフィックスを正しくパースすること (e.g. GBPJPY_Custom)", () => {
      const res = parseSymbolName("GBPJPY_Custom");
      expect(res.basePair).toBe("GBPJPY");
      expect(res.suffix).toBe("Custom");
      expect(res.isYear).toBe(false);
      expect(res.category).toBe("Custom");
    });

    it("ドットサフィックスを正しくパースすること (e.g. USDJPY.oj5k)", () => {
      const res = parseSymbolName("USDJPY.oj5k");
      expect(res.basePair).toBe("USDJPY");
      expect(res.suffix).toBe("oj5k");
      expect(res.isYear).toBe(false);
      expect(res.category).toBe("oj5k");
    });

    it("サフィックスなしの標準シンボルを正しくパースすること (e.g. USDJPY)", () => {
      const res = parseSymbolName("USDJPY");
      expect(res.basePair).toBe("USDJPY");
      expect(res.suffix).toBe("");
      expect(res.isYear).toBe(false);
      expect(res.category).toBe("Standard");
    });
  });

  describe("groupSymbolsByCategory", () => {
    it("年別、カスタムタグ別、通常別に正しく分類し、Replay関連シンボルを除外すること", () => {
      const symbols = [
        "USDJPY_2016",
        "EURJPY_2016",
        "USDJPY_2017",
        "EURJPY_test",
        "GBPJPY_test",
        "USDJPY_Custom",
        "USDJPY",
        "EURUSD",
        "Replay",
        "USDJPY_Replay",
        "EURJPY_replay"
      ];

      const grouped = groupSymbolsByCategory(symbols);

      expect(grouped.years).toEqual(["2017", "2016"]); // 降順
      expect(grouped.tags).toEqual(["Custom", "test"]); // アルファベット順（Replayは除外される）
      expect(grouped.hasStandard).toBe(true);

      expect(grouped.categories["2016"].map(s => s.name)).toEqual(["USDJPY_2016", "EURJPY_2016"]);
      expect(grouped.categories["test"].map(s => s.name)).toEqual(["EURJPY_test", "GBPJPY_test"]);
      expect(grouped.categories["Standard"].map(s => s.name)).toEqual(["USDJPY", "EURUSD"]);
      expect(grouped.categories["Replay"]).toBeUndefined();
    });
  });

  describe("getCompanionSymbols", () => {
    it("同一サフィックスの他通貨ペアを取得すること", () => {
      const allSymbols = [
        "USDJPY_2016",
        "EURJPY_2016",
        "GBPJPY_2016",
        "AUDJPY_2016",
        "USDJPY_2017",
        "EURJPY_2017",
        "USDJPY_test",
        "USDJPY",
        "USDJPY_Replay"
      ];

      const companions = getCompanionSymbols("USDJPY_2016", allSymbols, ["EURJPY_2016"]);
      expect(companions).toEqual(["GBPJPY_2016", "AUDJPY_2016"]);
    });

    it("同一独自タグ (test) の他通貨ペアを取得すること", () => {
      const allSymbols = [
        "USDJPY_test",
        "EURJPY_test",
        "GBPJPY_test",
        "USDJPY_2016"
      ];

      const companions = getCompanionSymbols("USDJPY_test", allSymbols);
      expect(companions).toEqual(["EURJPY_test", "GBPJPY_test"]);
    });

    it("サフィックスのない標準銘柄の場合は空配列を返すこと（デフォルト画面での横伸び防止）", () => {
      const allSymbols = [
        "USDJPY",
        "EURUSD",
        "GBPJPY",
        "USDJPY_2016"
      ];

      const companions = getCompanionSymbols("USDJPY", allSymbols);
      expect(companions).toEqual([]);
    });

    it("リプレイシンボルをソースに指定した場合は空配列を返すこと", () => {
      const allSymbols = ["USDJPY_Replay", "EURJPY_Replay", "USDJPY_2016"];
      expect(getCompanionSymbols("USDJPY_Replay", allSymbols)).toEqual([]);
    });
  });

  describe("switchSymbolSuffix", () => {
    it("同期通貨リストのサフィックスを新しいものに置換すること", () => {
      const allSymbols = [
        "USDJPY_2016", "EURJPY_2016", "GBPJPY_2016",
        "USDJPY_2017", "EURJPY_2017", "GBPJPY_2017"
      ];

      const switched = switchSymbolSuffix(
        ["EURJPY_2016", "GBPJPY_2016"],
        "2016",
        "2017",
        allSymbols
      );

      expect(switched).toEqual(["EURJPY_2017", "GBPJPY_2017"]);
    });
  });

  describe("getDualFeedCandidates & getAllBrokers & getAllYears", () => {
    it("Replayシンボルを除外して候補を抽出すること", () => {
      const symbols = [
        "USDJPY_OANDA_2024",
        "USDJPY_TITAN_2024",
        "USDJPY_Replay",
        "Replay"
      ];

      const candidates = getDualFeedCandidates(symbols);
      expect(candidates.length).toBe(1);
      expect(candidates[0].basePair).toBe("USDJPY");
      expect(candidates[0].brokers.map(b => b.broker)).toEqual(["OANDA", "TITAN"]);

      const brokers = getAllBrokers(symbols);
      expect(brokers).toEqual(["OANDA", "TITAN"]);

      const years = getAllYears(symbols);
      expect(years).toEqual(["2024"]);
    });
  });

  describe("通貨判定ヘルパー", () => {
    it("JPYクロス判定", () => {
      expect(isJpyPair("USDJPY_2016")).toBe(true);
      expect(isJpyPair("EURJPY")).toBe(true);
      expect(isJpyPair("EURUSD_2016")).toBe(false);
    });

    it("ドルストレート判定", () => {
      expect(isUsdStraight("EURUSD_2016")).toBe(true);
      expect(isUsdStraight("GBPUSD")).toBe(true);
      expect(isUsdStraight("USDJPY_2016")).toBe(false); // JPY含むものは除外
    });

    it("ユーロクロス判定", () => {
      expect(isEuroCross("EURGBP_2016")).toBe(true);
      expect(isEuroCross("EURCHF")).toBe(true);
      expect(isEuroCross("EURUSD_2016")).toBe(false); // USD含むものは除外
      expect(isEuroCross("EURJPY")).toBe(false); // JPY含むものは除外
    });
  });
});
