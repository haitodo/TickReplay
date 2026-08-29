/**
 * セッション保存・スナップショット・復元に関連するドメイン型定義
 */

import { PositionType, TradeReason } from "./trading";

export interface SessionReplaySettings {
  selected_terminal: string;
  selected_profile: string;
  source_symbol: string;
  sub_source_symbol?: string;
  enable_dual_feed?: boolean;
  additional_symbols?: string;
  start_time: string;
  end_time: string;
  preloaded_bars: number;
  auto_scroll_sync: boolean;
  auto_skip_weekend?: boolean;
  hedging?: boolean;
  show_holding_time?: boolean;
  holding_time_mode?: "pc" | "server";
  preload_mode?: "BARS" | "DATE";
  preload_date?: string;
  preload_timeframe?: string;
  limit_tick_history?: boolean;
  tick_history_timeframe?: string;
  max_history_bars?: number;
  timezone_mode?: "JST" | "SERVER";
  enable_virtual_trading?: boolean;
  initial_balance?: number;
  leverage?: number;
  contract_size?: number;
  enable_pseudo_rate?: boolean;
  pseudo_base_spread?: number;
  pseudo_threshold?: number;
  pseudo_sensitivity?: number;
  pseudo_mode?: "dmm" | "fixed" | "aggressive" | "custom";
  pseudo_rollover_enabled?: boolean;
  pseudo_rollover_spread?: number;
  pseudo_rollover_recovery_min?: number;
}

export interface SessionProgressState {
  current_idx: number;
  total_ticks: number;
  virtual_time_msc: number;
  is_playing: boolean;
  speed_mode?: "TEMPORAL" | "COUNT";
  multiplier?: number;
  tick_step?: number;
}

export interface SessionVirtualTradeState {
  initial_balance: number;
  balance: number;
  equity: number;
  leverage: number;
  margin: number;
  free_margin: number;
  margin_level: number;
  next_ticket: number;
  positions: SessionPositionSnapshot[];
  history: SessionHistorySnapshot[];
}

/** Position fields persisted in a session snapshot and sent back to the EA. */
export interface SessionPositionSnapshot {
  ticket: number;
  type: PositionType;
  volume: number;
  open_price: number;
  open_time_msc: number;
  sl?: number;
  tp?: number;
  current_price?: number;
  profit: number;
  accumulated_real_time?: number;
  mfe_pips?: number;
  mae_pips?: number;
  spread_entry?: number;
  volatility?: number;
  volume_60s?: number;
}

export interface SessionHistorySnapshot extends SessionPositionSnapshot {
  close_price: number;
  close_time_msc: number;
  close_reason: TradeReason;
}

export interface SavedSession {
  id: string;
  name: string;
  group_session_id?: string;
  saved_at: string;
  settings: SessionReplaySettings;
  progress: SessionProgressState;
  virtual_trade?: SessionVirtualTradeState;
}

export interface SessionGroup {
  groupId: string;
  name: string;
  symbol: string;
  latestSavedAt: string;
  snapshots: SavedSession[];
}
