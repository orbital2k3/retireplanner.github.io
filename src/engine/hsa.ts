import type { Portfolio } from '../schemas/plan';
import { HSA_LIMIT_SELF_2026, HSA_LIMIT_FAMILY_2026, HSA_CATCHUP, HSA_CATCHUP_AGE } from './taxConstants';

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
