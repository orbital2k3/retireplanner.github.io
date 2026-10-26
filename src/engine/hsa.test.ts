import { describe, expect, it } from 'vitest';
import {
  allocateHsaContribution, effectiveHsaCoverage, hsaBaseLimit, hsaCatchUp, hsaContribEligible, hsaLimit, hsaPayAge,
  hsaQualifiedPayment, HSA_DEFAULT_PAY_AGE,
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
  it('rounds the indexed base down to a multiple of $50 (§223(g)(1))', () => {
    expect(hsaBaseLimit('self', 1.03)).toBe(Math.floor((HSA_LIMIT_SELF_2026 * 1.03) / 50) * 50);
    expect(hsaBaseLimit('family', 1.027) % 50).toBe(0);
    expect(hsaBaseLimit('family', 1.027)).toBeLessThanOrEqual(HSA_LIMIT_FAMILY_2026 * 1.027);
    // an exact multiple is kept, not floored one step low by float error
    expect(hsaBaseLimit('self', 1.125)).toBe(HSA_LIMIT_SELF_2026 * 1.125);
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

import { hsaLastResortDraw } from './hsa';

describe('hsaLastResortDraw (H-5)', () => {
  const base = { balA: 100_000, balB: 0, qualNeedLeft: 0, receipts: 0, penalizedA: true, penalizedB: true };
  it('takes unpaid qualified spending first, then receipts, then non-qualified', () => {
    const d = hsaLastResortDraw({ ...base, need: 50_000, qualNeedLeft: 10_000, receipts: 15_000 });
    expect(d.qualified).toBe(10_000);
    expect(d.reimbursed).toBe(15_000);
    expect(d.nonQual).toBe(25_000);
    expect(d.penalty).toBeCloseTo(5_000, 9);               // 20% of the 25k, owner under 65
    expect(d.fromA).toBe(50_000);
  });
  it('stops when the need is met and never exceeds the balance', () => {
    expect(hsaLastResortDraw({ ...base, need: 4_000, qualNeedLeft: 10_000 })).toMatchObject({ qualified: 4_000, reimbursed: 0, nonQual: 0, penalty: 0 });
    const d = hsaLastResortDraw({ ...base, need: 500_000, receipts: 20_000 });
    expect(d.fromA).toBe(100_000);
    expect(d.reimbursed + d.nonQual).toBe(100_000);
  });
  it('charges no penalty to an owner 65 or older', () => {
    const d = hsaLastResortDraw({ ...base, need: 30_000, penalizedA: false });
    expect(d.nonQual).toBe(30_000);
    expect(d.penalty).toBe(0);
  });
  it('takes non-qualified dollars from the penalty-free owner first', () => {
    const d = hsaLastResortDraw({ need: 30_000, balA: 20_000, balB: 50_000, qualNeedLeft: 0, receipts: 0, penalizedA: true, penalizedB: false });
    expect(d.fromB).toBe(30_000);
    expect(d.fromA).toBe(0);
    expect(d.penalty).toBe(0);
    const e = hsaLastResortDraw({ need: 70_000, balA: 20_000, balB: 50_000, qualNeedLeft: 0, receipts: 0, penalizedA: true, penalizedB: false });
    expect(e.fromB).toBe(50_000);
    expect(e.fromA).toBe(20_000);
    expect(e.penalty).toBeCloseTo(4_000, 9);
  });
  it('splits tax-free draws across both owners by balance', () => {
    const d = hsaLastResortDraw({ need: 20_000, balA: 100_000, balB: 300_000, qualNeedLeft: 20_000, receipts: 0, penalizedA: true, penalizedB: true });
    expect(d.fromA).toBeCloseTo(5_000, 9);
    expect(d.fromB).toBeCloseTo(15_000, 9);
  });
  it('does nothing without a need or a balance', () => {
    expect(hsaLastResortDraw({ ...base, need: 0 })).toMatchObject({ qualified: 0, reimbursed: 0, nonQual: 0, fromA: 0 });
    expect(hsaLastResortDraw({ ...base, need: 100, balA: 0 })).toMatchObject({ nonQual: 0, fromA: 0 });
  });
});

describe('family coverage on either spouse (§223(b)(5), audit 2026-10-20)', () => {
  it('treats both spouses as family when either is', () => {
    expect(effectiveHsaCoverage('self', 'family')).toBe('family');
    expect(effectiveHsaCoverage(undefined, 'family')).toBe('family');
    expect(effectiveHsaCoverage('family', undefined)).toBe('family');
    expect(effectiveHsaCoverage('self', 'self')).toBe('self');
    expect(effectiveHsaCoverage(undefined, undefined)).toBeUndefined();
  });
  it('shares one family pool when only one spouse has family coverage', () => {
    // Before the fix this returned 8,750 + 4,400 = 13,150, over the legal total.
    expect(allocateHsaContribution(1, { ask: 8_750, coverage: 'family', age: 50 }, { ask: 4_400, coverage: 'self', age: 50 }))
      .toEqual({ a: 8_750, b: 0 });
    expect(allocateHsaContribution(1, { ask: 4_400, coverage: 'self', age: 50 }, { ask: 8_750, coverage: 'family', age: 50 }))
      .toEqual({ a: 4_400, b: 4_350 });
  });
  it('lifts a self-only spouse to the family limit when the other spouse is on family coverage', () => {
    expect(allocateHsaContribution(1, { ask: 8_000, coverage: 'self', age: 50 }, { ask: 0, coverage: 'family', age: 50 }).a).toBe(8_000);
  });
  it('keeps each spouse own catch-up inside the shared pool', () => {
    const r = allocateHsaContribution(1, { ask: 20_000, coverage: 'family', age: 56 }, { ask: 20_000, coverage: 'self', age: 57 });
    expect(r.a + r.b).toBe(HSA_LIMIT_FAMILY_2026 + 2 * HSA_CATCHUP);
  });
  it('ignores a spouse whose coverage is passed as absent (died)', () => {
    expect(allocateHsaContribution(1, { ask: 8_000, coverage: 'self', age: 50 }, { ask: 0, coverage: undefined, age: 50 }).a).toBe(HSA_LIMIT_SELF_2026);
  });
});

describe('hsaQualifiedPayment: IRMAA only from an owner 65 or over (Pub 969, audit 2026-10-20)', () => {
  const owner = (avail: number, medicare: boolean) => ({ avail, medicare });
  it('is the plain pro-rata split when every owner with money is 65+ or there is no IRMAA', () => {
    expect(hsaQualifiedPayment(1_000, 3_000, owner(6_000, true), owner(2_000, true))).toEqual({ total: 4_000, a: 3_000, b: 1_000 });
    expect(hsaQualifiedPayment(1_000, 0, owner(6_000, false), owner(2_000, true))).toEqual({ total: 1_000, a: 750, b: 250 });
  });
  it('pays no IRMAA from an under-65 owner, even for the older spouse', () => {
    // A is 66 with no HSA; B (60) holds it: only the medical bill is qualified.
    expect(hsaQualifiedPayment(1_000, 3_000, owner(0, true), owner(50_000, false))).toEqual({ total: 1_000, a: 0, b: 1_000 });
    expect(hsaQualifiedPayment(0, 3_000, owner(0, true), owner(50_000, false)).total).toBe(0);
  });
  it('pays medical from the under-65 owner first so the 65+ money covers IRMAA', () => {
    const r = hsaQualifiedPayment(1_000, 3_000, owner(4_000, true), owner(1_000, false));
    expect(r).toEqual({ total: 4_000, a: 3_000, b: 1_000 });
  });
  it('never pays more than either owner has', () => {
    const r = hsaQualifiedPayment(5_000, 3_000, owner(2_000, true), owner(1_000, false));
    expect(r.total).toBe(3_000);
    expect(r.a).toBeLessThanOrEqual(2_000);
    expect(r.b).toBeLessThanOrEqual(1_000);
  });
});

describe('hsaLastResortDraw: unpaid IRMAA only from owners 65 and over', () => {
  it('takes unpaid IRMAA from the 65+ owner only while the other is under 65', () => {
    const d = hsaLastResortDraw({ need: 3_000, balA: 5_000, balB: 5_000, qualNeedLeft: 3_000, irmaaNeedLeft: 2_000, receipts: 0, penalizedA: false, penalizedB: true });
    // medical 1,000 split by balance (500 each), IRMAA 2,000 from A alone
    expect(d).toMatchObject({ qualified: 3_000, nonQual: 0, fromA: 2_500, fromB: 500 });
    const dOnlyYoung = hsaLastResortDraw({ need: 10_000, balA: 0, balB: 5_000, qualNeedLeft: 3_000, irmaaNeedLeft: 2_000, receipts: 0, penalizedA: false, penalizedB: true });
    expect(dOnlyYoung.qualified).toBe(1_000);
  });
  it('is unchanged when both owners are 65+', () => {
    const a = hsaLastResortDraw({ need: 10_000, balA: 5_000, balB: 5_000, qualNeedLeft: 3_000, irmaaNeedLeft: 2_000, receipts: 0, penalizedA: false, penalizedB: false });
    const b = hsaLastResortDraw({ need: 10_000, balA: 5_000, balB: 5_000, qualNeedLeft: 3_000, receipts: 0, penalizedA: false, penalizedB: false });
    expect(a).toEqual(b);
  });
});
