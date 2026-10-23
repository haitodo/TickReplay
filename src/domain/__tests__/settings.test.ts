import { describe, it, expect } from "vitest";
import { formatTerminalNamesMap } from "../settings";
import type { TerminalInfo } from "../../types/terminal";

describe("formatTerminalNamesMap", () => {
  it("returns undefined for empty terminals array", () => {
    expect(formatTerminalNamesMap([])).toBeUndefined();
  });

  it("returns undefined when no terminal has a custom_name", () => {
    const terminals: TerminalInfo[] = [
      { id: "term-1", path: "C:/mt5/1", name: "MT5-1" },
      { id: "term-2", path: "C:/mt5/2", name: "MT5-2", custom_name: "" },
      { id: "term-3", path: "C:/mt5/3", name: "MT5-3", custom_name: "   " },
    ];
    expect(formatTerminalNamesMap(terminals)).toBeUndefined();
  });

  it("maps both id and path to trimmed custom_name", () => {
    const terminals: TerminalInfo[] = [
      { id: "term-1", path: "C:/mt5/1", name: "MT5-1", custom_name: " Production " },
      { id: "", path: "C:/mt5/2", name: "MT5-2", custom_name: "Staging" },
    ];
    const map = formatTerminalNamesMap(terminals);
    expect(map).toBeDefined();
    expect(map!["term-1"]).toBe("Production");
    expect(map!["C:/mt5/1"]).toBe("Production");
    expect(map!["C:/mt5/2"]).toBe("Staging");
  });
});
