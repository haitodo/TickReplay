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
  TYO: SessionBoundaryItem[];
  LDN: SessionBoundaryItem[];
  NY: SessionBoundaryItem[];
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
  status?: ReplayStatus;
  total_ticks?: number;
  current_idx?: number;
  virtual_time_msc?: number;
  is_playing?: boolean;
  speed_mode?: SpeedMode;
  multiplier?: number | string;
  tick_step?: number;
  symbol?: string;
  bid?: number;
  ask?: number;
  spread?: number;
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
  account?: any;
  positions?: any[];
  history?: any[];
  error?: string;
  is_reconnecting?: boolean;
}

export interface ReplayStatusPayload extends ReplayProgressPayload {}
