import { describe, it, expect } from "vitest";
import { getContractSizeLabel } from "../contractUtils";

describe("contractUtils", () => {
  it("returns human readable Japanese labels for standard contract sizes", () => {
    expect(getContractSizeLabel(100000)).toBe("10万通貨 (Standard)");
    expect(getContractSizeLabel(10000)).toBe("1万通貨 (Mini)");
    expect(getContractSizeLabel(1000)).toBe("1,000通貨 (Micro)");
    expect(getContractSizeLabel(50000)).toBe("50,000通貨");
  });
});
