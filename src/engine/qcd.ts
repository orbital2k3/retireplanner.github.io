import { QCD_LIMIT_2026 } from './taxConstants';

/** Qualified charitable distributions (IRC §408(d)(8)): a direct IRA-to-charity transfer that is
 *  excluded from income, counts toward the owner's RMD, and is capped per person per year. The
 *  projection uses these pure helpers; the wiring lives in runProjection. */

/** True once the person is 70½ at some point in the calendar year. `age` is the year-based age the
 *  projection uses (plan start year minus birth year). Turning 70 in Jan–Jun means 70½ falls in the
 *  same calendar year, so that year counts; a July 1 birthday reaches 70½ on Jan 1 of the next year. */
export function qcdEligible(dob: string, age: number): boolean {
  if (age >= 71) return true;
  if (age < 70) return false;
  const month = parseInt(dob.slice(5, 7), 10);
  return month <= 6;
}

/** Annual per-person limit in nominal dollars (the 2026 limit indexed with the plan's inflation factor). */
export function qcdLimit(inflationFactor: number): number {
  return QCD_LIMIT_2026 * inflationFactor;
}

/** Traditional money a person can send to charity this year: their own balance after growth and
 *  contributions, excluding inherited accounts (QCD rules don't extend to inherited balances here).
 *  `tipsToTrad` is reserved for the TIPS ladder (coupons and maturities returning to the IRA). */
export function qcdAvailable(
  trad: number,
  inheritedInTrad: number,
  growthRate: number,
  contribToTrad: number,
  tipsToTrad = 0,
): number {
  return Math.max(0, (trad - inheritedInTrad) * (1 + growthRate) + contribToTrad + tipsToTrad);
}

/** The part of the year's RMD that reached the household as taxable cash: the RMD less the QCD that
 *  satisfied it (per person, summed). Equals `rmd` when there was no QCD. Charts and the Sankey use it
 *  for the "RMDs" bar so a QCD isn't drawn as cash in the household's hands. */
export const rmdCashOf = (r: { rmd: number; qcd: number; qcdBeyondRmd: number }): number =>
  r.rmd - (r.qcd - r.qcdBeyondRmd);

export interface QcdPerson {
  eligible: boolean;
  /** This year's RMD for the person (gross, before any QCD). */
  rmd: number;
  /** From `qcdAvailable`. */
  available: number;
}

export interface QcdAllocation { qcdA: number; qcdB: number }

/** Split a household's QCD-eligible giving between the two owners.
 *  1. Cover each RMD first, A then B (a QCD that satisfies an RMD costs nothing in tax).
 *  2. Send any remaining giving beyond the RMDs, A then B.
 *  Each person is capped by the annual limit and by their own available traditional balance, and an
 *  ineligible or absent person gets zero. The total never exceeds `giving`. */
export function allocateQcd(giving: number, limit: number, a: QcdPerson, b?: QcdPerson): QcdAllocation {
  const capA = a.eligible ? Math.max(0, Math.min(limit, a.available)) : 0;
  const capB = b && b.eligible ? Math.max(0, Math.min(limit, b.available)) : 0;
  let left = Math.max(0, giving);

  const rmdA = Math.min(left, Math.max(0, a.rmd), capA);
  left -= rmdA;
  const rmdB = Math.min(left, Math.max(0, b?.rmd ?? 0), capB);
  left -= rmdB;

  const extraA = Math.min(left, capA - rmdA);
  left -= extraA;
  const extraB = Math.min(left, capB - rmdB);

  return { qcdA: rmdA + extraA, qcdB: rmdB + extraB };
}
