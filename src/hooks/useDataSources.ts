import { useState, useCallback, useRef } from "react";
import { parseFinnhubNews, parseFredRateData, parseGdeltArticles } from "../domain/marketData";
import type { GdeltArticle } from "../domain/marketData";
import { getTrueUtcMs, formatUtcMsToDateTimeStr } from "../utils/timeUtils";
import {
  fetchJsonWithCorsFallback,
  fetchJsonWithTimeout
} from "../utils/fetchHelper";

export interface MarketContextData {
  gdeltArticles: GdeltArticle[];
  fredRateData: string | null;
  finnhubNews: string[];
  summaryText: string;
}

export interface FetchProgress {
  gdeltStatus: "idle" | "loading" | "success" | "error";
  fredStatus: "idle" | "loading" | "success" | "error";
  finnhubStatus: "idle" | "loading" | "success" | "error";
}

/**
 * 通貨ペアに応じた要人・テーマ別検索キーワードを生成
 */
export function getKeyFigureKeywords(symbol: string): string {
  const symUpper = symbol.toUpperCase();

  const isJpy = symUpper.includes("JPY");
  const isEur = symUpper.includes("EUR");
  const isGbp = symUpper.includes("GBP");
  const isAud = symUpper.includes("AUD");

  const commonKeywords = ["Trump", "President", "Powell", "Federal Reserve", "tariff", "sanction", "intervention"];

  if (isJpy) {
    return [
      ...commonKeywords,
      "Ishiba",
      "Kishida",
      "Prime Minister",
      "Ueda",
      "Bank of Japan",
      "MOF",
      "Kanda",
      "Mimura",
      "yen"
    ].join(" OR ");
  }

  if (isEur) {
    return [
      ...commonKeywords,
      "Lagarde",
      "ECB",
      "European Central Bank",
      "Macron",
      "Scholz",
      "euro"
    ].join(" OR ");
  }

  if (isGbp) {
    return [
      ...commonKeywords,
      "Bailey",
      "Bank of England",
      "BOE",
      "Starmer",
      "pound"
    ].join(" OR ");
  }

  if (isAud) {
    return [
      ...commonKeywords,
      "Bullock",
      "RBA",
      "Reserve Bank of Australia",
      "China"
    ].join(" OR ");
  }

  return commonKeywords.join(" OR ");
}

/**
 * UTCタイムスタンプ (ms) を GDELT形式 (YYYYMMDDHHMMSS) に変換
 */
