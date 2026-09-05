import { describe, it, expect } from "vitest";
import {
  isReplaySymbol,
  parseSymbolName,
  groupSymbolsByCategory,
  getCompanionSymbols,
  getAllCompanionsForSource,
  switchSymbolSuffix,
  getDualFeedCandidates,
  getAllBrokers,
  getAllYears,
  isJpyPair,
  isUsdStraight,
  isEuroCross,
  isOandaBroker,
  isDucascopyBroker,
  sortBrokersForDualFeed,
  findDefaultDualFeedPair,
  findMatchingSymbolForYear,
  checkSymbolYearMismatch,
  formatCompactDualSymbolName
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

  describe("getAllCompanionsForSource", () => {
    it("同業者・同年度の全関連シンボルを取得すること（自身は除外）", () => {
      const allSymbols = [
        "USDJPY_OANDA_2016",
        "EURJPY_OANDA_2016",
        "GBPJPY_OANDA_2016",
        "EURUSD_OANDA_2016",
        "USDJPY_DUCASCOPY_2016",
        "EURJPY_DUCASCOPY_2016",
        "USDJPY_OANDA_2017",
        "EURJPY_OANDA_2017"
      ];

      const companions = getAllCompanionsForSource("USDJPY_OANDA_2016", allSymbols);
      expect(companions.map(s => s.name)).toEqual([
        "EURJPY_OANDA_2016",
        "GBPJPY_OANDA_2016",
        "EURUSD_OANDA_2016"
      ]);
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

    it("ブローカー付きサフィックスを新しいブローカーに置換すること", () => {
      const allSymbols = [
        "EURJPY_OANDA_2016", "GBPJPY_OANDA_2016",
        "EURJPY_DUCASCOPY_2016", "GBPJPY_DUCASCOPY_2016"
      ];

      const switched = switchSymbolSuffix(
        ["EURJPY_OANDA_2016", "GBPJPY_OANDA_2016"],
        "OANDA_2016",
        "DUCASCOPY_2016",
        allSymbols
      );

      expect(switched).toEqual(["EURJPY_DUCASCOPY_2016", "GBPJPY_DUCASCOPY_2016"]);
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

  describe("デュアルフィード優先度 (OANDA = Main, DUCASCOPY = Sub)", () => {
    it("OANDA / DUCASCOPY ブローカー判定", () => {
      expect(isOandaBroker("OANDA")).toBe(true);
      expect(isOandaBroker("oanda")).toBe(true);
      expect(isOandaBroker("USDJPY_OANDA_2024")).toBe(true);
      expect(isOandaBroker("TITAN")).toBe(false);

      expect(isDucascopyBroker("DUCASCOPY")).toBe(true);
      expect(isDucascopyBroker("DUKASCOPY")).toBe(true);
      expect(isDucascopyBroker("ducascopy")).toBe(true);
      expect(isDucascopyBroker("dukascopy")).toBe(true);
      expect(isDucascopyBroker("USDJPY_DUCASCOPY_2024")).toBe(true);
      expect(isDucascopyBroker("OANDA")).toBe(false);
    });

    it("sortBrokersForDualFeed で OANDA が先頭（Main）、DUCASCOPY が2番目（Sub）にソートされること", () => {
      const dummyItem = { name: "", source_type: "custom" as const, group_name: "" };
      const rawBrokers = [
        { broker: "DUCASCOPY", symbolName: "USDJPY_DUCASCOPY_2024", item: dummyItem },
        { broker: "TITAN", symbolName: "USDJPY_TITAN_2024", item: dummyItem },
        { broker: "OANDA", symbolName: "USDJPY_OANDA_2024", item: dummyItem }
      ];

      const sorted = sortBrokersForDualFeed(rawBrokers);
      expect(sorted[0].broker).toBe("OANDA");
      expect(sorted[1].broker).toBe("DUCASCOPY");
      expect(sorted[2].broker).toBe("TITAN");
    });

    it("getDualFeedCandidates でブローカーが OANDA(Main) / DUCASCOPY(Sub) 順に並ぶこと", () => {
      const symbols = [
        "USDJPY_DUCASCOPY_2024",
        "USDJPY_OANDA_2024",
        "USDJPY_TITAN_2024"
      ];

      const candidates = getDualFeedCandidates(symbols);
      expect(candidates.length).toBe(1);
      expect(candidates[0].brokers.map(b => b.broker)).toEqual(["OANDA", "DUCASCOPY", "TITAN"]);
      expect(candidates[0].brokers[0].symbolName).toBe("USDJPY_OANDA_2024");
      expect(candidates[0].brokers[1].symbolName).toBe("USDJPY_DUCASCOPY_2024");
    });

    it("findDefaultDualFeedPair で現在のシンボルに応じた OANDA(Main) / DUCASCOPY(Sub) を検出すること", () => {
      const symbols = [
        "EURUSD_DUCASCOPY_2016",
        "EURUSD_OANDA_2016",
        "USDJPY_DUCASCOPY_2024",
        "USDJPY_OANDA_2024",
        "GBPJPY_TITAN_2024",
        "GBPJPY_OANDA_2024"
      ];

      // 1. USDJPY_2024 が指定されている場合
      const res1 = findDefaultDualFeedPair(symbols, "USDJPY_2024");
      expect(res1).toEqual({
        mainSymbol: "USDJPY_OANDA_2024",
        subSymbol: "USDJPY_DUCASCOPY_2024"
      });

      // 2. EURUSD_OANDA_2016 が指定されている場合
      const res2 = findDefaultDualFeedPair(symbols, "EURUSD_OANDA_2016");
      expect(res2).toEqual({
        mainSymbol: "EURUSD_OANDA_2016",
        subSymbol: "EURUSD_DUCASCOPY_2016"
      });

      // 3. 現在シンボルが未指定または標準シンボルの場合、USDJPYの OANDA/DUCASCOPY を優先
      const res3 = findDefaultDualFeedPair(symbols, "USDJPY");
      expect(res3).toEqual({
        mainSymbol: "USDJPY_OANDA_2024",
        subSymbol: "USDJPY_DUCASCOPY_2024"
      });
    });
  });

  describe("findMatchingSymbolForYear", () => {
    it("同一通貨ペア・同一ブローカーの対象年度シンボルを検索すること", () => {
      const symbols = [
        "USDJPY_OANDA_2024",
        "USDJPY_OANDA_2023",
        "USDJPY_DUCASCOPY_2023",
        "EURUSD_OANDA_2023"
      ];

      const match = findMatchingSymbolForYear("USDJPY_OANDA_2024", "2023", symbols);
      expect(match).toBe("USDJPY_OANDA_2023");
    });

    it("ブローカーなしシンボルで対象年度シンボルを検索すること", () => {
      const symbols = [
        "USDJPY_2024",
        "USDJPY_2023",
        "EURUSD_2023"
      ];

      const match = findMatchingSymbolForYear("USDJPY_2024", "2023", symbols);
      expect(match).toBe("USDJPY_2023");
    });

    it("該当する年度シンボルが存在しない場合は null を返すこと", () => {
      const symbols = [
        "USDJPY_2024",
        "EURUSD_2023"
      ];

      const match = findMatchingSymbolForYear("USDJPY_2024", "2020", symbols);
      expect(match).toBeNull();
    });
  });

  describe("checkSymbolYearMismatch", () => {
    it("シンボル年度と日付年度が一致している場合は hasMismatch: false を返すこと", () => {
      const res = checkSymbolYearMismatch("USDJPY_2024", "2024-05-01 00:00:00");
      expect(res.hasMismatch).toBe(false);
      expect(res.symbolYear).toBe("2024");
      expect(res.dateYear).toBe(2024);
    });

    it("シンボル年度と日付年度が異なる場合は hasMismatch: true を返すこと", () => {
      const res = checkSymbolYearMismatch("USDJPY_2024", "2026-05-01 00:00:00");
      expect(res.hasMismatch).toBe(true);
      expect(res.symbolYear).toBe("2024");
      expect(res.dateYear).toBe(2026);
    });

    it("シンボルに年度が含まれない場合は hasMismatch: false を返すこと", () => {
      const res = checkSymbolYearMismatch("USDJPY", "2026-05-01 00:00:00");
      expect(res.hasMismatch).toBe(false);
      expect(res.symbolYear).toBeUndefined();
      expect(res.dateYear).toBe(2026);
    });
  });

  describe("formatCompactDualSymbolName", () => {
    it("末尾に年度サフィックスがある場合は年度を除去してコンパクト化すること", () => {
      expect(formatCompactDualSymbolName("USDJPY_DUCASCOPY_2024")).toBe("USDJPY_DUCASCOPY");
      expect(formatCompactDualSymbolName("USDJPY_OANDA_2024")).toBe("USDJPY_OANDA");
      expect(formatCompactDualSymbolName("EURUSD_DUCASCOPY_2016")).toBe("EURUSD_DUCASCOPY");
    });

    it("年度のみのサフィックスの場合はベースペア名を維持すること", () => {
      expect(formatCompactDualSymbolName("USDJPY_2024")).toBe("USDJPY");
    });

    it("年度が含まれないシンボル名はそのままであること", () => {
      expect(formatCompactDualSymbolName("USDJPY")).toBe("USDJPY");
      expect(formatCompactDualSymbolName("USDJPY_RAW")).toBe("USDJPY_RAW");
    });

    it("空文字またはnullライクの場合は(未選択)を返すこと", () => {
      expect(formatCompactDualSymbolName("")).toBe("(未選択)");
      expect(formatCompactDualSymbolName("   ")).toBe("(未選択)");
    });
  });
});

