/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { samplePlan, type Plan } from '../schemas/plan';
import { policyStatus } from '../engine/policyStatus';
import { planStatus } from '../engine/strategy/savedPlan';
import type { SavedPlan } from '../schemas/savedPlan';
import { usePlanStore } from './usePlanStore';
import { legacyPlanInputKey, legacyManualScheduleKey, migratePlanToV34 } from './planMigrations';
import { importPlanFromJSON } from '../storage/exportImport';
import { richPlan, OPT_WINDOW } from '../engine/__testutil__/strategyPlans';

/** A v33 saved plan whose optimizer result was stamped by the old keys. */
function v33Plan(opts: { fresh: boolean; scheduleEdited?: boolean }): Record<string, unknown> {
  const p = JSON.parse(JSON.stringify(richPlan())) as Record<string, unknown>;
  const cp = { windows: [OPT_WINDOW], source: 'optimizer', goal: 'max-end-balance' } as Record<string, unknown>;
  p.customPolicy = cp;
  cp.inputKey = opts.fresh ? legacyPlanInputKey(p) : 'old-key';
  cp.manualScheduleKey = legacyManualScheduleKey(p);
  if (opts.scheduleEdited) (p.conversion as { manualSchedule: Record<string, number> }).manualSchedule['62'] = 30_000;
  return p;
}

const migrateStore = (plan: Record<string, unknown>, from: number) =>
  (usePlanStore.persist.getOptions().migrate!({ plan, scenarios: [] }, from) as { plan: SavedPlan }).plan;

describe('v33 → v34 migration', () => {
  it('keeps a result that was current under the old keys current', () => {
    const raw = v33Plan({ fresh: true });
    migratePlanToV34(raw);
    expect(policyStatus(raw as unknown as Plan)).toBe('fresh');
    expect((raw.customPolicy as Record<string, unknown>).manualScheduleKey).toBeUndefined();
  });

  it('leaves an out-of-date result out of date', () => {
    const raw = v33Plan({ fresh: false });
    migratePlanToV34(raw);
    expect(policyStatus(raw as unknown as Plan)).toBe('stale');
  });

  it('marks a result stale when the manual amounts were edited after the run (2c8a4e5)', () => {
    const raw = v33Plan({ fresh: true, scheduleEdited: true });
    migratePlanToV34(raw);
    expect(policyStatus(raw as unknown as Plan)).toBe('stale');
  });

  it('runs through the store migrate hook from v33', () => {
    expect(planStatus(migrateStore(v33Plan({ fresh: true }), 33))).toBe('fresh');
    expect(planStatus(migrateStore(v33Plan({ fresh: false }), 33))).toBe('stale');
  });

  it('keeps a v28 plan fresh after v29 stamps it and v34 re-stamps it', () => {
    const p = JSON.parse(JSON.stringify(samplePlan())) as Record<string, unknown>;
    p.customPolicy = { windows: [OPT_WINDOW], source: 'optimizer' };
    expect(planStatus(migrateStore(p, 28))).toBe('fresh');
  });

  it('leaves manual and absent policies alone', () => {
    const p = JSON.parse(JSON.stringify(samplePlan())) as Record<string, unknown>;
    migratePlanToV34(p);
    expect(p.customPolicy).toBeUndefined();
    p.customPolicy = { windows: [OPT_WINDOW], source: 'manual' };
    migratePlanToV34(p);
    expect(policyStatus(p as unknown as Plan)).toBe('hand-edited');
  });
});

describe('import of pre-v34 exports', () => {
  const file = (plan: Record<string, unknown>) =>
    JSON.stringify({ app: 'retirement-optimizer', version: 1, exportedAt: '2026-10-01T00:00:00Z', plan });

  it('keeps a result that was current in the file current', () => {
    expect(planStatus(importPlanFromJSON(file(v33Plan({ fresh: true }))).plan!)).toBe('fresh');
  });

  it('keeps an out-of-date result out of date', () => {
    expect(planStatus(importPlanFromJSON(file(v33Plan({ fresh: false }))).plan!)).toBe('stale');
    expect(planStatus(importPlanFromJSON(file(v33Plan({ fresh: true, scheduleEdited: true }))).plan!)).toBe('stale');
  });
});
