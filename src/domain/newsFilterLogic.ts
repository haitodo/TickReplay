import { ReplayNewsItem, NewsFilters, DEFAULT_NEWS_FILTERS } from "../constants/newsFilters";
import { getNewsTimeForDisplay } from "../utils/timeUtils";

/**
 * 個別のニュースアイテムがフィルタ設定に合致するか判定
 */
export const isEventFiltered = (item: ReplayNewsItem, filters: NewsFilters): boolean => {
  if (!item || !item.currency) return false;
  const currency = item.currency.toUpperCase();
  const filterKey = filters && filters[currency] ? currency : (DEFAULT_NEWS_FILTERS[currency] ? currency : "OTHERS");
  const filter = (filters && filters[filterKey]) || DEFAULT_NEWS_FILTERS[filterKey] || { low: false, medium: false, high: false, veryHigh: false };

  switch (item.importance) {
    case "LOW":
      return filter.low;
    case "MEDIUM":
      return filter.medium;
    case "HIGH":
      return filter.high;
    case "VERY_HIGH":
      return filter.veryHigh;
    default:
      return false;
  }
};

/**
 * 指定された日付・タイムゾーンモードおよびフィルター設定に基づいてニュースを絞り込み
 */
export const filterDailyNews = (
  items: ReplayNewsItem[],
  filters: NewsFilters,
  displayDateStr: string,
  mode: "JST" | "SERVER"
): ReplayNewsItem[] => {
  if (!items || !Array.isArray(items)) return [];
  return items.filter((item) => {
    const displayTimeStr = getNewsTimeForDisplay(item.time, mode);
    return displayTimeStr.startsWith(displayDateStr) && isEventFiltered(item, filters);
  });
};
