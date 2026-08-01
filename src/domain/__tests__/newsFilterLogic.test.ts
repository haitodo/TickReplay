import { describe, it, expect } from "vitest";
import { isEventFiltered, filterDailyNews } from "../newsFilterLogic";
import { ReplayNewsItem, DEFAULT_NEWS_FILTERS } from "../../constants/newsFilters";

describe("newsFilterLogic", () => {
  const sampleItem: ReplayNewsItem = {
    id: 1,
    time: "2026-05-15 14:00:00",
    currency: "USD",
    event: "US CPI",
    importance: "HIGH",
    actual: "3.5%",
    forecast: "3.4%",
    previous: "3.3%"
  };

  it("isEventFiltered returns true for HIGH importance when USD high filter is active", () => {
    expect(isEventFiltered(sampleItem, DEFAULT_NEWS_FILTERS)).toBe(true);
  });

  it("isEventFiltered returns false when filter is disabled", () => {
    const disabledFilters = {
      USD: { low: false, medium: false, high: false, veryHigh: false }
    };
    expect(isEventFiltered(sampleItem, disabledFilters)).toBe(false);
  });

  it("filterDailyNews filters items matching date and importance criteria", () => {
    const items: ReplayNewsItem[] = [
      sampleItem,
      { ...sampleItem, id: 2, time: "2026-05-16 10:00:00" }, // Different date
      { ...sampleItem, id: 3, importance: "LOW" } // Filtered out low importance
    ];
    const filtered = filterDailyNews(items, DEFAULT_NEWS_FILTERS, "2026-05-15", "JST");
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe(1);
  });
});
