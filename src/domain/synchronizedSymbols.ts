export const MAX_SYNC_SYMBOLS = 8;

export function parseSynchronizedSymbols(value: string): string[] {
  const seen = new Set<string>();
  return value.split(",").map((symbol) => symbol.trim()).filter((symbol) => {
    const key = symbol.toUpperCase();
    if (!symbol || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function validateSynchronizedSymbols(value: string, previousValue?: string): string[] | null {
  const symbols = parseSynchronizedSymbols(value);
  const reducingOversizedSelection = previousValue !== undefined
    && symbols.length < parseSynchronizedSymbols(previousValue).length;
  return symbols.length <= MAX_SYNC_SYMBOLS || reducingOversizedSelection ? symbols : null;
}
