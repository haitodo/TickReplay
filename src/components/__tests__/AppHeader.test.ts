import { describe, it, expect } from "vitest";
import { AppHeader } from "../Header/AppHeader";

describe("AppHeader component", () => {
  it("is exported and memoized with React.memo", () => {
    expect(AppHeader).toBeDefined();
    expect(typeof AppHeader).toBe("object"); // React.memo wraps in object
  });
});
