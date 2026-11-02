import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => actual.useState(initial === null ? {
      balance: 0, equity: 0, free_margin: 0, margin: 0, margin_level: 0, profit: 0, leverage: 25,
    } : initial),
  };
});
vi.mock("../../hooks/useAppearance", () => ({ useAppearance: () => {} }));

import { PositionsWindowContent } from "../PositionsWindowContent";

describe("PositionsWindowContent", () => {
  it("renders an exhausted account as zero instead of adding one million yen", () => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    try {
      const html = renderToStaticMarkup(React.createElement(PositionsWindowContent));
      expect(html).toContain("口座残高 (Balance)");
      expect(html).toContain("有効残高 (Equity)");
      expect(html).not.toContain("1,000,000");
      expect(html).toContain("0 円");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
