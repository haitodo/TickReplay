import { describe, it, expect } from "vitest";
import { HelpTooltip } from "../HelpTooltip";

describe("HelpTooltip component", () => {
  it("is defined as a React component", () => {
    expect(HelpTooltip).toBeDefined();
    expect(typeof HelpTooltip).toBe("function");
  });
});
