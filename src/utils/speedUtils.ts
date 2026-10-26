export const getSafeMultiplier = (multiplier: unknown): number =>
  typeof multiplier === "number" ? multiplier : parseFloat(String(multiplier)) || 1.0;
