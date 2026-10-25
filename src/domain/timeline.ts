const SECONDS_PER_DAY = 24 * 60 * 60;

export const getSecondsIntoDay = (timeMsc: number, dayStartMsc: number): number =>
  Math.max(0, Math.min(SECONDS_PER_DAY, Math.floor((timeMsc - dayStartMsc) / 1000)));
