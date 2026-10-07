import { describe, it, expect } from 'vitest';
import { optimizeCached } from '../__testutil__/optimizeCached';
import { runProjection } from '../projection';
import { applyResultToPlan } from '../applyOptimizerResult';
import { policyStatus } from '../policyStatus';
import { planF_allTradCouple } from '../__golden/plans';
import { FED_BRACKETS_MFJ } from '../taxConstants';
import type { Plan } from '../../schemas/plan';

// §6.8 opt tier: real optimizer on a cheap fixture.
const OPTS = { useNelderMead: false };
const bracketFill = (bracketCeiling: number): Plan => {
  const p = planF_allTradCouple();
  return { ...p, conversion: { ...p.conversion, mode: 'bracket-fill', optimize: false, startAge: 62, endAge: 77, bracketCeiling } };
};

describe('§6.8 frozen settings with the real optimizer', () => {
  it('round-trips when "Set it myself" settings and a leftover manual schedule differ from neutral', () => {
    const base = planF_allTradCouple();
    const plan: Plan = {
      ...base,
      withdrawalStrategy: 'bracketfill',
      withdrawalBracketCeiling: FED_BRACKETS_MFJ[2][0],
      conversion: { ...base.conversion, mode: 'manual', optimize: true, manualSchedule: { '60': 80_000, '70': 50_000 } },
    };
    const result = optimizeCached(plan, 'max-end-balance', OPTS);
    const applied = applyResultToPlan(plan, result);
    const reproj = runProjection(applied);
    expect(reproj.endTotalReal).toBeCloseTo(result.projection.endTotalReal, 0);
    expect(reproj.lifetimeConversion).toBeCloseTo(result.projection.lifetimeConversion, 0);
    expect(policyStatus(applied)).toBe('fresh');
  }, 180_000);

  it('editing the conversion ceiling keeps the charts until re-run; the re-run differs', () => {
    const first = bracketFill(FED_BRACKETS_MFJ[1][0]);
    const applied = applyResultToPlan(first, optimizeCached(first, 'max-end-balance', OPTS));
    const before = runProjection(applied);
    const edited: Plan = { ...applied, conversion: { ...applied.conversion, bracketCeiling: FED_BRACKETS_MFJ[2][0] } };
    expect(runProjection(edited).endTotalReal).toBe(before.endTotalReal);
    expect(policyStatus(edited)).toBe('stale');

    const rerun = optimizeCached(edited, 'max-end-balance', OPTS);
    const reapplied = applyResultToPlan(edited, rerun);
    expect(policyStatus(reapplied)).toBe('fresh');
    expect(runProjection(reapplied).lifetimeConversion).not.toBeCloseTo(before.lifetimeConversion, 0);
  }, 180_000);

  it('manual-slot edits do not change the optimizer output', () => {
    const plan = bracketFill(FED_BRACKETS_MFJ[1][0]);
    const a = optimizeCached(plan, 'max-end-balance', OPTS);
    const leaky: Plan = {
      ...plan,
      withdrawalStrategy: 'proportional',
      withdrawalBracketCeiling: FED_BRACKETS_MFJ[3][0],
      customPolicy: { windows: [{ fromAge: 60, toAge: 95, pctTaxable: 0, pctTraditional: 1, pctRoth: 0 }], source: 'manual' },
    };
    const b = optimizeCached(leaky, 'max-end-balance', OPTS);
    expect(b.policy.windows).toEqual(a.policy.windows);
    expect(b.projection.endTotalReal).toBe(a.projection.endTotalReal);
  }, 180_000);
});
