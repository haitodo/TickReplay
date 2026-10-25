import type { PositionType, VirtualPosition } from "../types/trading";

export interface PositionSideSummary {
  totalLots: number;
  totalProfit: number;
  averageOpenRate: number;
}

export const summarizePositionSide = (
  positions: readonly VirtualPosition[],
  side: PositionType
): PositionSideSummary => {
  let totalLots = 0;
  let totalProfit = 0;
  let weightedOpenRate = 0;

  for (const position of positions) {
    if (position.type !== side) continue;
    totalLots += position.volume;
    totalProfit += position.profit;
    weightedOpenRate += position.volume * position.open_price;
  }

  return {
    totalLots,
    totalProfit,
    averageOpenRate: totalLots > 0 ? weightedOpenRate / totalLots : 0,
  };
};
