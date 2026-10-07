import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { importPlanFromJSON, exportPlanToJSON } from './exportImport';
import { optimizerKey } from '../engine/strategy/optimizerInput';
import { planStatus, enginePlan } from '../engine/strategy/savedPlan';
import { runProjection } from '../engine/projection';
import { migrateStoredPlan } from '../store/planMigrations';
import { SavedPlanSchema, type SavedPlan } from '../schemas/savedPlan';
import { samplePlan, type Plan } from '../schemas/plan';
import { optimizedSaved, staleSaved, sampleSaved } from '../engine/__testutil__/savedPlans';
import { MANUAL_WINDOW } from '../engine/__testutil__/strategyPlans';

const WINDOW = { fromAge: 60, toAge: 95, pctTaxable: 0.5, pctTraditional: 0.3, pctRoth: 0.2 };

/** A plan as an older app version saved it: retired field present, keys in a different order. */
function legacyShapedPlan(): Plan {
  const base = samplePlan();
  const { name, dob, ...restA } = base.personA;
  return { ...base, personA: { ...restA, passingAge: 95, dob, name } } as unknown as Plan;
}

/** A pre-v35 export file (flat plan). */
const flatFile = (plan: Plan, planVersion?: number) =>
  JSON.stringify({ app: 'retirement-optimizer', version: 1, exportedAt: '2026-10-01T00:00:00Z', planVersion, plan });

describe('importPlanFromJSON: pre-v35 (flat) files', () => {
  it('keeps a current optimizer policy current when parsing reorders or drops fields', () => {
    const raw = legacyShapedPlan();
    raw.customPolicy = { windows: [WINDOW], source: 'optimizer', inputKey: optimizerKey(raw) };
    const r = importPlanFromJSON(flatFile(raw));
    expect(r.ok).toBe(true);
    expect(r.plan!.strategy.active).toBe('optimizer');
    expect(planStatus(r.plan!)).toBe('fresh');
  });

  it('leaves a policy that was already out of date as stale', () => {
    const raw = legacyShapedPlan();
    raw.customPolicy = { windows: [WINDOW], source: 'optimizer', inputKey: 'old-key' };
    expect(planStatus(importPlanFromJSON(flatFile(raw)).plan!)).toBe('stale');
  });

  it('a hand-built blend lands in "Set it myself"', () => {
    const r = importPlanFromJSON(flatFile({ ...samplePlan(), customPolicy: { windows: [MANUAL_WINDOW], source: 'manual' } }, 34));
    expect(r.plan!.strategy).toMatchObject({ active: 'manual', manual: { customWindows: [MANUAL_WINDOW] } });
    expect(r.plan!.strategy.result).toBeUndefined();
  });
});

describe('importPlanFromJSON: v35 files (I7)', () => {
  it('a fresh export stays fresh', () => {
    expect(planStatus(importPlanFromJSON(exportPlanToJSON(optimizedSaved())).plan!)).toBe('fresh');
  });

  it('a stale export stays stale', () => {
    expect(planStatus(importPlanFromJSON(exportPlanToJSON(staleSaved())).plan!)).toBe('stale');
  });

  it('both slots, the active tab and the result survive', () => {
    const p = optimizedSaved();
    const manualActive = {
      ...p,
      strategy: { ...p.strategy, active: 'manual' as const, manual: { ...p.strategy.manual, preset: 'rothfirst' as const, customWindows: [MANUAL_WINDOW] } },
    };
    expect(importPlanFromJSON(exportPlanToJSON(manualActive)).plan).toEqual(manualActive);
  });

  it('rejects an invalid strategy block with a readable error', () => {
    const bad = JSON.parse(exportPlanToJSON(sampleSaved()));
    bad.plan.strategy.active = 'nobody';
    const r = importPlanFromJSON(JSON.stringify(bad));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/strategy\.active/);
  });
});

describe('importPlanFromJSON: files older than v24 (full migration chain)', () => {

  const OLD = ['fireopt-2026-05-29.json', 'fireopt-optimized.json'];
  const read = (f: string) => readFileSync(`src/engine/__fixtures__/exports/${f}`, 'utf8');

  for (const f of OLD) {
    it(`${f} imports and projects finite numbers`, () => {
      const r = importPlanFromJSON(read(f));
      expect(r.error).toBeUndefined();
      const proj = runProjection(enginePlan(r.plan!));
      expect(Number.isFinite(proj.endTotalReal)).toBe(true);
      expect(proj.rows.every((row) => Number.isFinite(row.totalWD) && Number.isFinite(row.rothConv))).toBe(true);
      // A result built by an old optimizer is kept, out of date, so the user is asked to re-run.
      if (r.plan!.strategy.result) expect(planStatus(r.plan!)).toBe('stale');
    });

    it(`${f} imports to the same plan the store migration produces from the same data`, () => {
      const file = JSON.parse(read(f));
      const fromStore = migrateStoredPlan(file.plan, 0);
      const imported = importPlanFromJSON(read(f)).plan!;
      const strip = (p: SavedPlan) => ({ ...p, strategy: { ...p.strategy, result: p.strategy.result && { ...p.strategy.result, inputKey: '' } } });
      expect(strip(imported)).toEqual(strip(SavedPlanSchema.parse(fromStore)));
    });
  }
});
