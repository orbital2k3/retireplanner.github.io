import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as golden from './__golden/plans';
import type { Plan } from '../schemas/plan';
import { optimizeStrategy } from './optimizer';
import { optimizeCached } from './__testutil__/optimizeCached';
import { assertProjectionInvariants } from './__invariants__/assertions';
import { enc, pinDate, unpinDate } from './__regression__/snapshotUtil';

/** Opt tier: how the optimizer behaves when a plan has charitable giving that can be paid as QCDs.
 *  planG (CA couple) is the cheap fixture; each optimized run is ~17s, so keep the count low. */

beforeAll(pinDate);
afterAll(unpinDate);

const withGiving = (base: Plan, category: 'charitable' | 'general', extra: Partial<Plan> = {}): Plan => ({
  ...base,
  expenseStreams: [...base.expenseStreams, {
    id: 'giving', description: 'Giving', whose: 'Household', startAge: base.personA.retirementAge,
    end: { mode: 'lastSurvivor' }, survivorPct: 1, annualAmount: 20_000, inflationPct: { mode: 'fixed', rate: 0.025 }, category,
  }],
  ...extra,
});
const sumRows = (rows: { rothConv: number }[]) => rows.reduce((s, r) => s + r.rothConv, 0);

describe('optimizer with QCD-eligible giving', () => {
  // The optimizer owns the conversions here (optimize:true), as it does for a fresh plan in the app.
  const optimizing = (cat: 'charitable' | 'general') => {
    const base = golden.planG_californiaCouple();
    return withGiving(base, cat, { conversion: { ...base.conversion, mode: 'off', optimize: true } });
  };

  it('paying the same gifts as QCDs scores at least as well and needs no more lifetime conversion', () => {
    const qcdPlan = optimizing('charitable');
    const cash = optimizeCached(optimizing('general'), 'max-end-balance', { thorough: false });
    const qcd = optimizeCached(qcdPlan, 'max-end-balance', { thorough: false });
    assertProjectionInvariants(qcd.projection, qcdPlan);
    // The optimizer's own projection actually pays QCDs.
    expect(qcd.projection.rows.some((r) => r.qcd > 0)).toBe(true);
    expect(cash.projection.rows.every((r) => r.qcd === 0)).toBe(true);
    // QCD only adds an option, so the score should not fall (small slack for the heuristic search).
    expect(qcd.metric).toBeGreaterThanOrEqual(cash.metric - 0.005 * Math.abs(cash.metric));
    // QCDs shrink future RMD tax, so the optimizer needs fewer conversions over the plan.
    // (Not "fewer before 70½": in practice the optimizer converts a little more early, because the
    // $1,000/$2,000 deduction on pre-QCD cash gifts opens room; the total is what falls.)
    expect(sumRows(qcd.projection.rows)).toBeLessThanOrEqual(sumRows(cash.projection.rows) * 1.02 + 1_000);
  }, 300_000);

  it('is deterministic with QCD giving (two independent runs agree exactly)', () => {
    const base = golden.planG_californiaCouple(); // fixed bracket-fill mode: the cheap path
    const plan = withGiving(base, 'charitable');
    const a = optimizeStrategy(structuredClone(plan), 'max-end-balance', { thorough: false });
    const b = optimizeStrategy(structuredClone(plan), 'max-end-balance', { thorough: false });
    expect(enc(a.perYearPolicy)).toBe(enc(b.perYearPolicy));
    expect(enc(a.metric)).toBe(enc(b.metric));
    expect(a.projection.rows.some((r) => r.qcd > 0)).toBe(true);
  }, 300_000);
});
