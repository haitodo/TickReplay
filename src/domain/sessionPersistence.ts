import type { SavedSession, SessionHistorySnapshot, SessionPositionSnapshot } from "../types/session";
import type { TradeHistoryItem, VirtualAccount, VirtualPosition } from "../types/trading";

/** Finish the session only after its snapshot was successfully persisted. */
export async function saveSessionAndFinish(
  save: () => Promise<boolean>,
  closeDialog: () => void,
  terminate?: () => Promise<void>,
): Promise<void> {
  if (!await save()) return;
  closeDialog();
  await terminate?.();
}

export function snapshotSessionAccount(account: VirtualAccount | null, initialBalance: number, leverage: number) {
  return {
    initial_balance: initialBalance,
    balance: account?.balance ?? initialBalance,
    equity: account?.equity ?? initialBalance,
    leverage,
    margin: account?.margin ?? 0,
    free_margin: account?.free_margin ?? initialBalance,
    margin_level: account?.margin_level ?? 0,
  };
}

export function snapshotSessionPosition(position: VirtualPosition, realTime: number): SessionPositionSnapshot {
  return {
    ticket: position.ticket,
    symbol: position.symbol,
    type: position.type,
    volume: position.volume,
    open_price: position.open_price,
    open_time_msc: position.open_time_msc,
    sl: position.sl,
    tp: position.tp,
    current_price: position.current_price,
    profit: position.profit,
    accumulated_real_time: realTime,
    mfe_pips: position.mfe_pips,
    mae_pips: position.mae_pips,
    spread_entry: position.spread_entry,
    volatility: position.volatility,
    volume_60s: position.volume_60s,
  };
}

export function snapshotSessionHistory(position: TradeHistoryItem, realTime: number): SessionHistorySnapshot {
  return {
    ...snapshotSessionPosition(position, realTime),
    close_price: position.close_price,
    close_time_msc: position.close_time_msc,
    close_reason: position.close_reason,
  };
}

/** Older snapshots omitted symbol; recover it from their replay settings. */
export function withSessionPositionSymbol<T extends SessionPositionSnapshot>(position: T, sourceSymbol: string) {
  return { ...position, symbol: position.symbol || sourceSymbol };
}

interface TradingSettings {
  initial_balance: number;
  contract_size: number;
  leverage: number;
  hedging: boolean;
}

export function resolveSessionTradingSettings(
  session: Pick<SavedSession, "settings" | "virtual_trade">,
  defaults: TradingSettings,
): TradingSettings {
  return {
    initial_balance: session.settings.initial_balance ?? session.virtual_trade?.initial_balance ?? defaults.initial_balance,
    contract_size: session.settings.contract_size ?? defaults.contract_size,
    leverage: session.settings.leverage ?? session.virtual_trade?.leverage ?? defaults.leverage,
    hedging: session.settings.hedging ?? defaults.hedging,
  };
}
