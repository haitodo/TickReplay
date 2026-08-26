/**
 * 取引・仮想口座・ポジション関連のドメイン型定義
 */

export type PositionType = "BUY" | "SELL";

export type TradeReason = "MANUAL" | "TP" | "SL" | "CLOSE_ALL" | "RESET";

export type OrderColorStyle = "standard" | "classic" | "subtle" | "contrast";

export type PlColorStyle = "standard" | "classic" | "subtle" | "contrast";

export interface VirtualPosition {
  ticket: number;
  symbol: string;
  type: PositionType;
  volume: number;
  open_price: number;
  open_time: number;
  open_time_msc: number;
  close_price?: number;
  close_time?: number;
  close_time_msc?: number;
  sl?: number;
  tp?: number;
  current_price?: number;
  commission?: number;
  swap?: number;
  profit: number;
  close_reason?: TradeReason;
  mfe_pips?: number;
  mae_pips?: number;
  spread_entry?: number;
  volatility?: number;
  volume_60s?: number;
  accumulated_real_time?: number;
}

export interface TradeHistoryItem extends VirtualPosition {
  close_price: number;
  close_time: number;
  close_time_msc: number;
  close_reason: TradeReason;
}

export interface VirtualAccount {
  balance: number;
  equity: number;
  margin: number;
  free_margin: number;
  margin_level: number;
  leverage?: number;
  currency?: string;
  profit?: number;
}

export interface TradeStatisticsSummary {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalProfit: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
}
