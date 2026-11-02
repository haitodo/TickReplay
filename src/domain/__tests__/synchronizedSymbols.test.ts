import { describe, expect, it } from "vitest";
import { MAX_SYNC_SYMBOLS, parseSynchronizedSymbols, validateSynchronizedSymbols } from "../synchronizedSymbols";

describe("synchronized symbols", () => {
  it("accepts eight symbols and rejects a ninth", () => {
    const symbols = Array.from({ length: MAX_SYNC_SYMBOLS }, (_, i) => `PAIR${i}.cl`);
    expect(validateSynchronizedSymbols(symbols.join(","))).toEqual(symbols);
    expect(validateSynchronizedSymbols([...symbols, "PAIR9.cl"].join(","))).toBeNull();
  });

  it("preserves MT5 symbol spelling while ignoring duplicate entries", () => {
    expect(parseSynchronizedSymbols(" EURJPY.cl, GBPJPY.m,eurjpy.CL, , ")).toEqual(["EURJPY.cl", "GBPJPY.m"]);
  });

  it("lets an oversized saved selection be reduced to the supported limit", () => {
    const symbols = Array.from({ length: 10 }, (_, i) => `PAIR${i}`);
    expect(validateSynchronizedSymbols(symbols.slice(0, 9).join(","), symbols.join(","))).toHaveLength(9);
    expect(validateSynchronizedSymbols(symbols.slice(0, 8).join(","))).toHaveLength(8);
    expect(validateSynchronizedSymbols(symbols.join(","), symbols.slice(0, 9).join(","))).toBeNull();
  });
});
