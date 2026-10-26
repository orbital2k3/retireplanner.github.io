import { afterAll, describe, expect, it } from 'vitest';
import { runMonteCarlo } from './monteCarlo';
import { runProjection } from './projection';
import { mulberry32, parametricNormal } from './returnModels';
import { pinDate, unpinDate } from './__regression__/snapshotUtil';
import { hsaOnlyPlan, withExpenses, withHsa } from './__testutil__/hsaPlans';
import { planR_hsaEarlyRetiree } from './__golden/plans';
import type { Plan } from '../schemas/plan';

pinDate(); // at load, so fixtures built while collecting describe blocks see the pinned year too
afterAll(unpinDate);

/** H-11: Monte Carlo runs the same projection with a stochastic return path, so the HSA must compound on
 *  that path like every other bucket (and count in the totals the percentile bands are built from). */

/** Nothing but an HSA that never pays and nobody spends from: its value is exactly HSA0 x prod(1 + r_t). */
const hsaOnlyNoSpend = (): Plan => {
  const p = withExpenses(withHsa(hsaOnlyPlan(0, 0), { policyAge: 120 }), []);
  // no Social Security either, or its surplus would be swept into the taxable account
  return { ...p, personA: { ...p.personA, ssPIA: 0 }, personB: { ...p.personB!, ssPIA: 0 } };
};

describe('Monte Carlo and the HSA (H-11)', () => {
  it('a single parametric trial grows the HSA along the exact sampled return path', () => {
    const plan = hsaOnlyNoSpend();
    const seed = 7, mean = 0.06, sd = 0.12;
    const mc = runMonteCarlo(plan, { trials: 1, model: 'parametric', seed, meanReturn: mean, stdDev: sd });
    // the same RNG stream the trial used
    const n = mc.ages.length;
    const returns = parametricNormal(mulberry32(seed), mean, sd, n);
    let v = plan.portfolio.personA.hsa!;
    for (let i = 0; i < n; i++) {
      v *= 1 + returns[i];
      expect(mc.p50Nominal[i]).toBeCloseTo(v, 4);     // one trial: every percentile is that trial
    }
    // and the projection with those overrides agrees row by row
    const rows = runProjection(plan, { returnOverrides: returns }).rows;
    expect(rows[n - 1].endHSA).toBeCloseTo(v, 4);
    expect(rows[n - 1].endTotal).toBeCloseTo(v, 4);
  });

  it('a stochastic path moves the HSA balance and the total together (HSA is not on a fixed rate)', () => {
    const plan = withHsa(planR_hsaEarlyRetiree(), { a: {} });
    const crash = Array.from({ length: 60 }, (_, i) => (i === 0 ? -0.30 : 0.065));
    const flat = runProjection(plan).rows;
    const bad = runProjection(plan, { returnOverrides: crash }).rows;
    expect(bad[0].endHSA).toBeCloseTo(150_000 * 0.70 + 8_750, 4);   // 30% down, then the year's contribution
    expect(bad[0].endHSA).toBeLessThan(flat[0].endHSA);
    expect(bad[0].endTotal).toBeLessThan(flat[0].endTotal);
  });

  it('includes the HSA in the totals the bands are built from', () => {
    const withH = planR_hsaEarlyRetiree();
    const noH: Plan = { ...withH, portfolio: {
      ...withH.portfolio,
      personA: { ...withH.portfolio.personA, hsa: 0, hsaContribution: 0, hsaReceipts: 0, hsaContribInRetirement: false },
    } };
    const a = runMonteCarlo(withH, { trials: 40, model: 'parametric', seed: 11 });
    const b = runMonteCarlo(noH, { trials: 40, model: 'parametric', seed: 11 });
    // same paths, more assets: a higher median end balance and no lower success rate
    expect(a.medianEndBalance).toBeGreaterThan(b.medianEndBalance);
    expect(a.successRate).toBeGreaterThanOrEqual(b.successRate);
    expect(a.ages.length).toBe(b.ages.length);
  });

  it('is deterministic for a fixed seed', () => {
    const p = planR_hsaEarlyRetiree();
    const a = runMonteCarlo(p, { trials: 25, model: 'historical', seed: 3 });
    const b = runMonteCarlo(p, { trials: 25, model: 'historical', seed: 3 });
    expect(a.p50Nominal).toEqual(b.p50Nominal);
    expect(a.successRate).toBe(b.successRate);
  });
});
