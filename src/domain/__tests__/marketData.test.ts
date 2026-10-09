import { describe, expect, it } from "vitest";
import { parseFinnhubNews, parseFredRateData, parseGdeltArticles } from "../marketData";

describe("external market data parsing", () => {
  it("accepts valid empty results from each provider", () => {
    expect(parseGdeltArticles({ articles: [] })).toEqual([]);
    expect(parseFredRateData({ observations: [] })).toBe("");
    expect(parseFinnhubNews([])).toEqual([]);
  });

  it("keeps the existing GDELT defaults for optional article fields", () => {
    expect(parseGdeltArticles({ articles: [{ title: "News" }] })).toEqual([{
      title: "News",
      url: "",
      seendate: "",
      domain: "",
      language: "English",
    }]);
  });

  it("formats only the most recent three FRED observations", () => {
    const observations = [
      { date: "2024-01-01", value: "1.0" },
      { date: "2024-02-01", value: "2.0" },
      { date: "2024-03-01", value: "3.0" },
      { date: "2024-04-01", value: "4.0" },
    ];

    expect(parseFredRateData({ observations })).toBe(
      "2024-02-01: FF Rate 2.0% | 2024-03-01: FF Rate 3.0% | 2024-04-01: FF Rate 4.0%"
    );
  });

  it("rejects malformed provider payloads", () => {
    expect(() => parseGdeltArticles({ articles: null })).toThrow("Invalid GDELT response format");
    expect(() => parseGdeltArticles({ articles: [null] })).toThrow("Invalid GDELT response format");
    expect(() => parseFredRateData({ observations: [{ date: "2024-01-01" }] })).toThrow("Invalid FRED observation format");
    expect(() => parseFinnhubNews({ articles: [] })).toThrow("Invalid Finnhub response format");
    expect(() => parseFinnhubNews([{ headline: "News" }])).toThrow("Invalid Finnhub news item format");
  });
});
