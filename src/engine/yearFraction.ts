const DAY_MS = 86_400_000;

/**
 * Fraction of the calendar year still ahead, counting today: days from today to Jan 1 of the next
 * year ÷ days in the year. Jan 1 gives 1, Dec 31 gives 1/365. Only the date matters, not the time.
 */
export function remainingYearFraction(asOf: Date): number {
  const y = asOf.getFullYear();
  const start = new Date(y, 0, 1).getTime();
  const next = new Date(y + 1, 0, 1).getTime();
  const today = new Date(y, asOf.getMonth(), asOf.getDate()).getTime();
  // Math.round absorbs the 23/25-hour days around daylight-saving changes.
  return Math.round((next - today) / DAY_MS) / Math.round((next - start) / DAY_MS);
}

/** Return earned over `fraction` of a year at an annual rate `r`, compounded: (1 + r)^fraction − 1. */
export const partialYearReturn = (r: number, fraction: number): number =>
  // A whole year is `r` itself: (1 + r)^1 − 1 is off by a rounding error, which would move bit-exact results.
  fraction >= 1 ? r : Math.pow(1 + r, fraction) - 1;
