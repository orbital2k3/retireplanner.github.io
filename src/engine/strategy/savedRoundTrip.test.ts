import { describe, it, expect } from 'vitest';
import { optimizeCached } from '../__testutil__/optimizeCached';
import { runProjection } from '../projection';
import { planF_allTradCouple, planP_tightPlan } from '../__golden/plans';
import type { SavedPlan, ConversionSettings } from '../../schemas/savedPlan';
import type { UserGoal } from '../recommender';
import { fromFlat, optimizerView, applyResult, enginePlan, resultStatus, planStatus, canReOptimize } from './savedPlan';

// §6.8 opt tier: applyResult round trip (I3) with the real optimizer for each conversion setting.
const OPTS = { useNelderMead: false };

type Setting = 'optimizer decides' | 'bracket-fill' | 'fixed' | 'manual';
const CONVERSION: Record<Exclude<Setting, 'optimizer decides'>, Partial<ConversionSettings>> = {
  'bracket-fill': { mode: 'bracket-fill', startAge: 65, endAge: 74 },
  fixed: { mode: 'auto-window', startAge: 65, endAge: 72, autoAmount: 60_000 },
  manual: { mode: 'manual', manualSchedule: { '66': 80_000, '67': 80_000, '70': 40_000 } },
};

function withSetting(base: SavedPlan, setting: Setting): SavedPlan {
  const o = base.strategy.optimizer;
  const optimizer = setting === 'optimizer decides'
    ? { ...o, optimizerDecidesConversions: true }
    : { ...o, optimizerDecidesConversions: false, conversion: { ...o.conversion, ...CONVERSION[setting] } };
  return { ...base, strategy: { ...base.strategy, active: 'optimizer', optimizer } };
}

function roundTrip(base: SavedPlan, goal: UserGoal) {
  const plan = { ...base, strategy: { ...base.strategy, optimizer: { ...base.strategy.optimizer, goal } } };
  const result = optimizeCached(optimizerView(plan), goal, OPTS);
  const applied = applyResult(plan, result);
  return { result, applied, proj: runProjection(enginePlan(applied)) };
}

describe('§6.8 saved-plan round trip with the real optimizer, per conversion setting', () => {
  const SETTINGS: Setting[] = ['optimizer decides', 'bracket-fill', 'fixed', 'manual'];
  for (const setting of SETTINGS) {
    it(`${setting}: charts equal the optimizer's projection, status fresh, Re-optimize off`, () => {
      const base = withSetting(fromFlat(planF_allTradCouple(), false), setting);
      const { result, applied, proj } = roundTrip(base, 'max-end-balance');
      expect(proj.endTotalReal).toBeCloseTo(result.projection.endTotalReal, 0);
      expect(proj.lifetimeConversion).toBeCloseTo(result.projection.lifetimeConversion, 0);
      expect(resultStatus(applied)).toBe('fresh');
      expect(planStatus(applied)).toBe('fresh');
      expect(canReOptimize(applied)).toBe(false);
      // The manual slot is untouched by the run.
      expect(applied.strategy.manual).toEqual(base.strategy.manual);
      if (setting === 'manual' && !result.conversionsDisabled) {
        // The schedule is held fixed: conversions happen in the scheduled years only.
        const byAge = new Map(proj.rows.map((r) => [r.ageA, r.rothConv]));
        expect(byAge.get(66)).toBeGreaterThan(0);
        expect(byAge.get(70)).toBeGreaterThan(0);
        expect(byAge.get(68)).toBe(0);
      }
    }, 180_000);
  }

  it('max spending (optimizer decides) on planP round-trips once applied', () => {
    const base = withSetting(fromFlat(planP_tightPlan(), false), 'optimizer decides');
    const { result, applied, proj } = roundTrip(base, 'max-sustainable-spending');
    expect(proj.endTotalReal).toBeCloseTo(result.projection.endTotalReal, 0);
    expect(resultStatus(applied)).toBe('fresh');
    expect(applied.strategy.result?.goal).toBe('max-sustainable-spending');
  }, 180_000);
});
