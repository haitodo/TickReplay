import { describe, it, expect } from "vitest";
import { HoldingTimeBar } from "../HoldingTimeBar";

describe("HoldingTimeBar component", () => {
  it("is a valid React memo component", () => {
    expect(HoldingTimeBar).toBeDefined();
    expect(typeof HoldingTimeBar).toBe("object"); // React.memo wraps in object
    expect(HoldingTimeBar.displayName).toBe("HoldingTimeBar");
  });
});
