import { describe, it, expect } from "vitest";
import {
  parseCsvRows,
  parseTradeDateTime,
  calculatePips,
  detectBrokerType,
  parseBrokerTradeCsv
} from "../csvParsers";
import {
  calculateTradeStats,
  calculateHoldingDistribution,
  calculateEquityCurve
} from "../tradeMetrics";
import { TradeRecord } from "../types";

describe("Trade Analysis CSV Parsers", () => {
  it("should correctly parse CSV rows with quotes and escaped commas", () => {
    const csv = `Ticket,Symbol,Comment\n12345,"USD/JPY","Scalp, quick win"\n12346,"EUR/USD","Normal trade"`;
    const rows = parseCsvRows(csv);
    expect(rows.length).toBe(3);
    expect(rows[1][0]).toBe("12345");
    expect(rows[1][1]).toBe("USD/JPY");
    expect(rows[1][2]).toBe("Scalp, quick win");
  });

  it("should parse trade datetime strings into JST/UTC msc", () => {
    const res = parseTradeDateTime("2026-05-01 15:30:00");
    expect(res.formatted).toBe("2026-05-01 15:30:00");
    expect(res.hourJst).toBe(15);
    expect(res.msc).toBeGreaterThan(0);

    const resSlash = parseTradeDateTime("2026/05/01 09:00:00");
    expect(resSlash.formatted).toBe("2026-05-01 09:00:00");
    expect(resSlash.hourJst).toBe(9);
  });

  it("should accurately calculate pips for JPY and non-JPY pairs", () => {
    // USDJPY BUY: 155.100 -> 155.250 (+15.0 pips)
    expect(calculatePips("USDJPY", "BUY", 155.100, 155.250)).toBe(15.0);
    // USDJPY SELL: 155.250 -> 155.100 (+15.0 pips)
    expect(calculatePips("USDJPY", "SELL", 155.250, 155.100)).toBe(15.0);

    // EURUSD BUY: 1.08500 -> 1.08550 (+5.0 pips)
    expect(calculatePips("EURUSD", "BUY", 1.08500, 1.08550)).toBe(5.0);
    // EURUSD SELL: 1.08500 -> 1.08560 (-6.0 pips)
    expect(calculatePips("EURUSD", "SELL", 1.08500, 1.08560)).toBe(-6.0);
  });

  it("should detect broker types from CSV headers", () => {
    expect(detectBrokerType(["注文番号", "通貨ペア", "売買", "取引区分", "約定数量", "約定レート", "実現損益"])).toBe("gmo");
    expect(detectBrokerType(["注文番号", "通貨ペア", "売買区分", "約定数量", "約定価格", "損益"])).toBe("dmm");
    expect(detectBrokerType(["約定番号", "通貨ペア", "注文種類", "数量", "約定価格", "決済損益"])).toBe("sbi");
    expect(detectBrokerType(["Ticket", "Open Time", "Type", "Size", "Item", "Price", "Close Time", "Profit"])).toBe("mt4");
    expect(detectBrokerType(["Ticket", "Position", "Open Time", "Type", "Volume", "Symbol", "Close Time", "Profit"])).toBe("mt5");
  });

  it("should parse GMO Click Securities format CSV", () => {
    const gmoCsv = `注文番号,約定日時,通貨ペア,売買,取引区分,注文タイプ,約定数量,約定レート,決済約定日時,決済約定レート,実現損益,スワップ,手数料
1001,2026/05/01 10:00:00,USD/JPY,買,新規,成行,10000,155.000,2026/05/01 10:05:00,155.200,2000,0,0
1002,2026/05/01 11:00:00,EUR/USD,売,新規,成行,10000,1.08500,2026/05/01 11:10:00,1.08400,1500,0,0`;

    const parsed = parseBrokerTradeCsv(gmoCsv, "gmo_trades.csv");
    expect(parsed.broker).toBe("gmo");
    expect(parsed.totalRecords).toBe(2);
    expect(parsed.trades[0].symbol).toBe("USDJPY");
    expect(parsed.trades[0].type).toBe("BUY");
    expect(parsed.trades[0].pips).toBe(20.0);
    expect(parsed.trades[0].profit).toBe(2000);
    expect(parsed.trades[0].durationSec).toBe(300);

    expect(parsed.trades[1].symbol).toBe("EURUSD");
    expect(parsed.trades[1].type).toBe("SELL");
    expect(parsed.trades[1].pips).toBe(10.0);
    expect(parsed.trades[1].profit).toBe(1500);
  });

  it("should parse MetaTrader 5 format CSV", () => {
    const mt5Csv = `Ticket,Open Time,Type,Volume,Symbol,Price,Close Time,Price.1,Profit
9001,2026.05.01 14:00:00,buy,0.10,USDJPY,155.500,2026.05.01 14:02:30,155.450,-500
9002,2026.05.01 15:00:00,sell,0.20,GBPJPY,195.000,2026.05.01 15:01:00,194.800,4000`;

    const parsed = parseBrokerTradeCsv(mt5Csv, "mt5_history.csv");
    expect(parsed.totalRecords).toBe(2);
    expect(parsed.trades[0].type).toBe("BUY");
    expect(parsed.trades[0].profit).toBe(-500);
    expect(parsed.trades[0].pips).toBe(-5.0);
    expect(parsed.trades[0].durationSec).toBe(150);

    expect(parsed.trades[1].type).toBe("SELL");
    expect(parsed.trades[1].profit).toBe(4000);
    expect(parsed.trades[1].pips).toBe(20.0);
    expect(parsed.trades[1].durationSec).toBe(60);
  });

  it("should calculate trade statistics and equity curve correctly", () => {
    const mockTrades: TradeRecord[] = [
      {
        id: "1",
        ticket: "101",
        source: "replay",
        sourceName: "Replay",
        symbol: "USDJPY",
        type: "BUY",
        lots: 0.1,
        open_time: "2026-05-01 10:00:00",
        open_time_msc: 1777600000000,
        open_price: 155.0,
        close_time: "2026-05-01 10:01:00",
        close_time_msc: 1777600060000,
        close_price: 155.2,
        profit: 2000,
        pips: 20.0,
        durationSec: 60,
        hourJst: 10,
        dayJst: 5
      },
      {
        id: "2",
        ticket: "102",
        source: "replay",
        sourceName: "Replay",
        symbol: "USDJPY",
        type: "SELL",
        lots: 0.1,
        open_time: "2026-05-01 10:05:00",
        open_time_msc: 1777600300000,
        open_price: 155.2,
        close_time: "2026-05-01 10:06:00",
        close_time_msc: 1777600360000,
        close_price: 155.3,
        profit: -1000,
        pips: -10.0,
        durationSec: 60,
        hourJst: 10,
        dayJst: 5
      }
    ];

    const stats = calculateTradeStats(mockTrades);
    expect(stats.totalTrades).toBe(2);
    expect(stats.wins).toBe(1);
    expect(stats.losses).toBe(1);
    expect(stats.winRate).toBe(50);
    expect(stats.totalProfit).toBe(1000);
    expect(stats.totalPips).toBe(10.0);
    expect(stats.profitFactor).toBe(2.0);
    expect(stats.expectancy).toBe(500);

    const holding = calculateHoldingDistribution(mockTrades);
    expect(holding[4].count).toBe(2); // 60s is in index 4 (1-3m: 60-180s)

    const curve = calculateEquityCurve(mockTrades);
    expect(curve.length).toBe(3);
    expect(curve[curve.length - 1].cumProfit).toBe(1000);
  });
});
