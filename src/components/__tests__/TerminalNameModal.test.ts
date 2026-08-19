import { describe, it, expect } from "vitest";
import { TerminalNameModal } from "../Modals/TerminalNameModal";

describe("TerminalNameModal component", () => {
  it("is a valid React memo component", () => {
    expect(TerminalNameModal).toBeDefined();
    expect(typeof TerminalNameModal).toBe("object"); // React.memo wraps in object
  });
});
