import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMonteCarlo } from './monteCarlo';
import { planB_largeTradSingle } from './__golden/plans';
import type { Plan } from '../schemas/plan';
import { pinDate, unpinDate } from './__regression__/snapshotUtil';
import { rung, thisYear, withExpenses, withTips } from './__testutil__/tipsPlans';
import { planWithoutLadder } from './tipsLadder';

beforeAll(pinDate);
afterAll(unpinDate);

/** T-5 / TU-3: the claim the Monte Carlo page makes about a ladder, checked on a real fixture. A retiree
 *  lives on a Roth account for 11 years. With the same money in zero-coupon rungs that pay exactly the
 *  spending each year, no market path can hurt those years; as a plain Roth balance, bad paths run out. */
const Y = thisYear();
const spend = 60_000, cpi = 0.025;

const roth700 = (): Plan => {
  const p = planB_largeTradSingle();
  return withExpenses({
    ...p,
    personA: { ...p.personA, dob: `${Y - 60}-03-01`, retirementAge: 60, planThroughAge: 70, ssPIA: 0, ssClaimAge: 70 },
    portfolio: { personA: { ...p.portfolio.personA, taxable: 0, taxableBasis: 0, traditional: 0, roth: 700_000, annualContribution: 0 }, personB: undefined },
    incomeStreams: [],
    conversion: { ...p.conversion, mode: 'off', optimize: false },
  }, [{ ...p.expenseStreams[0], startAge: 60, annualAmount: spend, inflationPct: { mode: 'cpi' } }]);
};

/** One zero-coupon Roth rung per year, sized for 2.5% CPI so each pays that year's spending (rung k pays
 *  P x 1.025^(k+1)). Spending is CPI-linked, so the two track each other on any CPI path. */
const ladderPlan = (): Plan => withTips(roth700(), Array.from({ length: 11 }, (_, k) =>
  rung({ maturityYear: Y + k, adjustedPrincipal: spend / (1 + cpi), couponRate: 0, account: 'roth', whose: 'Household' })));

describe('Monte Carlo and the TIPS ladder', () => {
  const opts = { trials: 300, model: 'parametric' as const, meanReturn: 0.04, stdDev: 0.22, seed: 11 };

  it('the same money as a plain Roth balance fails in bad paths, as a ladder it never does', () => {
    const plain = runMonteCarlo(roth700(), opts);
    const ladder = runMonteCarlo(ladderPlan(), opts);
    expect(plain.successRate).toBeLessThan(0.97);
    expect(ladder.successRate).toBe(1);
    // and the bad end of the distribution is far better with the ladder
    expect(ladder.p10EndBalance).toBeGreaterThan(plain.p10EndBalance);
  });

  it('is independent of the seed: a ladder-funded plan has one outcome under every return path', () => {
    for (const seed of [1, 2, 3]) {
      expect(runMonteCarlo(ladderPlan(), { ...opts, seed }).successRate).toBe(1);
    }
  });

  it('works on historical bootstrap paths too (they carry real CPI, which the ladder follows)', () => {
    const r = runMonteCarlo(ladderPlan(), { trials: 200, model: 'historical', seed: 5 });
    expect(r.successRate).toBeGreaterThan(0.99);
  });

  it('TB-3: planWithoutLadder gives back the same money as plain balances (carve-out only)', () => {
    expect(planWithoutLadder(ladderPlan(), Y)).toEqual(roth700());
    const without = runMonteCarlo(planWithoutLadder(ladderPlan(), Y)!, opts);
    expect(without.successRate).toBe(runMonteCarlo(roth700(), opts).successRate);
    // On-top ladders and plans without a live ladder have no same-money counterpart.
    const onTop = withTips(roth700(), ladderPlan().portfolio.tipsLadder!.rungs, false);
    expect(planWithoutLadder(onTop, Y)).toBeNull();
    expect(planWithoutLadder(roth700(), Y)).toBeNull();
  });
});
