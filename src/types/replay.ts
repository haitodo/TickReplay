import { TradeHistoryItem, VirtualAccount, VirtualPosition } from "./trading";

/**
 * リプレイエンジンおよび再生制御に関連するドメイン型定義
 */

export type ReplayStatus = "DISCONNECTED" | "CONNECTED" | "READY" | "ACTIVE";

export type SpeedMode = "TEMPORAL" | "COUNT";

export type TimezoneMode = "JST" | "SERVER";

export interface TimeStepItem {
  id: string;
  seconds: number;
  label: string;
}

export interface FeedRate {
  bid: number;
  ask: number;
  spread: number;
}

export interface SubFeedRate extends FeedRate {
  active: boolean;
  symbol: string;
}

export interface SessionBoundaryItem {
  start_idx: number;
  end_idx: number;
  start_msc: number;
  end_msc: number;
  date_str: string;
  session_type: "TYO" | "LDN" | "NY";
}

export interface SessionBoundariesData {
  TYO: number[];
  LDN: number[];
  NY: number[];
}

export interface SessionBlock {
  type: "TYO" | "LDN" | "NY";
  idx: number;
  msc: number;
  dateStr: string;
}

export interface ReplayPlaybackState {
  isPlaying: boolean;
  speedMode: SpeedMode;
  multiplier: number;
  tickStep: number;
  loopActive: boolean;
  loopA: number;
  loopB: number;
  loopAIdx: number;
  loopBIdx: number;
}

export interface ReplayProgressPayload {
  status?: ReplayStatus | "ERROR";
  total_ticks?: number;
  current_idx?: number;
  virtual_time_msc?: number;
  is_playing?: boolean;
  speed_mode?: SpeedMode;
  multiplier?: number | string;
  tick_step?: number;
  history_revision?: number;
  symbol?: string;
  source_symbol?: string;
  bid?: number;
  ask?: number;
  spread?: number;
  dmm_bid?: number;
  dmm_ask?: number;
  dmm_spread?: number;
  jfx_bid?: number;
  jfx_ask?: number;
  jfx_spread?: number;
  jfx_real?: boolean;
  dual_feed?: boolean;
  sub_symbol?: string;
  sub_bid?: number;
  sub_ask?: number;
  sub_spread?: number;
  loop_active?: boolean;
  loop_a?: number;
  loop_b?: number;
  loop_a_idx?: number;
  loop_b_idx?: number;
  session_boundaries?: SessionBoundariesData;
  account?: VirtualAccount;
  positions?: VirtualPosition[];
  history?: TradeHistoryItem[];
  loop?: ReplayLoopPayload;
  error?: string;
  message?: string;
  is_reconnecting?: boolean;
}

export interface ReplayLoopPayload {
  active: boolean;
  a_msc: number;
  b_msc: number;
  a_idx?: number;
  b_idx?: number;
}

export interface ReplayStatusPayload extends ReplayProgressPayload {}

export interface ExecutionAuditRecord {
  ticket: number;
  symbol: string;
  side: "BUY" | "SELL";
  volume: number;
  click_time_msc: number;
  fill_time_msc: number;
  latency_ms: number;
  request_price: number;
  fill_price: number;
  slippage_pips: number;
}

export type LatencyModel =
  | { type: "Zero" }
  | { type: "Fixed"; params: { latency_ms: number } }
  | { type: "Normal"; params: { mean_ms: number; std_dev_ms: number } };

export type SlippageModel =
  | { type: "None" }
  | { type: "Realistic"; params: { base_slippage_pips: number; volatility_factor: number } };

export interface CoreStatusSnapshot {
  virtual_time_msc: number;
  is_playing: boolean;
  state: "STOPPED" | "PLAYING" | "PAUSED";
  multiplier: number;
  speed_mode: SpeedMode;
  current_index: number;
  total_ticks: number;
  seek_epoch: number;
  trade_revision: number;
  current_tick?: {
    index: number;
    time_sec: number;
    time_msc: number;
    bid: number;
    ask: number;
    last: number;
    volume: number;
    volume_real: number;
    flags: number;
  };
  latest_audits: ExecutionAuditRecord[];
}
