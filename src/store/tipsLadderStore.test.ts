/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { usePlanStore } from './usePlanStore';
import { savedOptimizerKey } from '../engine/strategy/savedPlan';

describe('setTipsLadder', () => {
  const rung = { id: 'r', maturityYear: 2031, adjustedPrincipal: 10_000, couponRate: 0.01, account: 'taxable' as const, whose: 'Household' as const };

  it('stores a ladder, and removing it (undefined or no rungs) restores the exact saved shape and optimizer key', () => {
    const before = usePlanStore.getState().plan;
    const keyBefore = savedOptimizerKey(before);
    expect('tipsLadder' in before.portfolio).toBe(false);

    usePlanStore.getState().setTipsLadder({ rungs: [rung] });
    const withLadder = usePlanStore.getState().plan;
    expect(withLadder.portfolio.tipsLadder?.rungs).toHaveLength(1);
    expect(savedOptimizerKey(withLadder)).not.toBe(keyBefore);        // the ladder is a fact the optimizer sees

    usePlanStore.getState().setTipsLadder({ rungs: [] });
    expect('tipsLadder' in usePlanStore.getState().plan.portfolio).toBe(false);
    expect(savedOptimizerKey(usePlanStore.getState().plan)).toBe(keyBefore);

    usePlanStore.getState().setTipsLadder({ rungs: [rung] });
    usePlanStore.getState().setTipsLadder(undefined);
    expect('tipsLadder' in usePlanStore.getState().plan.portfolio).toBe(false);
    expect(savedOptimizerKey(usePlanStore.getState().plan)).toBe(keyBefore);
  });

  it('leaves the other portfolio fields (including the HSA policy) alone', () => {
    usePlanStore.getState().setHsaPolicy({ payMedicalFromAge: 60 });
    usePlanStore.getState().setTipsLadder({ rungs: [rung] });
    expect(usePlanStore.getState().plan.portfolio.hsaPolicy).toEqual({ payMedicalFromAge: 60 });
    usePlanStore.getState().setTipsLadder(undefined);
    expect(usePlanStore.getState().plan.portfolio.hsaPolicy).toEqual({ payMedicalFromAge: 60 });
    usePlanStore.getState().setHsaPolicy(undefined);
  });
});
