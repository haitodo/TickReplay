import { describe, it, expect } from "vitest";
import { DEFAULT_HOTKEYS, HOTKEY_METADATA } from "../../utils/hotkeyUtils";

describe("useHotkeysState defaults", () => {
  it("provides correct default hotkeys and metadata", () => {
    expect(DEFAULT_HOTKEYS.play_pause).toBe("Control+Alt+Space");
    expect(HOTKEY_METADATA.play_pause.name).toBe("再生 / 一時停止");
  });
});
