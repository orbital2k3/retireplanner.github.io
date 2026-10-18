import type { Portfolio } from '../schemas/plan';
import { HSA_LIMIT_SELF_2026, HSA_LIMIT_FAMILY_2026, HSA_CATCHUP, HSA_CATCHUP_AGE, HSA_NONQUAL_PENALTY } from './taxConstants';

/** Owned health savings account (IRC §223). Pure helpers; the wiring lives in runProjection.
 *  Limits and eligibility follow decisions D4 and D6 of hsa-tips-qcd-plan.md. */

export type HsaCoverage = 'self' | 'family';

/** Medicare entitlement age. Contributions stop at enrollment, and the 20% non-qualified penalty
 *  no longer applies to the owner from this age. */
export const HSA_MEDICARE_AGE = 65;

/** `hsaPolicy.payMedicalFromAge` when the plan sets no policy. */
export const HSA_DEFAULT_PAY_AGE = 65;

/** Owner's age from which the HSA pays medical-tagged spending. 0 = always. */
export const hsaPayAge = (pf: Portfolio): number => pf.hsaPolicy?.payMedicalFromAge ?? HSA_DEFAULT_PAY_AGE;

/** Base annual limit in nominal dollars: the 2026 limit indexed with the plan's inflation factor. */
export function hsaBaseLimit(coverage: HsaCoverage | undefined, inflationFactor: number): number {
  return (coverage === 'family' ? HSA_LIMIT_FAMILY_2026 : HSA_LIMIT_SELF_2026) * inflationFactor;
}

/** The age-55 catch-up. Set by statute and not indexed, so it is never scaled by inflation. */
export const hsaCatchUp = (age: number): number => (age >= HSA_CATCHUP_AGE ? HSA_CATCHUP : 0);

/** One person's own annual limit: indexed base plus the unindexed catch-up. For a family plan this is
 *  the household limit if only this person contributes; `allocateHsaContribution` shares it. */
export function hsaLimit(coverage: HsaCoverage | undefined, age: number, inflationFactor: number): number {
  return hsaBaseLimit(coverage, inflationFactor) + hsaCatchUp(age);
}

export interface HsaEligibility {
  age: number;
  /** Whether this person has stopped working (their own retirement age reached). */
  retired: boolean;
  ssClaimAge: number;
  /** The "keep contributing in retirement on an HSA-eligible ACA plan" election. */
  contribInRetirement: boolean;
}

/** Whether the person may contribute this year (D6).
 *  Working: until Medicare. A worker who delays Social Security keeps employer coverage and can stay
 *  eligible past 65, but claiming Social Security enrolls them in Part A, so the claim year and
 *  everything after is out: age < max(65, claim age).
 *  Retired: only with the election, on an ACA plan, so strictly before 65. */
export function hsaContribEligible(e: HsaEligibility): boolean {
  if (!e.retired) return e.age < Math.max(HSA_MEDICARE_AGE, e.ssClaimAge);
  return e.contribInRetirement && e.age < HSA_MEDICARE_AGE;
}

export interface HsaContribPerson {
  /** Contribution wanted this year, nominal dollars (0 when not eligible). */
  ask: number;
  coverage: HsaCoverage | undefined;
  age: number;
}

/** Cap each spouse's contribution. Self-only plans have independent limits. When both spouses are on
 *  family coverage the base family limit is one shared pool and each keeps their own catch-up, so
 *  A is capped first and B takes what is left of the pool (plus their own catch-up). */
export function allocateHsaContribution(
  inflationFactor: number, a: HsaContribPerson, b?: HsaContribPerson,
): { a: number; b: number } {
  const limitA = hsaLimit(a.coverage, a.age, inflationFactor);
  const cA = Math.min(Math.max(0, a.ask), limitA);
  if (!b) return { a: cA, b: 0 };
  const limitB = hsaLimit(b.coverage, b.age, inflationFactor);
  let capB = limitB;
  if (a.coverage === 'family' && b.coverage === 'family') {
    const pool = hsaBaseLimit('family', inflationFactor) + hsaCatchUp(a.age) + hsaCatchUp(b.age);
    capB = Math.min(limitB, pool - cA);
  }
  return { a: cA, b: Math.min(Math.max(0, b.ask), Math.max(0, capB)) };
}

/** Split a payment between the two owners in proportion to what each can supply. The total is
 *  capped at what both have. Used for qualified-expense payments, where either spouse's HSA may
 *  pay the household's medical bills. */
export function splitHsaPayment(amount: number, availA: number, availB: number): { a: number; b: number } {
  const total = availA + availB;
  if (total <= 0 || amount <= 0) return { a: 0, b: 0 };
  const pay = Math.min(amount, total);
  const a = pay * (availA / total);
  return { a, b: pay - a };
}

export interface HsaDrawInput {
  /** Cash still missing after every other account has been used. */
  need: number;
  balA: number;
  balB: number;
  /** Qualified spending (medical bills and IRMAA) the HSA has not paid yet this year. */
  qualNeedLeft: number;
  /** Receipts on file: past medical bills that can be reimbursed tax-free. */
  receipts: number;
  /** Whether each owner is under 65 (a non-qualified draw from them costs the 20% penalty). */
  penalizedA: boolean;
  penalizedB: boolean;
}

export interface HsaDraw {
  /** Pays this year's unpaid qualified spending. Tax-free cash. */
  qualified: number;
  /** Reimburses receipts. Tax-free cash. */
  reimbursed: number;
  /** Taxable as ordinary income, with the penalty added for owners under 65. */
  nonQual: number;
  penalty: number;
  fromA: number;
  fromB: number;
}

/** Last-resort HSA draw, used only when taxable, pre-tax and Roth money is exhausted. In order:
 *  1. unpaid qualified spending for the year, 2. receipts, 3. non-qualified money. Qualified and
 *  reimbursed dollars come out of the two accounts in proportion to their balances; non-qualified
 *  dollars come first from owners 65 and over (no penalty), then from younger owners. */
export function hsaLastResortDraw(i: HsaDrawInput): HsaDraw {
  let balA = Math.max(0, i.balA), balB = Math.max(0, i.balB);
  let left = Math.max(0, i.need);
  const take = (want: number): number => {
    const amt = Math.min(left, want, balA + balB);
    if (amt <= 0) return 0;
    const sp = splitHsaPayment(amt, balA, balB);
    balA -= sp.a; balB -= sp.b; left -= amt;
    return amt;
  };
  const qualified = take(Math.max(0, i.qualNeedLeft));
  const reimbursed = take(Math.max(0, i.receipts));

  // Non-qualified: penalty-free owners first.
  let nonQual = 0, penalized = 0;
  const free = [[() => balA, (v: number) => { balA -= v; }, i.penalizedA] as const, [() => balB, (v: number) => { balB -= v; }, i.penalizedB] as const]
    .sort((x, y) => Number(x[2]) - Number(y[2]));
  for (const [get, debit, pen] of free) {
    const amt = Math.min(left, get());
    if (amt <= 0) continue;
    debit(amt); left -= amt; nonQual += amt;
    if (pen) penalized += amt;
  }
  return {
    qualified, reimbursed, nonQual,
    penalty: penalized * HSA_NONQUAL_PENALTY,
    fromA: Math.max(0, i.balA) - balA,
    fromB: Math.max(0, i.balB) - balB,
  };
}
