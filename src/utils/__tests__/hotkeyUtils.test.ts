import { describe, it, expect } from "vitest";
import {
  DEFAULT_HOTKEYS,
  HOTKEY_METADATA,
  getTauriShortcutFromEvent,
  formatShortcutForDisplay,
  matchesHotkey
} from "../hotkeyUtils";

describe("hotkeyUtils", () => {
  it("DEFAULT_HOTKEYS contains expected keys", () => {
    expect(DEFAULT_HOTKEYS.play_pause).toBe("Control+Alt+Space");
    expect(DEFAULT_HOTKEYS.step_forward).toBe("Control+Alt+ArrowRight");
  });

  it("HOTKEY_METADATA contains name and desc for play_pause", () => {
    expect(HOTKEY_METADATA.play_pause).toBeDefined();
    expect(HOTKEY_METADATA.play_pause.name).toBe("再生 / 一時停止");
  });

  it("getTauriShortcutFromEvent correctly generates shortcut string", () => {
    const event = {
      key: " ",
      code: "Space",
      ctrlKey: true,
      shiftKey: false,
      altKey: true,
      metaKey: false
    } as KeyboardEvent;
    expect(getTauriShortcutFromEvent(event)).toBe("Control+Alt+Space");
  });

  it("getTauriShortcutFromEvent returns empty string for modifier-only keypress", () => {
    const event = {
      key: "Control",
      code: "ControlLeft",
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      metaKey: false
    } as KeyboardEvent;
    expect(getTauriShortcutFromEvent(event)).toBe("");
  });

  it("formatShortcutForDisplay formats shortcuts for user interface", () => {
    expect(formatShortcutForDisplay("Control+Alt+Space")).toBe("Ctrl + Alt + Space");
    expect(formatShortcutForDisplay("Control+Alt+KeyA")).toBe("Ctrl + Alt + A");
    expect(formatShortcutForDisplay("")).toBe("未設定");
  });

  it("matchesHotkey accurately identifies shortcut matches", () => {
    const event = {
      key: " ",
      code: "Space",
      ctrlKey: true,
      shiftKey: false,
      altKey: true,
      metaKey: false
    } as KeyboardEvent;
    expect(matchesHotkey(event, "Control+Alt+Space")).toBe(true);
    expect(matchesHotkey(event, "Control+Alt+KeyA")).toBe(false);
  });
});
