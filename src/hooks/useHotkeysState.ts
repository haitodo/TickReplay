import { useState } from "react";
import { DEFAULT_HOTKEYS, HOTKEY_METADATA } from "../utils/hotkeyUtils";

export function useHotkeysState() {
  const [hotkeys, setHotkeys] = useState<Record<string, string>>(DEFAULT_HOTKEYS);
  const [recordingAction, setRecordingAction] = useState<string | null>(null);

  const resetHotkeys = () => {
    setHotkeys(DEFAULT_HOTKEYS);
  };

  const updateHotkey = (actionKey: string, shortcut: string) => {
    setHotkeys(prev => ({
      ...prev,
      [actionKey]: shortcut
    }));
  };

  return {
    hotkeys,
    setHotkeys,
    recordingAction,
    setRecordingAction,
    resetHotkeys,
    updateHotkey,
    HOTKEY_METADATA
  };
}
