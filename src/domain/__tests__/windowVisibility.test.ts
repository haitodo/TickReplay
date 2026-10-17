import { describe, it, expect } from "vitest";
import { resolveWindowVisibility } from "../windowVisibility";

describe("resolveWindowVisibility", () => {
  it("ignores visibility changes for other windows", () => {
    // settings ウィンドウが閉じられた時のイベント (speed_order から受信)
    const result = resolveWindowVisibility("speed_order", {
      label: "settings",
      visible: false,
    });
    expect(result).toBeNull();
  });

  it("applies visibility changes matching the current window", () => {
    // speed_order 自身が非表示化された場合
    const hideResult = resolveWindowVisibility("speed_order", {
      label: "speed_order",
      visible: false,
    });
    expect(hideResult).toBe(false);

    // speed_order 自身が表示化された場合
    const showResult = resolveWindowVisibility("speed_order", {
      label: "speed_order",
      visible: true,
    });
    expect(showResult).toBe(true);
  });

  it("handles events without label if any", () => {
    const result = resolveWindowVisibility("speed_order", {
      visible: false,
    });
    expect(result).toBe(false);
  });

  it("handles legacy bare boolean with fallbackToCurrent true", () => {
    const result = resolveWindowVisibility("speed_order", false, true);
    expect(result).toBeNull();
  });

  it("handles legacy bare boolean with fallbackToCurrent false", () => {
    const resultTrue = resolveWindowVisibility("speed_order", true, false);
    expect(resultTrue).toBe(true);

    const resultFalse = resolveWindowVisibility("speed_order", false, false);
    expect(resultFalse).toBe(false);
  });

  it("returns null for invalid payloads", () => {
    expect(resolveWindowVisibility("speed_order", null)).toBeNull();
    expect(resolveWindowVisibility("speed_order", undefined)).toBeNull();
    expect(resolveWindowVisibility("speed_order", "invalid")).toBeNull();
  });
});
