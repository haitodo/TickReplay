import { describe, it, expect } from "vitest";
import { THEME_LIST, THEMES_BY_ID, ThemeType } from "../../constants/themePresets";

describe("5-Theme configuration (Drenhis compatibility)", () => {
  it("contains exactly 5 distinct eye-care themes", () => {
    expect(THEME_LIST).toHaveLength(5);
    const expectedIds: ThemeType[] = ["dark", "dim", "light", "sepia", "warm-sepia"];
    expect(THEME_LIST.map((t) => t.id)).toEqual(expectedIds);
  });

  it("defines all required fields with proper color values for each theme", () => {
    for (const theme of THEME_LIST) {
      expect(theme.id).toBeTruthy();
      expect(theme.nameJa).toBeTruthy();
      expect(theme.nameEn).toBeTruthy();
      expect(theme.subname).toBeTruthy();
      expect(theme.icon).toBeTruthy();
      expect(theme.description).toBeTruthy();
      expect(theme.environment).toBeTruthy();
      expect(theme.bgHex).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(theme.cardHex).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(theme.textHex).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(theme.accentHex).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("provides proper THEMES_BY_ID lookup map", () => {
    expect(THEMES_BY_ID["dark"].nameJa).toBe("ダーク");
    expect(THEMES_BY_ID["dim"].nameJa).toBe("ディム");
    expect(THEMES_BY_ID["light"].nameJa).toBe("ライト");
    expect(THEMES_BY_ID["sepia"].nameJa).toBe("ダークセピア");
    expect(THEMES_BY_ID["warm-sepia"].nameJa).toBe("ウォームセピア");
  });
});
