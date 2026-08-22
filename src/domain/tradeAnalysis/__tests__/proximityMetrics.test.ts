import { describe, it, expect } from "vitest";
import { calculateProximityComparisonStats } from "../tradeMetrics";
import { TradeRecord } from "../types";

describe("Trade Analysis Proximity Comparison Metrics", () => {
  it("should handle empty trade list or unlinked trades gracefully", () => {
    const res = calculateProximityComparisonStats([]);
    expect(res.regularTrades.count).toBe(0);
    expect(res.nearNewsTrades.count).toBe(0);
    expect(res.advice).toContain("指標近接フラグの付与された取引がありません");
  });

  it("should accurately compare regular trades vs near-news trades and provide advice", () => {
    const mockTrades: TradeRecord[] = [
      // Regular wins (2 wins, 0 loss) -> 100% win rate
      {
        id: "1",
        ticket: "101",
        source: "gmo",
        sourceName: "GMO",
        symbol: "USDJPY",
        type: "BUY",
        lots: 0.1,
        open_time: "2026-05-01 10:00:00",
        open_time_msc: 1777600000000,
        open_price: 155.0,
        close_time: "2026-05-01 10:05:00",
        close_time_msc: 1777600300000,
        close_price: 155.2,
        profit: 2000,
        pips: 20.0,
        durationSec: 300,
        hourJst: 10,
        dayJst: 5,
        isNearNews: false
      },
      {
        id: "2",
        ticket: "102",
        source: "gmo",
        sourceName: "GMO",
        symbol: "USDJPY",
        type: "BUY",
        lots: 0.1,
        open_time: "2026-05-01 11:00:00",
        open_time_msc: 1777603600000,
        open_price: 155.1,
        close_time: "2026-05-01 11:05:00",
        close_time_msc: 1777603900000,
        close_price: 155.3,
        profit: 2000,
        pips: 20.0,
        durationSec: 300,
        hourJst: 11,
        dayJst: 5,
        isNearNews: false
      },
      // Near News losses (0 wins, 2 losses) -> 0% win rate
      {
        id: "3",
        ticket: "103",
        source: "gmo",
        sourceName: "GMO",
        symbol: "USDJPY",
        type: "BUY",
        lots: 0.1,
        open_time: "2026-05-01 21:30:10",
        open_time_msc: 1777641410000,
        open_price: 155.5,
        close_time: "2026-05-01 21:32:00",
        close_time_msc: 1777641520000,
        close_price: 155.0,
        profit: -5000,
        pips: -50.0,
        durationSec: 110,
        hourJst: 21,
        dayJst: 5,
        isNearNews: true,
        nearNewsEvent: "米・非農業部門雇用者数",
        nearNewsTimeDiffSec: 10,
        nearNewsImportance: "High"
      },
      {
        id: "4",
        ticket: "104",
        source: "gmo",
        sourceName: "GMO",
        symbol: "USDJPY",
        type: "BUY",
        lots: 0.1,
        open_time: "2026-05-01 21:34:00",
        open_time_msc: 1777641640000,
        open_price: 155.2,
        close_time: "2026-05-01 21:36:00",
        close_time_msc: 1777641760000,
        close_price: 154.8,
        profit: -4000,
        pips: -40.0,
        durationSec: 120,
        hourJst: 21,
        dayJst: 5,
        isNearNews: true,
        nearNewsEvent: "米・非農業部門雇用者数",
        nearNewsTimeDiffSec: 240,
        nearNewsImportance: "High"
      }
    ];

    const stats = calculateProximityComparisonStats(mockTrades);
    expect(stats.regularTrades.count).toBe(2);
    expect(stats.regularTrades.winRate).toBe(100);
    expect(stats.regularTrades.totalProfit).toBe(4000);

    expect(stats.nearNewsTrades.count).toBe(2);
    expect(stats.nearNewsTrades.winRate).toBe(0);
    expect(stats.nearNewsTrades.totalProfit).toBe(-9000);
    expect(stats.nearNewsTrades.profitFactor).toBe(0);

    expect(stats.winRateDiff).toBe(-100);
    expect(stats.advice).toContain("エントリー自粛を強く推奨します");
  });
});
