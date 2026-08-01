import { describe, it, expect } from "vitest";
import {
  organizeSessions,
  getNextSessionIndex,
  getPrevSessionIndex
} from "../sessionBoundaries";

describe("sessionBoundaries", () => {
  it("organizeSessions correctly sorts and formats session boundaries", () => {
    const raw = {
      TYO: [100, 400],
      LDN: [250],
      NY: [350]
    };
    const result = organizeSessions(raw);
    expect(result).toEqual([
      { idx: 100, type: "TYO" },
      { idx: 250, type: "LDN" },
      { idx: 350, type: "NY" },
      { idx: 400, type: "TYO" }
    ]);
  });

  it("organizeSessions handles null/empty gracefully", () => {
    expect(organizeSessions(null)).toEqual([]);
    expect(organizeSessions({})).toEqual([]);
  });

  it("getNextSessionIndex returns correct next index", () => {
    const sessions = [
      { idx: 100, type: "TYO" as const },
      { idx: 200, type: "LDN" as const },
      { idx: 300, type: "NY" as const }
    ];
    expect(getNextSessionIndex(sessions, 150)).toBe(200);
    expect(getNextSessionIndex(sessions, 300)).toBeNull();
  });

  it("getPrevSessionIndex returns correct previous index", () => {
    const sessions = [
      { idx: 100, type: "TYO" as const },
      { idx: 200, type: "LDN" as const },
      { idx: 300, type: "NY" as const }
    ];
    expect(getPrevSessionIndex(sessions, 250)).toBe(200);
    expect(getPrevSessionIndex(sessions, 50)).toBeNull();
  });
});
