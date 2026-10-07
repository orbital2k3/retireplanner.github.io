import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { PlanSchema, type Plan } from '../../schemas/plan';
import { optimizerKey } from './optimizerInput';
import { savedOptimizerKey, planStatus, fromFlat } from './savedPlan';
import { exportPlanToJSON, importPlanFromJSON } from '../../storage/exportImport';
import { richPlan, shuffleKeys } from '../__testutil__/strategyPlans';

const parsed = (): Plan => PlanSchema.parse(richPlan());
const withSchedule = (p: Plan, manualSchedule: Record<string, number>, optimize = false): Plan =>
  ({ ...p, conversion: { ...p.conversion, mode: 'manual', optimize, manualSchedule } });

describe('§6.2 optimizerKey stability', () => {
  it('ignores key order at every depth', () => {
    const p = parsed();
    const k = optimizerKey(p);
    fc.assert(fc.property(fc.integer({ min: 1 }), (seed) => optimizerKey(shuffleKeys(p, seed)) === k), { numRuns: 100 });
  });

  it('survives PlanSchema.parse of a shuffled plan', () => {
    const p = parsed();
    const k = optimizerKey(p);
    fc.assert(fc.property(fc.integer({ min: 1 }), (seed) => optimizerKey(PlanSchema.parse(shuffleKeys(p, seed))) === k), { numRuns: 50 });
  });

  it('survives a JSON round trip (store persist / rehydrate)', () => {
    const p = parsed();
    expect(optimizerKey(JSON.parse(JSON.stringify(p)))).toBe(optimizerKey(p));
  });

  it('survives export then import (stored shape)', () => {
    const saved = fromFlat(parsed(), false);
    const r = importPlanFromJSON(exportPlanToJSON(shuffleKeys(saved, 7)));
    expect(r.ok).toBe(true);
    expect(savedOptimizerKey(r.plan!)).toBe(savedOptimizerKey(saved));
  });

  it('keeps a fresh result fresh through export then import', () => {
    const saved = fromFlat(parsed(), true);
    expect(planStatus(saved)).toBe('fresh');
    expect(planStatus(importPlanFromJSON(exportPlanToJSON(shuffleKeys(saved, 3))).plan!)).toBe('fresh');
  });

  it('ignores retired fields left on old saved plans', () => {
    const p = parsed();
    const withRetired = {
      ...p,
      personA: { ...p.personA, passingAge: 95, planToAge: 95 },
      assumptions: { ...p.assumptions, equityPct: 0.6, preRetReturn: 0.05 },
    } as unknown as Plan;
    expect(optimizerKey(withRetired)).toBe(optimizerKey(p));
  });

  it('treats undefined and absent optional fields the same', () => {
    const p = parsed();
    const { customStateTaxRate: _drop, ...rest } = p;
    void _drop;
    expect(optimizerKey({ ...p, customStateTaxRate: undefined })).toBe(optimizerKey(rest as Plan));
  });
});

describe('§6.2 manual conversion schedule in the key', () => {
  const sched = fc.dictionary(fc.integer({ min: 55, max: 80 }).map(String), fc.integer({ min: 1, max: 200_000 }), { maxKeys: 8 });

  it('order of entries does not matter', () => {
    fc.assert(fc.property(sched, fc.integer({ min: 1 }), (s, seed) =>
      optimizerKey(withSchedule(parsed(), s)) === optimizerKey(withSchedule(parsed(), shuffleKeys(s, seed)))));
  });

  it('zero entries do not matter', () => {
    fc.assert(fc.property(sched, fc.integer({ min: 81, max: 95 }), (s, zeroAge) =>
      optimizerKey(withSchedule(parsed(), s)) === optimizerKey(withSchedule(parsed(), { ...s, [zeroAge]: 0 }))));
  });

  it('a non-zero amount change matters when conversions are user-owned', () => {
    const p = parsed();
    expect(optimizerKey(withSchedule(p, { '60': 50_000 }))).not.toBe(optimizerKey(withSchedule(p, { '60': 60_000 })));
    expect(optimizerKey(withSchedule(p, { '60': 50_000 }))).not.toBe(optimizerKey(withSchedule(p, { '60': 50_000, '61': 1 })));
  });

  it('the schedule does not matter when the optimizer owns conversions', () => {
    const p = parsed();
    expect(optimizerKey(withSchedule(p, { '60': 50_000 }, true))).toBe(optimizerKey(withSchedule(p, { '60': 60_000 }, true)));
  });
});
