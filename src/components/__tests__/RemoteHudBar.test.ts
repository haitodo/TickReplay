import { describe, it, expect } from "vitest";
import { RemoteHudBar } from "../Remote/RemoteHudBar";

describe("RemoteHudBar component", () => {
  it("is exported and memoized with React.memo", () => {
    expect(RemoteHudBar).toBeDefined();
    expect(typeof RemoteHudBar).toBe("object"); // React.memo wraps in object
  });
});
