import { useState } from "react";
import { NewsFilters, DEFAULT_NEWS_FILTERS } from "../constants/newsFilters";

export function useNewsFiltersState() {
  const [newsFilters, setNewsFilters] = useState<NewsFilters>(DEFAULT_NEWS_FILTERS);

  const resetNewsFilters = () => {
    setNewsFilters(DEFAULT_NEWS_FILTERS);
  };

  const selectAllNewsFilters = () => {
    const allChecked: NewsFilters = {};
    Object.keys(DEFAULT_NEWS_FILTERS).forEach(ccy => {
      allChecked[ccy] = { low: true, medium: true, high: true, veryHigh: true };
    });
    setNewsFilters(allChecked);
  };

  const clearAllNewsFilters = () => {
    const allCleared: NewsFilters = {};
    Object.keys(DEFAULT_NEWS_FILTERS).forEach(ccy => {
      allCleared[ccy] = { low: false, medium: false, high: false, veryHigh: false };
    });
    setNewsFilters(allCleared);
  };

  return {
    newsFilters,
    setNewsFilters,
    resetNewsFilters,
    selectAllNewsFilters,
    clearAllNewsFilters
  };
}
