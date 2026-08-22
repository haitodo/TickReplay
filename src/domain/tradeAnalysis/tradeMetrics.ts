import { TradeRecord, TradeStats } from "./types";

export const HOLDING_BUCKET_LABELS = ["< 5s", "5-15s", "15-30s", "30-60s", "1-3m", "> 3m"];

export function getHoldingBucketIndex(sec: number): number {
  if (sec < 5) return 0;
  if (sec < 15) return 1;
  if (sec < 30) return 2;
  if (sec < 60) return 3;
  if (sec < 180) return 4;
  return 5;
}

/**
 * トレード群から主要パフォーマンス指標を一括計算
 */
export function calculateTradeStats(trades: TradeRecord[]): TradeStats {
  const totalTrades = trades.length;
  if (totalTrades === 0) {
    return {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      totalProfit: 0,
      totalPips: 0,
      profitFactor: 0,
      expectancy: 0,
      expectancyPips: 0,
      avgWin: 0,
      avgLoss: 0,
      avgWinPips: 0,
      avgLossPips: 0,
      riskRewardRatio: 0,
      maxDrawdown: 0,
      maxDrawdownPercent: 0,
      maxConsecutiveWins: 0,
      maxConsecutiveLosses: 0,
      longTrades: 0,
      longWins: 0,
      longProfit: 0,
      shortTrades: 0,
      shortWins: 0,
      shortProfit: 0,
      avgDurationSec: 0
    };
  }

  const winsList = trades.filter(t => t.profit > 0);
  const lossesList = trades.filter(t => t.profit <= 0);

  const wins = winsList.length;
  const losses = lossesList.length;
  const winRate = (wins / totalTrades) * 100;

  const totalProfit = trades.reduce((sum, t) => sum + t.profit, 0);
  const totalPips = trades.reduce((sum, t) => sum + (t.pips || 0), 0);

  const winSum = winsList.reduce((sum, t) => sum + t.profit, 0);
  const lossSum = Math.abs(lossesList.reduce((sum, t) => sum + t.profit, 0));
  const profitFactor = lossSum > 0 ? winSum / lossSum : winSum > 0 ? 99.9 : 0;

  const expectancy = totalProfit / totalTrades;
  const expectancyPips = totalPips / totalTrades;

  const avgWin = wins > 0 ? winSum / wins : 0;
  const avgLoss = losses > 0 ? lossSum / losses : 0;

  const winPipsSum = winsList.reduce((sum, t) => sum + (t.pips || 0), 0);
  const lossPipsSum = Math.abs(lossesList.reduce((sum, t) => sum + (t.pips || 0), 0));
  const avgWinPips = wins > 0 ? winPipsSum / wins : 0;
  const avgLossPips = losses > 0 ? lossPipsSum / losses : 0;

  const riskRewardRatio = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? 99.9 : 0;

  // 連勝・連敗数とドローダウンの算出
  const sorted = [...trades].sort((a, b) => a.close_time_msc - b.close_time_msc);
  let maxConsecutiveWins = 0;
  let maxConsecutiveLosses = 0;
  let currentWins = 0;
  let currentLosses = 0;

  let peak = 0;
  let runningEquity = 0;
  let maxDrawdown = 0;
  let maxDrawdownPercent = 0;

  for (const t of sorted) {
    if (t.profit > 0) {
      currentWins++;
      currentLosses = 0;
      if (currentWins > maxConsecutiveWins) maxConsecutiveWins = currentWins;
    } else {
      currentLosses++;
      currentWins = 0;
      if (currentLosses > maxConsecutiveLosses) maxConsecutiveLosses = currentLosses;
    }

    runningEquity += t.profit;
    if (runningEquity > peak) {
      peak = runningEquity;
    }
    const dd = peak - runningEquity;
    if (dd > maxDrawdown) {
      maxDrawdown = dd;
      const base = peak > 0 ? peak : 1000000;
      maxDrawdownPercent = (dd / base) * 100;
    }
  }

  // ロング / ショート集計
  const longList = trades.filter(t => t.type === "BUY");
  const shortList = trades.filter(t => t.type === "SELL");

  const longTrades = longList.length;
  const longWins = longList.filter(t => t.profit > 0).length;
  const longProfit = longList.reduce((sum, t) => sum + t.profit, 0);

  const shortTrades = shortList.length;
  const shortWins = shortList.filter(t => t.profit > 0).length;
  const shortProfit = shortList.reduce((sum, t) => sum + t.profit, 0);

  const totalDuration = trades.reduce((sum, t) => sum + (t.durationSec || 0), 0);
  const avgDurationSec = totalTrades > 0 ? Math.round(totalDuration / totalTrades) : 0;

  return {
    totalTrades,
    wins,
    losses,
    winRate: Math.round(winRate * 10) / 10,
    totalProfit: Math.round(totalProfit),
    totalPips: Math.round(totalPips * 10) / 10,
    profitFactor: Math.round(profitFactor * 100) / 100,
    expectancy: Math.round(expectancy),
    expectancyPips: Math.round(expectancyPips * 10) / 10,
    avgWin: Math.round(avgWin),
    avgLoss: Math.round(avgLoss),
    avgWinPips: Math.round(avgWinPips * 10) / 10,
    avgLossPips: Math.round(avgLossPips * 10) / 10,
    riskRewardRatio: Math.round(riskRewardRatio * 100) / 100,
    maxDrawdown: Math.round(maxDrawdown),
    maxDrawdownPercent: Math.round(maxDrawdownPercent * 10) / 10,
    maxConsecutiveWins,
    maxConsecutiveLosses,
    longTrades,
    longWins,
    longProfit: Math.round(longProfit),
    shortTrades,
    shortWins,
    shortProfit: Math.round(shortProfit),
    avgDurationSec
  };
}

