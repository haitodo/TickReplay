import { describe, it, expect } from "vitest";
import { DEFAULT_NEWS_FILTERS } from "../../constants/newsFilters";

describe("useNewsFiltersState defaults", () => {
  it("provides initial default news filters", () => {
    expect(DEFAULT_NEWS_FILTERS.USD).toEqual({ low: false, medium: true, high: true, veryHigh: true });
    expect(DEFAULT_NEWS_FILTERS.JPY).toEqual({ low: false, medium: true, high: true, veryHigh: true });
  });
});
