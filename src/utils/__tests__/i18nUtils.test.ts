import { describe, it, expect } from "vitest";
import { translateErrorMessage } from "../i18nUtils";

describe("i18nUtils", () => {
  it("translates known English error messages into Japanese", () => {
    expect(translateErrorMessage("Margin is insufficient")).toBe("証拠金が不足しているため、ポジションを発注できません。");
    expect(translateErrorMessage("Replay is not initialized or tick data empty")).toBe("リプレイが初期化されていないか、ティックデータが空です。");
  });

  it("handles empty or unknown error messages gracefully", () => {
    expect(translateErrorMessage("")).toBe("");
    expect(translateErrorMessage("Custom unknown error")).toBe("Custom unknown error");
  });
});
