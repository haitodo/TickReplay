export interface TerminalInfo {
  id?: string;
  name: string;
  default_name?: string;
  path: string;
  origin_path?: string;
  custom_name?: string;
}

export interface ReplayNewsItem {
  id: number;
  time: string; // "YYYY-MM-DD HH:mm:ss"
  currency: string;
  event: string;
  importance: "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";
  actual: string;
  forecast: string;
  previous: string;
}

export interface CurrencyNewsFilter {
  low: boolean;
  medium: boolean;
  high: boolean;
  veryHigh: boolean;
}

export type NewsFilters = Record<string, CurrencyNewsFilter>;

export const DEFAULT_NEWS_FILTERS: NewsFilters = {
  USD: { low: false, medium: true, high: true, veryHigh: true },
  JPY: { low: false, medium: true, high: true, veryHigh: true },
  EUR: { low: false, medium: false, high: false, veryHigh: false },
  GBP: { low: false, medium: false, high: false, veryHigh: false },
  AUD: { low: false, medium: false, high: false, veryHigh: false },
  CAD: { low: false, medium: false, high: false, veryHigh: false },
  CHF: { low: false, medium: false, high: false, veryHigh: false },
  NZD: { low: false, medium: false, high: false, veryHigh: false },
  OTHERS: { low: false, medium: false, high: false, veryHigh: false },
};
