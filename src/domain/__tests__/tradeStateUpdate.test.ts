import { describe, it, expect } from "vitest";
import {
  isAccountEqual,
  arePositionsEqual,
  nextAccount,
  nextPositions,
  nextMainFeedRate,
  nextSubFeedRate,
  shouldApplyHistory,
  type SubFeedRate,
} from "../tradeStateUpdate";
import type { TradeHistoryItem, VirtualAccount, VirtualPosition } from "../../types/trading";

/**
 * 本番実装 (domain/tradeStateUpdate.ts) を直接呼び出す。
 * 期待値を計算する以外のロジックをこのファイルに書かないこと
 * (テスト側で処理を再実装すると、本番が壊れても緑のままになる)。
 */

const position = (over: Partial<VirtualPosition> = {}): VirtualPosition => ({
  ticket: 1,
  symbol: "USDJPY",
  type: "BUY",
  volume: 0.1,
  open_price: 150.0,
  open_time: 1000,
  open_time_msc: 1000,
  current_price: 150.1,
  profit: 10,
  sl: 149.0,
  tp: 151.0,
  mfe_pips: 5,
  mae_pips: 2,
  ...over,
});

const historyItem = (over: Partial<TradeHistoryItem> = {}): TradeHistoryItem => ({
  ...position(),
  close_price: 150.2,
  close_time: 2000,
  close_time_msc: 2000,
  close_reason: "MANUAL",
  ...over,
});

const account = (over: Partial<VirtualAccount> = {}): VirtualAccount => ({
  balance: 1_000_000,
  equity: 1_000_050,
  margin: 10_000,
  free_margin: 990_050,
  margin_level: 10_000.5,
  total_profit: 50,
  leverage: 25,
  ...over,
});

const activeSub = (over: Partial<SubFeedRate> = {}): SubFeedRate => ({
  active: true,
  symbol: "EURUSD",
  bid: 1.1,
  ask: 1.1002,
  spread: 2,
  ...over,
});

describe("isAccountEqual", () => {
  it("treats structurally equal accounts as equal", () => {
    expect(isAccountEqual(account(), account())).toBe(true);
  });

  it("detects a difference in each compared field", () => {
    const base = account();
    expect(isAccountEqual(base, account({ balance: 2 }))).toBe(false);
    expect(isAccountEqual(base, account({ equity: 2 }))).toBe(false);
    expect(isAccountEqual(base, account({ margin: 2 }))).toBe(false);
    expect(isAccountEqual(base, account({ free_margin: 2 }))).toBe(false);
    expect(isAccountEqual(base, account({ margin_level: 2 }))).toBe(false);
    expect(isAccountEqual(base, account({ total_profit: 2 }))).toBe(false);
    expect(isAccountEqual(base, account({ leverage: 2 }))).toBe(false);
  });

  it("compares a missing previous account as not equal", () => {
    // 元実装の `return a === b` のため、null と undefined は同一視されない。
    // ただし nextAccount は incoming が真値のときだけ等価比較を呼ぶので、
    // その組み合わせは実運用では到達しない。ここでは型上到達しうる形だけを検証する。
    expect(isAccountEqual(null, account())).toBe(false);
    expect(isAccountEqual(account(), undefined)).toBe(false);
  });
});

describe("arePositionsEqual", () => {
  it("treats structurally equal arrays as equal", () => {
    expect(arePositionsEqual([position()], [position()])).toBe(true);
  });

  it("compares empty arrays as equal", () => {
    expect(arePositionsEqual([], [])).toBe(true);
  });

  it("detects a length difference", () => {
    expect(arePositionsEqual([position()], [position(), position({ ticket: 2 })])).toBe(false);
  });

  it("detects a difference in each compared field", () => {
    const base = [position()];
    expect(arePositionsEqual(base, [position({ ticket: 9 })])).toBe(false);
    expect(arePositionsEqual(base, [position({ type: "SELL" })])).toBe(false);
    expect(arePositionsEqual(base, [position({ volume: 0.2 })])).toBe(false);
    expect(arePositionsEqual(base, [position({ open_price: 1 })])).toBe(false);
    expect(arePositionsEqual(base, [position({ current_price: 1 })])).toBe(false);
    expect(arePositionsEqual(base, [position({ profit: 1 })])).toBe(false);
    expect(arePositionsEqual(base, [position({ sl: 1 })])).toBe(false);
    expect(arePositionsEqual(base, [position({ tp: 1 })])).toBe(false);
    expect(arePositionsEqual(base, [position({ mfe_pips: 1 })])).toBe(false);
    expect(arePositionsEqual(base, [position({ mae_pips: 1 })])).toBe(false);
  });

  it("compares missing sides by identity", () => {
    expect(arePositionsEqual(undefined, undefined)).toBe(true);
    expect(arePositionsEqual([position()], undefined)).toBe(false);
    expect(arePositionsEqual(undefined, [position()])).toBe(false);
  });
});

