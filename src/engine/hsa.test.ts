import { describe, expect, it } from 'vitest';
import {
  allocateHsaContribution, hsaBaseLimit, hsaCatchUp, hsaContribEligible, hsaLimit, hsaPayAge, HSA_DEFAULT_PAY_AGE,
} from './hsa';
import { HSA_CATCHUP, HSA_LIMIT_FAMILY_2026, HSA_LIMIT_SELF_2026 } from './taxConstants';
import { samplePlan } from '../schemas/plan';

const elig = (over: Partial<Parameters<typeof hsaContribEligible>[0]> = {}) =>
  hsaContribEligible({ age: 50, retired: false, ssClaimAge: 67, contribInRetirement: false, ...over });

describe('hsaLimit', () => {
  it('is the 2026 limit at inflation factor 1 and scales the base with inflation', () => {
    expect(hsaBaseLimit('self', 1)).toBe(HSA_LIMIT_SELF_2026);
    expect(hsaBaseLimit('family', 1)).toBe(HSA_LIMIT_FAMILY_2026);
    expect(hsaBaseLimit(undefined, 2)).toBe(HSA_LIMIT_SELF_2026 * 2);
  });
  it('adds the catch-up at 55 and later, unscaled', () => {
    expect(hsaCatchUp(54)).toBe(0);
    expect(hsaCatchUp(55)).toBe(HSA_CATCHUP);
    expect(hsaLimit('family', 54, 1)).toBe(8_750);
    expect(hsaLimit('family', 55, 1)).toBe(9_750);
    // the base doubles with inflation, the catch-up stays $1,000
    expect(hsaLimit('self', 60, 2)).toBe(HSA_LIMIT_SELF_2026 * 2 + HSA_CATCHUP);
  });
});

describe('hsaContribEligible (D6)', () => {
  it('lets a worker contribute until Medicare when claiming at or before 65', () => {
    expect(elig({ age: 64, ssClaimAge: 62 })).toBe(true);
    expect(elig({ age: 65, ssClaimAge: 62 })).toBe(false);
    expect(elig({ age: 64, ssClaimAge: 65 })).toBe(true);
    expect(elig({ age: 65, ssClaimAge: 65 })).toBe(false);
  });
  it('lets a worker who delays Social Security keep contributing until the claim year', () => {
    expect(elig({ age: 66, ssClaimAge: 67 })).toBe(true);
    expect(elig({ age: 67, ssClaimAge: 67 })).toBe(false);
    expect(elig({ age: 69, ssClaimAge: 70 })).toBe(true);
    expect(elig({ age: 70, ssClaimAge: 70 })).toBe(false);
  });
  it('needs the election to contribute in retirement, and stops at 65', () => {
    expect(elig({ retired: true, age: 58 })).toBe(false);
    expect(elig({ retired: true, age: 58, contribInRetirement: true })).toBe(true);
    expect(elig({ retired: true, age: 64, contribInRetirement: true })).toBe(true);
    expect(elig({ retired: true, age: 65, contribInRetirement: true, ssClaimAge: 70 })).toBe(false);
  });
});

describe('allocateHsaContribution', () => {
  const p = (ask: number, coverage: 'self' | 'family' | undefined, age: number) => ({ ask, coverage, age });
  it('caps a single person at the limit', () => {
    expect(allocateHsaContribution(1, p(20_000, 'self', 50))).toEqual({ a: 4_400, b: 0 });
    expect(allocateHsaContribution(1, p(3_000, 'self', 50))).toEqual({ a: 3_000, b: 0 });
    expect(allocateHsaContribution(1, p(-5, 'self', 50))).toEqual({ a: 0, b: 0 });
  });
  it('gives self-only spouses independent limits', () => {
    expect(allocateHsaContribution(1, p(9_000, 'self', 50), p(9_000, 'self', 56))).toEqual({ a: 4_400, b: 5_400 });
  });
  it('shares one family pool between two family-coverage spouses', () => {
    // both under 55: one 8,750 pool, A first
    expect(allocateHsaContribution(1, p(8_000, 'family', 50), p(8_000, 'family', 50))).toEqual({ a: 8_000, b: 750 });
    // both 55+: pool is 8,750 + 2 x 1,000
    expect(allocateHsaContribution(1, p(20_000, 'family', 60), p(20_000, 'family', 60))).toEqual({ a: 9_750, b: 1_000 });
  });
  it('lets B use the pool A leaves, but never more than B own limit', () => {
    expect(allocateHsaContribution(1, p(0, 'family', 60), p(20_000, 'family', 60))).toEqual({ a: 0, b: 9_750 });
    expect(allocateHsaContribution(1, p(500, 'family', 60), p(20_000, 'family', 60)).b).toBe(9_750);
  });
  it('keeps the shared pool within the legal total in every split', () => {
    for (const askA of [0, 1_000, 5_000, 9_000, 30_000]) for (const askB of [0, 2_000, 9_000, 30_000]) {
      const r = allocateHsaContribution(1.3, p(askA, 'family', 57), p(askB, 'family', 52));
      const baseUsed = Math.max(0, r.a - 1_000) + Math.max(0, r.b);
      expect(baseUsed).toBeLessThanOrEqual(HSA_LIMIT_FAMILY_2026 * 1.3 + 1e-9);
      expect(r.a).toBeLessThanOrEqual(askA + 1e-9);
      expect(r.b).toBeLessThanOrEqual(askB + 1e-9);
    }
  });
});

describe('hsaPayAge', () => {
  it('defaults to 65 and honours an explicit policy including 0', () => {
    const pf = samplePlan().portfolio;
    expect(hsaPayAge(pf)).toBe(HSA_DEFAULT_PAY_AGE);
    expect(hsaPayAge({ ...pf, hsaPolicy: { payMedicalFromAge: 0 } })).toBe(0);
    expect(hsaPayAge({ ...pf, hsaPolicy: { payMedicalFromAge: 70 } })).toBe(70);
  });
});
