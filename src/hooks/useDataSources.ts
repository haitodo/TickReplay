import { useState, useCallback } from "react";
import { getTrueUtcMs, formatUtcMsToDateTimeStr } from "../utils/timeUtils";
import { fetchWithCorsFallback } from "../utils/fetchHelper";

export interface GdeltArticle {
  title: string;
  url: string;
  seendate: string; // YYYYMMDDTHHMMSSZ
  domain: string;
  language: string;
}

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
      } = {}
    ): Promise<MarketContextData> => {
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

      // 1. GDELT DOC 2.0 API リクエスト
      const gdeltPromise = (async () => {
        try {
          const keywords = getKeyFigureKeywords(symbol);
          const startStr = toGdeltDateStr(startMsc);
          const endStr = toGdeltDateStr(endMsc);
          const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(
            keywords
          )}&mode=ArtList&maxrecords=12&format=json&startdatetime=${startStr}&enddatetime=${endStr}`;

          const res = await fetchWithCorsFallback(url, {}, 15000);
          if (res.ok) {
            const data = await res.json();
            if (data && Array.isArray(data.articles)) {
              gdeltArticles = data.articles.map((a: any) => ({
                title: a.title || "No Title",
                url: a.url || "",
                seendate: a.seendate || "",
                domain: a.domain || "",
                language: a.language || "English"
              }));
            }
          }
          setProgress(p => ({ ...p, gdeltStatus: "success" }));
        } catch (e) {
          console.warn("GDELT API error:", e);
          setProgress(p => ({ ...p, gdeltStatus: "error" }));
        }
      })();

      // 2. FRED API (オプション)
      const fredPromise = (async () => {
        if (!options.fredApiKey) return;
        try {
          const startDate = formatUtcMsToDateTimeStr(trueUtcMsc - 30 * 24 * 3600 * 1000).substring(0, 10);
          const endDate = formatUtcMsToDateTimeStr(trueUtcMsc).substring(0, 10);
          const url = `https://api.stlouisfed.org/fred/series/observations?series_id=FEDFUNDS&observation_start=${startDate}&observation_end=${endDate}&api_key=${options.fredApiKey}&file_type=json`;

          const res = await fetchWithCorsFallback(url);
          if (res.ok) {
            const data = await res.json();
            if (data && Array.isArray(data.observations)) {
              const lastObs = data.observations.slice(-3);
              fredRateData = lastObs.map((o: any) => `${o.date}: FF Rate ${o.value}%`).join(" | ");
            }
          }
          setProgress(p => ({ ...p, fredStatus: "success" }));
        } catch (e) {
          console.warn("FRED API error:", e);
          setProgress(p => ({ ...p, fredStatus: "error" }));
        }
      })();

      // 3. Finnhub API (オプション)
      const finnhubPromise = (async () => {
        if (!options.finnhubApiKey) return;
        try {
          const url = `https://finnhub.io/api/v1/news?category=forex&token=${options.finnhubApiKey}`;
          const res = await fetch(url);
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data)) {
              finnhubNews = data.slice(0, 5).map((item: any) => `${item.headline} (${item.source})`);
            }
          }
          setProgress(p => ({ ...p, finnhubStatus: "success" }));
        } catch (e) {
          console.warn("Finnhub API error:", e);
          setProgress(p => ({ ...p, finnhubStatus: "error" }));
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
      } else {
        summaryParts.push("【GDELT要人発言・地政学ニュース】該当期間内の特定ニュースデータなし");
      }

      if (fredRateData) {
        summaryParts.push(`【FRED政策金利データ】 ${fredRateData}`);
      }

      if (finnhubNews.length > 0) {
        summaryParts.push(`【Finnhub FXニュース】\n` + finnhubNews.map(n => `- ${n}`).join("\n"));
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
