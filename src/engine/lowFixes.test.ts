import { afterAll, describe, expect, it } from 'vitest';
import { runProjection } from './projection';
import { REC_GOALS } from './recommender';
import { defaultScenarios, evaluateScenario } from './scenario';
import { hsaOnlyPlan, withHsa } from './__testutil__/hsaPlans';
import * as golden from './__golden/plans';
import { pinDate, unpinDate } from './__regression__/snapshotUtil';

/** Audit Lows (2026-10-21): the HSA penalty in lifetime tax totals, and the Lower Returns scenario. */
pinDate();
afterAll(unpinDate);

describe('HSA early-draw penalty in lifetime tax totals', () => {
  it('the min-tax score counts the 20% penalty, an additional federal tax', () => {
    const proj = runProjection(hsaOnlyPlan(0));
    const penalty = proj.rows.reduce((s, r) => s + r.hsaPenalty, 0);
    expect(penalty).toBeGreaterThan(0);
    const taxes = proj.rows.reduce((s, r) => s + r.fedTax + r.stateTaxAmt + r.irmaa + r.niit, 0);
    expect(REC_GOALS['min-tax'].score(proj)).toBeCloseTo(taxes + penalty, 6);
  });
});

describe('Lower Returns (4%) scenario', () => {
  it('lowers an explicit HSA return too, so the HSA grows at 4% like the other accounts', () => {
    const base = withHsa(golden.planA_simple(), { a: { hsa: 100_000 } });
    const plan = { ...base, assumptions: { ...base.assumptions, hsaReturn: 0.08 } };
    const lower = defaultScenarios(plan).find((s) => s.id === 'lower-return')!;
    const r = evaluateScenario(plan, lower);
    expect(r.effectivePlan.assumptions.hsaReturn).toBe(0.04);
    expect(r.projection.rows[0].endHSA).toBeCloseTo(100_000 * 1.04, 6);
  });

  it('changes nothing for a plan whose HSA follows the pre-tax return', () => {
    const plan = withHsa(golden.planA_simple(), { a: { hsa: 100_000 } });
    const lower = defaultScenarios(plan).find((s) => s.id === 'lower-return')!;
    const { hsaReturn: _drop, ...rest } = lower.overrides.assumptions!;
    void _drop;
    const without = evaluateScenario(plan, { ...lower, overrides: { assumptions: rest } });
    expect(evaluateScenario(plan, lower).projection.rows).toEqual(without.projection.rows);
  });
});