describe("nextAccount", () => {
  it("keeps the previous account when the payload omits it", () => {
    const prev = account();
    expect(nextAccount(prev, undefined)).toBe(prev);
  });

  it("keeps the previous account reference when the incoming account is equal", () => {
    const prev = account();
    expect(nextAccount(prev, account())).toBe(prev);
  });

  it("returns the incoming account when it differs", () => {
    const prev = account();
    const incoming = account({ balance: 2 });
    expect(nextAccount(prev, incoming)).toBe(incoming);
  });

  it("does not clear the account when the payload carries null at runtime", () => {
    // JSON の null は undefined として型付けられていないが実行時には届く。
    // 口座のクリアは DISCONNECTED 分岐だけが行う。
    const prev = account();
    expect(nextAccount(prev, null as unknown as undefined)).toBe(prev);
  });
});

describe("nextPositions", () => {
  it("keeps the previous positions when the payload omits them", () => {
    const prev = [position()];
    expect(nextPositions(prev, undefined)).toBe(prev);
  });

  it("keeps the previous reference when the positions are equal", () => {
    const prev = [position()];
    expect(nextPositions(prev, [position()])).toBe(prev);
  });

  it("applies an empty array as an empty array", () => {
    const prev = [position()];
    const result = nextPositions(prev, []);
    expect(result).toEqual([]);
    expect(result).not.toBe(prev);
  });

  it("reflects 0 values in a position", () => {
    const prev = [position({ profit: 10, current_price: 150.1 })];
    const incoming = [position({ profit: 0, current_price: 0 })];
    expect(nextPositions(prev, incoming)).toBe(incoming);
  });

  it("returns the incoming array when it differs", () => {
    const prev = [position()];
    const incoming = [position({ ticket: 3 })];
    expect(nextPositions(prev, incoming)).toBe(incoming);
  });
});

describe("nextMainFeedRate", () => {
  const prev = { bid: 150.0, ask: 150.02, spread: 2 };

  it("does not update when only bid is present", () => {
    expect(nextMainFeedRate(prev, { bid: 151 })).toBe(prev);
  });

  it("does not update when only ask is present", () => {
    expect(nextMainFeedRate(prev, { ask: 151 })).toBe(prev);
  });

  it("does not update when both are absent", () => {
    expect(nextMainFeedRate(prev, {})).toBe(prev);
  });

  it("treats an omitted spread as 0", () => {
    expect(nextMainFeedRate(prev, { bid: 1, ask: 2 })).toEqual({ bid: 1, ask: 2, spread: 0 });
  });

  it("reflects 0 as a real value", () => {
    expect(nextMainFeedRate(prev, { bid: 0, ask: 0, spread: 0 })).toEqual({
      bid: 0,
      ask: 0,
      spread: 0,
    });
  });

  it("keeps the previous reference when nothing changed", () => {
    expect(nextMainFeedRate(prev, { bid: 150.0, ask: 150.02, spread: 2 })).toBe(prev);
  });
});

describe("nextSubFeedRate", () => {
  it("clears when dual_feed is false", () => {
    expect(nextSubFeedRate(activeSub(), { dual_feed: false })).toBeNull();
  });

  it("clears when dual_feed is omitted", () => {
    expect(nextSubFeedRate(activeSub(), {})).toBeNull();
  });

  it("stays null when already null and dual_feed is false", () => {
    expect(nextSubFeedRate(null, { dual_feed: false })).toBeNull();
  });

  it("activates with defaults when the optional fields are missing", () => {
    expect(nextSubFeedRate(null, { dual_feed: true })).toEqual({
      active: true,
      symbol: "",
      bid: 0,
      ask: 0,
      spread: 0,
    });
  });

  it("keeps the previous reference when nothing changed", () => {
    const prev = activeSub();
    expect(
      nextSubFeedRate(prev, {
        dual_feed: true,
        sub_symbol: "EURUSD",
        sub_bid: 1.1,
        sub_ask: 1.1002,
        sub_spread: 2,
      })
    ).toBe(prev);
  });

  it("reflects 0 for sub_bid and sub_ask", () => {
    const result = nextSubFeedRate(activeSub(), {
      dual_feed: true,
      sub_symbol: "EURUSD",
      sub_bid: 0,
      sub_ask: 0,
      sub_spread: 0,
    });
    expect(result).toEqual({ active: true, symbol: "EURUSD", bid: 0, ask: 0, spread: 0 });
  });
});

describe("shouldApplyHistory", () => {
  it("does not apply when the history is omitted (revision stays untouched)", () => {
    expect(shouldApplyHistory(undefined, 7, 5)).toBe(false);
  });

  it("does not apply when the history is omitted even without a revision", () => {
    expect(shouldApplyHistory(undefined, undefined, undefined)).toBe(false);
  });

  it("applies when the revision is omitted", () => {
    expect(shouldApplyHistory([historyItem()], undefined, 5)).toBe(true);
  });

  it("does not apply when the revision is unchanged", () => {
    expect(shouldApplyHistory([historyItem()], 5, 5)).toBe(false);
  });

  it("applies when the revision changed", () => {
    expect(shouldApplyHistory([historyItem()], 6, 5)).toBe(true);
  });

  it("applies an empty history array", () => {
    expect(shouldApplyHistory([], 6, 5)).toBe(true);
  });

  it("does not apply an empty history array at the same revision", () => {
    expect(shouldApplyHistory([], 5, 5)).toBe(false);
  });
});
