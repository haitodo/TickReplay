import { describe, it, expect } from "vitest";
import { ExecutionAuditModal } from "../Modals/ExecutionAuditModal";

describe("ExecutionAuditModal component", () => {
  it("is defined as a React component", () => {
    expect(ExecutionAuditModal).toBeDefined();
    expect(typeof ExecutionAuditModal).toBe("function");
  });
});
