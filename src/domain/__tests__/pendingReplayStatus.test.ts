import { describe, expect, it } from "vitest";
import { isReplaySessionStart, mergePendingReplayStatus, type PendingReplayStatus } from "../pendingReplayStatus";
import type { ExecutionAuditRecord, ReplayProgressPayload } from "../../types/replay";
import type { TradeHistoryItem } from "../../types/trading";

const history: TradeHistoryItem[] = [{
  ticket: 1, symbol: "EURUSD.cl", type: "BUY", volume: 0.1,
  open_price: 1.1, open_time: 1000, open_time_msc: 1_000_000,
  close_price: 1.101, close_time: 1100, close_time_msc: 1_100_000, close_reason: "TP", profit: 10,
}];
const audits: ExecutionAuditRecord[] = [{
  ticket: 1, symbol: "EURUSD.cl", side: "BUY", volume: 0.1,
  click_time_msc: 1_000_000, fill_time_msc: 1_000_030,
  latency_ms: 30, request_price: 1.1, fill_price: 1.1001, slippage_pips: 1,
}];
const frame = (overrides: Partial<ReplayProgressPayload> = {}): ReplayProgressPayload => ({
  status: "ACTIVE", current_idx: 10, seek_epoch: 2, history_revision: 3, trade_revision: 4,
  ...overrides,
});

describe("mergePendingReplayStatus", () => {
  it("retains unpainted history and audits through many hidden-window frames", () => {
    let pending: PendingReplayStatus = frame({ history, execution_audits: audits });
    for (let i = 0; i < 500; i++) {
      pending = mergePendingReplayStatus(pending, frame({ current_idx: i + 11, bid: i }));
    }
    expect(pending.current_idx).toBe(510);
    expect(pending.bid).toBe(499);
    expect(pending.history).toBe(history);
    expect(pending.execution_audits).toBe(audits);
  });

  it("replaces full history snapshots instead of duplicating their rows", () => {
    const newer = [...history, { ...history[0], ticket: 2 }];
    const pending = mergePendingReplayStatus(frame({ history }), frame({ history: newer, history_revision: 4 }));
    const latest = mergePendingReplayStatus(pending, frame({ history_revision: 4 }));
    expect(latest.history).toBe(newer);
    expect(latest.history).toHaveLength(2);
  });

  it("keeps explicit empty history and audit clears until the next paint", () => {
    const pending = mergePendingReplayStatus(frame({ history, execution_audits: audits }), frame({
      history_revision: 4, trade_revision: 5, history: [], execution_audits: [],
    }));
    expect(mergePendingReplayStatus(pending, frame({ history_revision: 4, trade_revision: 5 }))).toMatchObject({
      history: [], execution_audits: [],
    });
  });

  it("does not attach a snapshot to a different revision", () => {
    const next = mergePendingReplayStatus(frame({ history, execution_audits: audits }), frame({
      history_revision: 4, trade_revision: 5,
    }));
    expect(next.history).toBeUndefined();
    expect(next.execution_audits).toBeUndefined();
  });

  it.each(["CONNECTED", "DISCONNECTED", "TERMINATE"] as const)("drops the pending session at %s", (status) => {
    const boundary = mergePendingReplayStatus(frame({ history, execution_audits: audits }), { status });
    const latest = mergePendingReplayStatus(boundary, frame());
    expect(latest.history).toBeUndefined();
    expect(latest.execution_audits).toBeUndefined();
  });

  it("does not reuse the previous session when its new READY reuses revision numbers", () => {
    const initial = mergePendingReplayStatus(frame({ history, execution_audits: audits }), frame({
      status: "READY", current_idx: 0, history: [], positions: [], message: "Replay Core v2 初期化完了",
    }));
    const latest = mergePendingReplayStatus(initial, frame({ current_idx: 1 }));
    expect(latest.history).toEqual([]);
    expect(latest.execution_audits).toBeUndefined();
    // The renderer must still reset its applied revision if READY was coalesced away.
    expect(isReplaySessionStart(latest)).toBe(true);
  });

  it("keeps the same history revision across a forward seek before painting", () => {
    const latest = mergePendingReplayStatus(frame({ history }), frame({ seek_epoch: 3 }));
    expect(latest.history).toBe(history);
  });

  it("does not carry pre-seek history when a backward seek changed the revision", () => {
    const latest = mergePendingReplayStatus(frame({ history }), frame({ seek_epoch: 3, history_revision: 4 }));
    expect(latest.history).toBeUndefined();
  });

  it("does not carry history across a reset epoch or reset revision", () => {
    for (const reset of [frame({ seek_epoch: 1 }), frame({ history_revision: 1 }), frame({ trade_revision: 1 })]) {
      const latest = mergePendingReplayStatus(frame({ history, execution_audits: audits }), reset);
      expect(latest.history).toBeUndefined();
      expect(latest.execution_audits).toBeUndefined();
    }
  });

  it("does not carry history into another symbol or an incompatible source without epoch metadata", () => {
    expect(mergePendingReplayStatus(frame({ history, source_symbol: "EURUSD" }), frame({ source_symbol: "USDJPY" })).history).toBeUndefined();
    expect(mergePendingReplayStatus(frame({ history }), frame({ seek_epoch: undefined })).history).toBeUndefined();
  });
});