function toGdeltDateStr(msc: number): string {
  const d = new Date(msc);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

export function useDataSources() {
  const requestIdRef = useRef(0);
  const [progress, setProgress] = useState<FetchProgress>({
    gdeltStatus: "idle",
    fredStatus: "idle",
    finnhubStatus: "idle"
  });

  const fetchContextData = useCallback(
    async (
      virtualTimeMsc: number,
      symbol: string,
      options: {
        rangeHours?: number;
        fredApiKey?: string;
        finnhubApiKey?: string;
        signal?: AbortSignal;
      } = {}
    ): Promise<MarketContextData> => {
      const requestId = ++requestIdRef.current;
      const updateProgress = (update: Partial<FetchProgress>) => {
        if (requestId === requestIdRef.current) {
          setProgress((current) => ({ ...current, ...update }));
        }
      };
      const rangeHours = options.rangeHours || 3;
      const trueUtcMsc = getTrueUtcMs(virtualTimeMsc);
      const startMsc = trueUtcMsc - rangeHours * 3600 * 1000;
      const endMsc = trueUtcMsc + rangeHours * 3600 * 1000;

      setProgress({
        gdeltStatus: "loading",
        fredStatus: options.fredApiKey ? "loading" : "idle",
        finnhubStatus: options.finnhubApiKey ? "loading" : "idle"
      });

      let gdeltArticles: GdeltArticle[] = [];
      let fredRateData: string | null = null;
      let finnhubNews: string[] = [];
      let gdeltFetchFailed = false;
      let fredFetchFailed = false;
      let finnhubFetchFailed = false;

      // 1. GDELT DOC 2.0 API リクエスト
      const gdeltPromise = (async () => {
        try {
          const keywords = getKeyFigureKeywords(symbol);
          const startStr = toGdeltDateStr(startMsc);
          const endStr = toGdeltDateStr(endMsc);
          const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(
            keywords
          )}&mode=ArtList&maxrecords=12&format=json&startdatetime=${startStr}&enddatetime=${endStr}`;

          const { response: res, data } = await fetchJsonWithCorsFallback<unknown>(
            url,
            { signal: options.signal },
            15000
          );
          if (!res.ok) {
            throw new Error(`GDELT request failed with HTTP ${res.status}`);
          }
          gdeltArticles = parseGdeltArticles(data);
          updateProgress({ gdeltStatus: "success" });
        } catch (e) {
          if (options.signal?.aborted) {
            updateProgress({ gdeltStatus: "idle" });
            return;
          }
          gdeltFetchFailed = true;
          console.warn("GDELT API error:", e);
          updateProgress({ gdeltStatus: "error" });
        }
      })();

      // 2. FRED API (オプション)
      const fredPromise = (async () => {
        if (!options.fredApiKey) return;
        try {
          const startDate = formatUtcMsToDateTimeStr(trueUtcMsc - 30 * 24 * 3600 * 1000).substring(0, 10);
          const endDate = formatUtcMsToDateTimeStr(trueUtcMsc).substring(0, 10);
          const url = `https://api.stlouisfed.org/fred/series/observations?series_id=FEDFUNDS&observation_start=${startDate}&observation_end=${endDate}&api_key=${options.fredApiKey}&file_type=json`;

          const { response: res, data } = await fetchJsonWithCorsFallback<unknown>(
            url,
            { signal: options.signal }
          );
          if (!res.ok) {
            throw new Error(`FRED request failed with HTTP ${res.status}`);
          }
          fredRateData = parseFredRateData(data);
          updateProgress({ fredStatus: "success" });
        } catch (e) {
          if (options.signal?.aborted) {
            updateProgress({ fredStatus: "idle" });
            return;
          }
          fredFetchFailed = true;
          console.warn("FRED API error:", e);
          updateProgress({ fredStatus: "error" });
        }
      })();

      // 3. Finnhub API (オプション)
      const finnhubPromise = (async () => {
        if (!options.finnhubApiKey) return;
        try {
          const url = `https://finnhub.io/api/v1/news?category=forex&token=${options.finnhubApiKey}`;
          finnhubNews = parseFinnhubNews(await fetchJsonWithTimeout<unknown>(
            url,
            { signal: options.signal },
            15000
          ));
          updateProgress({ finnhubStatus: "success" });
        } catch (e) {
          if (options.signal?.aborted) {
            updateProgress({ finnhubStatus: "idle" });
            return;
          }
          finnhubFetchFailed = true;
          console.warn("Finnhub API error:", e);
          updateProgress({ finnhubStatus: "error" });
        }
      })();

      await Promise.allSettled([gdeltPromise, fredPromise, finnhubPromise]);

      // 要約テキスト生成
      const summaryParts: string[] = [];
      if (gdeltArticles.length > 0) {
        summaryParts.push(
          `【GDELT要人発言・地政学ニュース (${gdeltArticles.length}件)】\n` +
            gdeltArticles.map(a => `- ${a.title} (${a.domain})`).join("\n")
        );
      } else if (gdeltFetchFailed) {
        summaryParts.push("【GDELT要人発言・地政学ニュース】データを取得できませんでした");
      } else {
        summaryParts.push("【GDELT要人発言・地政学ニュース】該当期間内の特定ニュースデータなし");
      }

      if (options.fredApiKey) {
        if (fredRateData) {
          summaryParts.push(`【FRED政策金利データ】 ${fredRateData}`);
        } else if (fredFetchFailed) {
          summaryParts.push("【FRED政策金利データ】取得に失敗しました");
        } else {
          summaryParts.push("【FRED政策金利データ】対象期間に有効な観測値なし");
        }
      }

      if (options.finnhubApiKey) {
        if (finnhubNews.length > 0) {
          summaryParts.push(`【Finnhub FXニュース】\n` + finnhubNews.map(n => `- ${n}`).join("\n"));
        } else if (finnhubFetchFailed) {
          summaryParts.push("【Finnhub FXニュース】取得に失敗しました");
        } else {
          summaryParts.push("【Finnhub FXニュース】該当するニュースなし");
        }
      }

      return {
        gdeltArticles,
        fredRateData,
        finnhubNews,
        summaryText: summaryParts.join("\n\n")
      };
    },
    []
  );

  return {
    progress,
    fetchContextData
  };
}
