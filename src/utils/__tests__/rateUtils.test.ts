import { describe, it, expect } from "vitest";
import { formatRate, getReasonDisplayLabel, getReasonTooltip } from "../rateUtils";

describe("formatRate", () => {
  it("formats JPY pairs with 3 decimal places", () => {
    expect(formatRate(153.4567, "USDJPY")).toBe("153.457");
    expect(formatRate(150.1, "USDJPY")).toBe("150.100");
  });

  it("formats JPY price (>20.0) without symbol with 3 decimal places", () => {
    expect(formatRate(153.4567)).toBe("153.457");
  });

  it("formats non-JPY pairs with 5 decimal places", () => {
    expect(formatRate(1.085423, "EURUSD")).toBe("1.08542");
    expect(formatRate(1.085, "EURUSD")).toBe("1.08500");
  });

  it("returns - for invalid or zero prices", () => {
    expect(formatRate(0)).toBe("-");
    expect(formatRate(-10)).toBe("-");
    expect(formatRate(undefined)).toBe("-");
    expect(formatRate(null)).toBe("-");
    expect(formatRate(NaN)).toBe("-");
  });
});

describe("getReasonDisplayLabel", () => {
  it("maps MANUAL and SETTLEMENT to 手動", () => {
    expect(getReasonDisplayLabel("MANUAL")).toBe("手動");
    expect(getReasonDisplayLabel("SETTLEMENT")).toBe("手動");
    expect(getReasonDisplayLabel("manual")).toBe("手動");
    expect(getReasonDisplayLabel("settlement")).toBe("手動");
  });

  it("maps SL and TP as is", () => {
    expect(getReasonDisplayLabel("SL")).toBe("SL");
    expect(getReasonDisplayLabel("TP")).toBe("TP");
  });

  it("handles null or undefined", () => {
    expect(getReasonDisplayLabel(undefined)).toBe("-");
    expect(getReasonDisplayLabel(null)).toBe("-");
  });
});

describe("getReasonTooltip", () => {
  it("returns descriptive tooltip for each reason", () => {
    expect(getReasonTooltip("MANUAL")).toBe("手動決済 (MANUAL)");
    expect(getReasonTooltip("SETTLEMENT")).toBe("反対売買相殺 (SETTLEMENT)");
    expect(getReasonTooltip("SL")).toBe("損切り (Stop Loss)");
    expect(getReasonTooltip("TP")).toBe("利確 (Take Profit)");
  });
});