/**
 * 保有時間バケット別の集計
 */
export function calculateHoldingDistribution(trades: TradeRecord[]) {
  const buckets = HOLDING_BUCKET_LABELS.map(label => ({
    label,
    count: 0,
    wins: 0,
    losses: 0,
    profit: 0,
    pips: 0
  }));

  for (const t of trades) {
    const idx = getHoldingBucketIndex(t.durationSec || 0);
    buckets[idx].count++;
    if (t.profit > 0) buckets[idx].wins++;
    else buckets[idx].losses++;
    buckets[idx].profit += t.profit;
    buckets[idx].pips += (t.pips || 0);
  }

  return buckets;
}

/**
 * 曜日 × 時間帯 (JST) のパフォーマンスヒートマップ集計
 */
export function calculateTimeHeatmap(trades: TradeRecord[]) {
  // 7日 (0:日〜6:土) × 24時間
  const matrix = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({
      count: 0,
      profit: 0,
      pips: 0,
      wins: 0
    }))
  );

  for (const t of trades) {
    const d = t.dayJst >= 0 && t.dayJst <= 6 ? t.dayJst : 1;
    const h = t.hourJst >= 0 && t.hourJst <= 23 ? t.hourJst : 0;
    matrix[d][h].count++;
    matrix[d][h].profit += t.profit;
    matrix[d][h].pips += (t.pips || 0);
    if (t.profit > 0) matrix[d][h].wins++;
  }

  return matrix;
}

/**
 * 資産推移曲線（Cumulative Equity Curve）とドローダウンの時系列データ生成
 */
