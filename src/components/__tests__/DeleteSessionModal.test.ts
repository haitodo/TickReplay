import { describe, it, expect } from "vitest";
import { DeleteSessionModal } from "../DeleteSessionModal";

describe("DeleteSessionModal component", () => {
  it("is a valid React memo component", () => {
    expect(DeleteSessionModal).toBeDefined();
    expect(typeof DeleteSessionModal).toBe("object"); // React.memo wraps in object
  });
});
