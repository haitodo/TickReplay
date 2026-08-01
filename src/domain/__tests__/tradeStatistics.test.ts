import { describe, it, expect } from "vitest";
import { calculateTradeStats, calculateAccountEquity } from "../tradeStatistics";

describe("tradeStatistics", () => {
  it("calculateTradeStats accurately computes win rate, profit factor, and total profit", () => {
    const history = [
      { profit: 10000 },
      { profit: 5000 },
      { profit: -3000 },
      { profit: -2000 }
    ];
    const stats = calculateTradeStats(history);
    expect(stats.totalTrades).toBe(4);
    expect(stats.wins).toBe(2);
    expect(stats.losses).toBe(2);
    expect(stats.winRate).toBe(50);
    expect(stats.totalProfit).toBe(10000);
    expect(stats.grossProfit).toBe(15000);
    expect(stats.grossLoss).toBe(5000);
    expect(stats.profitFactor).toBe(3.0);
  });

  it("calculateTradeStats handles empty history without errors", () => {
    const stats = calculateTradeStats([]);
    expect(stats.totalTrades).toBe(0);
    expect(stats.winRate).toBe(0);
    expect(stats.profitFactor).toBe(0);
  });

  it("calculateAccountEquity computes equity and unrealized PnL", () => {
    const balance = 1000000;
    const positions = [{ profit: 12000 }, { profit: -4000 }];
    const result = calculateAccountEquity(balance, positions);
    expect(result.unrealizedPL).toBe(8000);
    expect(result.equity).toBe(1008000);
  });
});
