export interface TradeRecord {
  profit: number;
}

export interface TradeStatsSummary {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalProfit: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
}

/**
 * 取引履歴データから勝率、総損益、プロフィットファクター等の統計要約を計算
 */
export const calculateTradeStats = (history: TradeRecord[]): TradeStatsSummary => {
  if (!history || !Array.isArray(history) || history.length === 0) {
    return {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      totalProfit: 0,
      grossProfit: 0,
      grossLoss: 0,
      profitFactor: 0
    };
  }

  const totalTrades = history.length;
  let wins = 0;
  let losses = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let totalProfit = 0;

  history.forEach((t) => {
    const p = t.profit || 0;
    totalProfit += p;
    if (p > 0) {
      wins++;
      grossProfit += p;
    } else if (p < 0) {
      losses++;
      grossLoss += Math.abs(p);
    } else {
      losses++; // 0損益は敗北扱い（またはイーブン）
    }
  });

  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  return {
    totalTrades,
    wins,
    losses,
    winRate,
    totalProfit,
    grossProfit,
    grossLoss,
    profitFactor
  };
};

/**
 * 残高およびオープンポジション評価損益から有効証拠金・評価損益を算出
 */
export const calculateAccountEquity = (
  balance: number,
  positions: { profit: number }[]
): { equity: number; unrealizedPL: number } => {
  const unrealizedPL = (positions || []).reduce((acc, pos) => acc + (pos.profit || 0), 0);
  const equity = balance + unrealizedPL;
  return { equity, unrealizedPL };
};
