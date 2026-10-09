export interface GdeltArticle {
  title: string;
  url: string;
  seendate: string;
  domain: string;
  language: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === "string" && value ? value : fallback;
}

export function parseGdeltArticles(payload: unknown): GdeltArticle[] {
  if (!isRecord(payload) || !Array.isArray(payload.articles) || !payload.articles.every(isRecord)) {
    throw new Error("Invalid GDELT response format");
  }

  return payload.articles.map((article) => ({
    title: stringOrDefault(article.title, "No Title"),
    url: stringOrDefault(article.url, ""),
    seendate: stringOrDefault(article.seendate, ""),
    domain: stringOrDefault(article.domain, ""),
    language: stringOrDefault(article.language, "English"),
  }));
}

export function parseFredRateData(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.observations)) {
    throw new Error("Invalid FRED response format");
  }

  const observations = payload.observations.slice(-3);
  if (!observations.every((observation) =>
    isRecord(observation) && typeof observation.date === "string" && typeof observation.value === "string"
  )) {
    throw new Error("Invalid FRED observation format");
  }

  return observations
    .map((observation) => `${observation.date}: FF Rate ${observation.value}%`)
    .join(" | ");
}

export function parseFinnhubNews(payload: unknown): string[] {
  if (!Array.isArray(payload)) {
    throw new Error("Invalid Finnhub response format");
  }

  const news = payload.slice(0, 5);
  if (!news.every((item) =>
    isRecord(item) && typeof item.headline === "string" && typeof item.source === "string"
  )) {
    throw new Error("Invalid Finnhub news item format");
  }

  return news.map((item) => `${item.headline} (${item.source})`);
}
