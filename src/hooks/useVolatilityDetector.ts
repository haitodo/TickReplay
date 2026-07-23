import { useState, useEffect, useRef } from "react";

export interface VolatilitySpikeInfo {
  isSpike: boolean;
  pipsDelta: number;
  spikeTimeMsc: number;
  symbol: string;
}

export function useVolatilityDetector(
  virtualTimeMsc: number,
  currentPrice: number,
  symbol: string,
  options: {
    thresholdPips?: number;
    windowMs?: number;
    enabled?: boolean;
  } = {}
) {
  const { thresholdPips = 20, windowMs = 300000, enabled = true } = options;

  const [spikeInfo, setSpikeInfo] = useState<VolatilitySpikeInfo>({
    isSpike: false,
    pipsDelta: 0,
    spikeTimeMsc: 0,
    symbol: ""
  });

  const priceHistoryRef = useRef<Array<{ time: number; price: number }>>([]);
  const lastAlertTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled || !currentPrice || !virtualTimeMsc) {
      return;
    }

    const history = priceHistoryRef.current;
    history.push({ time: virtualTimeMsc, price: currentPrice });

    // ウィンドウ時間より古いデータを削除
    const cutoff = virtualTimeMsc - windowMs;
    while (history.length > 0 && history[0].time < cutoff) {
      history.shift();
    }

    if (history.length < 2) return;

    // 最小・最大価格を求める
    let minPrice = history[0].price;
    let maxPrice = history[0].price;
    for (let i = 1; i < history.length; i++) {
      if (history[i].price < minPrice) minPrice = history[i].price;
      if (history[i].price > maxPrice) maxPrice = history[i].price;
    }

    // pips計算 (JPYを含むか否か)
    const isJpy = symbol.toUpperCase().includes("JPY");
    const pipMult = isJpy ? 100 : 10000;
    const pipsDelta = Math.round((maxPrice - minPrice) * pipMult * 10) / 10;

    if (pipsDelta >= thresholdPips) {
      // 1分間に何度もスパイクアラートを出さないように抑制
      if (virtualTimeMsc - lastAlertTimeRef.current > 60000) {
        lastAlertTimeRef.current = virtualTimeMsc;
        setSpikeInfo({
          isSpike: true,
          pipsDelta,
          spikeTimeMsc: virtualTimeMsc,
          symbol
        });
      }
    }
  }, [virtualTimeMsc, currentPrice, symbol, thresholdPips, windowMs, enabled]);

  const clearSpike = () => {
    setSpikeInfo(prev => ({ ...prev, isSpike: false }));
  };

  return {
    spikeInfo,
    clearSpike
  };
}
