import { describe, it, expect, beforeEach } from 'vitest';
import { usePlanStore } from './usePlanStore';
import { planStatus, resultStatus } from '../engine/strategy/savedPlan';
import { optimizedSaved } from '../engine/__testutil__/savedPlans';

describe('setConversion edits one slot', () => {
  beforeEach(() => usePlanStore.setState({ plan: optimizedSaved() }));

  it('an optimizer-slot edit keeps the result but marks it stale (when conversions are user-owned)', () => {
    usePlanStore.getState().editOptimizer({ optimizerDecidesConversions: false });
    usePlanStore.getState().setConversion('optimizer', { mode: 'auto-window' });
    const plan = usePlanStore.getState().plan;
    expect(plan.strategy.result).toBeDefined();
    expect(plan.strategy.optimizer.conversion.mode).toBe('auto-window');
    expect(planStatus(plan)).toBe('stale');
  });

  it('a manual-slot edit leaves the optimizer slot and the result untouched', () => {
    const before = usePlanStore.getState().plan;
    usePlanStore.getState().setConversion('manual', { mode: 'bracket-fill', bracketCeiling: 1 });
    const plan = usePlanStore.getState().plan;
    expect(plan.strategy.optimizer).toBe(before.strategy.optimizer);
    expect(plan.strategy.result).toBe(before.strategy.result);
    expect(resultStatus(plan)).toBe('fresh');
  });
});
