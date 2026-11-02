import { describe, expect, it, vi } from "vitest";
import {
  resolveSessionTradingSettings,
  saveSessionAndFinish,
  snapshotSessionAccount,
  snapshotSessionHistory,
  snapshotSessionPosition,
  withSessionPositionSymbol,
} from "../sessionPersistence";
import type { SessionReplaySettings } from "../../types/session";
import type { TradeHistoryItem, VirtualPosition } from "../../types/trading";

describe("saveSessionAndFinish", () => {
  it("keeps the current session and dialog open when persistence fails", async () => {
    const close = vi.fn();
    const terminate = vi.fn(async () => {});
    await saveSessionAndFinish(async () => false, close, terminate);
    expect(close).not.toHaveBeenCalled();
    expect(terminate).not.toHaveBeenCalled();
  });

  it("does not terminate before an outstanding disk write has succeeded", async () => {
    let finishWrite!: (success: boolean) => void;
    const close = vi.fn();
    const terminate = vi.fn(async () => {});
    const result = saveSessionAndFinish(
      () => new Promise<boolean>((resolve) => { finishWrite = resolve; }), close, terminate,
    );
    expect(close).not.toHaveBeenCalled();
    expect(terminate).not.toHaveBeenCalled();
    finishWrite(true);
    await result;
    expect(close).toHaveBeenCalledOnce();
    expect(terminate).toHaveBeenCalledOnce();
  });

  it("keeps the session when persistence throws", async () => {
    const close = vi.fn();
    const terminate = vi.fn(async () => {});
    await expect(saveSessionAndFinish(async () => { throw new Error("disk full"); }, close, terminate)).rejects.toThrow("disk full");
    expect(close).not.toHaveBeenCalled();
    expect(terminate).not.toHaveBeenCalled();
  });

  it("allows a successful manual snapshot without terminating", async () => {
    const close = vi.fn();
    await saveSessionAndFinish(async () => true, close);
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("snapshotSessionAccount", () => {
  it("preserves an exhausted account through JSON persistence", () => {
    const account = { balance: 0, equity: 0, free_margin: 0, margin: 0, margin_level: 0 };
    const restored = JSON.parse(JSON.stringify(snapshotSessionAccount(account, 1_000_000, 25)));
    expect(restored.balance).toBe(0);
    expect(restored.equity).toBe(0);
    expect(restored.free_margin).toBe(0);
  });

  it("uses initial funds only when no account exists", () => {
    expect(snapshotSessionAccount(null, 500_000, 10)).toMatchObject({
      balance: 500_000, equity: 500_000, free_margin: 500_000, leverage: 10,
    });
  });
});

const position: VirtualPosition = {
  ticket: 12, symbol: "EURUSD.cl", type: "BUY", volume: 0.1,
  open_price: 1.10025, open_time: 1000, open_time_msc: 1_000_000,
  current_price: 1.10035, profit: 1, sl: 1.099, tp: 1.102,
};

describe("session position symbols", () => {
  it("retains a non-JPY position symbol and exact price through save and restore", () => {
    const saved = JSON.parse(JSON.stringify(snapshotSessionPosition(position, 15)));
    const restored = withSessionPositionSymbol(saved, "USDJPY");
    expect(restored.symbol).toBe("EURUSD.cl");
    expect(restored.open_price).toBe(1.10025);
    expect(restored.accumulated_real_time).toBe(15);
  });

  it("retains the symbol and close fields in saved history", () => {
    const history: TradeHistoryItem = {
      ...position, close_price: 1.10035, close_time: 1100,
      close_time_msc: 1_100_000, close_reason: "MANUAL",
    };
    const saved = JSON.parse(JSON.stringify(snapshotSessionHistory(history, 100)));
    expect(withSessionPositionSymbol(saved, "USDJPY")).toMatchObject({
      symbol: "EURUSD.cl", close_price: 1.10035, close_time_msc: 1_100_000, close_reason: "MANUAL",
    });
  });

  it("recovers omitted symbols in old snapshots from their replay source", () => {
    const saved = snapshotSessionPosition(position, 0);
    delete saved.symbol;
    expect(withSessionPositionSymbol(saved, "EURUSD_OANDA_2025").symbol).toBe("EURUSD_OANDA_2025");
  });
});

describe("resolveSessionTradingSettings", () => {
  const defaults = { initial_balance: 1_000_000, contract_size: 10_000, leverage: 25, hedging: false };
  const settings: SessionReplaySettings = {
    selected_terminal: "terminal", selected_profile: "profile", source_symbol: "EURUSD",
    start_time: "2025-01-01 00:00:00", end_time: "2025-01-02 00:00:00", preloaded_bars: 300, auto_scroll_sync: true,
  };

  it("returns the saved contract and account settings independently of the previous session", () => {
    expect(resolveSessionTradingSettings({ settings: {
      ...settings, contract_size: 100_000, initial_balance: 300_000, leverage: 10, hedging: true,
    } }, defaults)).toEqual({ initial_balance: 300_000, contract_size: 100_000, leverage: 10, hedging: true });
  });

  it("does not replace explicit false or zero with current settings", () => {
    expect(resolveSessionTradingSettings({ settings: { ...settings, initial_balance: 0, hedging: false } }, {
      ...defaults, hedging: true,
    })).toMatchObject({ initial_balance: 0, hedging: false });
  });

  it("keeps compatibility with snapshots missing the added settings", () => {
    expect(resolveSessionTradingSettings({ settings }, defaults)).toEqual(defaults);
  });
});