export function calculateEquityCurve(trades: TradeRecord[]) {
  const sorted = [...trades].sort((a, b) => a.close_time_msc - b.close_time_msc);
  let cumProfit = 0;
  let cumPips = 0;
  let peak = 0;

  const points: {
    time: string;
    tradeNum: number;
    profit: number;
    cumProfit: number;
    pips: number;
    cumPips: number;
    drawdown: number;
  }[] = [];

  // 初期点
  points.push({
    time: sorted.length > 0 ? sorted[0].open_time : "",
    tradeNum: 0,
    profit: 0,
    cumProfit: 0,
    pips: 0,
    cumPips: 0,
    drawdown: 0
  });

  sorted.forEach((t, idx) => {
    cumProfit += t.profit;
    cumPips += (t.pips || 0);
    if (cumProfit > peak) peak = cumProfit;
    const dd = peak - cumProfit;

    points.push({
      time: t.close_time,
      tradeNum: idx + 1,
      profit: t.profit,
      cumProfit: Math.round(cumProfit),
      pips: t.pips || 0,
      cumPips: Math.round(cumPips * 10) / 10,
      drawdown: Math.round(dd)
    });
  });

  return points;
}

/**
 * 通常時トレード vs 経済指標近接トレードの比較集計 & ガバナンスアドバイス生成
 */
export function calculateProximityComparisonStats(trades: TradeRecord[]) {
  const regular = trades.filter(t => !t.isNearNews);
  const nearNews = trades.filter(t => t.isNearNews === true);

  const calcGroup = (group: TradeRecord[]) => {
    const count = group.length;
    if (count === 0) {
      return { count: 0, winRate: 0, totalProfit: 0, profitFactor: 0, expectancy: 0, avgWin: 0, avgLoss: 0 };
    }
    const wins = group.filter(t => t.profit > 0);
    const losses = group.filter(t => t.profit <= 0);
    const winRate = (wins.length / count) * 100;
    const totalProfit = group.reduce((sum, t) => sum + t.profit, 0);
    const winSum = wins.reduce((sum, t) => sum + t.profit, 0);
    const lossSum = Math.abs(losses.reduce((sum, t) => sum + t.profit, 0));
    const profitFactor = lossSum > 0 ? winSum / lossSum : winSum > 0 ? 99.9 : 0;
    const expectancy = totalProfit / count;
    const avgWin = wins.length > 0 ? winSum / wins.length : 0;
    const avgLoss = losses.length > 0 ? lossSum / losses.length : 0;

    return {
      count,
      winRate: Math.round(winRate * 10) / 10,
      totalProfit: Math.round(totalProfit),
      profitFactor: Math.round(profitFactor * 100) / 100,
      expectancy: Math.round(expectancy),
      avgWin: Math.round(avgWin),
      avgLoss: Math.round(avgLoss)
    };
  };

  const regStats = calcGroup(regular);
  const newsStats = calcGroup(nearNews);

  const winRateDiff = Math.round((newsStats.winRate - regStats.winRate) * 10) / 10;
  const profitFactorDiff = Math.round((newsStats.profitFactor - regStats.profitFactor) * 100) / 100;

  let advice = "";
  if (newsStats.count === 0) {
    advice = "指標近接フラグの付与された取引がありません。「Drenhis指標を照合」ボタンを実行して引き当てを行ってください。";
  } else if (newsStats.winRate < regStats.winRate - 5 || newsStats.profitFactor < 1.0) {
    advice = `指標発表近接時のトレードは通常時に比べて勝率が ${Math.abs(winRateDiff)}% 低下し、PFは ${newsStats.profitFactor} です。急激なスプレッド拡大と乱高下による損失リスクが高いため、重要指標発表前後のエントリー自粛を強く推奨します。`;
  } else if (newsStats.profitFactor > regStats.profitFactor + 0.3 && newsStats.totalProfit > 0) {
    advice = `指標発表時の高いボラティリティを捉えて優れたプロフィットファクター (${newsStats.profitFactor}) を達成しています。スリッページ管理を徹底しつつ現在の優位性を維持してください。`;
  } else {
    advice = `通常トレードと指標近接トレードで顕著なパフォーマンス乖離は見られません。規律あるリスク管理が維持されています。`;
  }

  return {
    regularTrades: regStats,
    nearNewsTrades: newsStats,
    winRateDiff,
    profitFactorDiff,
    advice
  };
}
