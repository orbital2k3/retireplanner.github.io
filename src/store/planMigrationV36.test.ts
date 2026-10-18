/** @vitest-environment jsdom */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SavedPlanSchema, type SavedPlan } from '../schemas/savedPlan';
import { runProjection } from '../engine/projection';
import { enginePlan, planStatus, savedOptimizerKey } from '../engine/strategy/savedPlan';
import { exportPlanToJSON, importPlanFromJSON } from '../storage/exportImport';
import { optimizedSaved, sampleSaved } from '../engine/__testutil__/savedPlans';
import { pinDate, unpinDate } from '../engine/__regression__/snapshotUtil';
import { PLAN_STORE_VERSION } from './planStoreVersion';
import { usePlanStore } from './usePlanStore';

/** Upgrade freshness for v35 → v36 (QCD). The v36 schema adds only optional expense fields, so a plan
 *  saved by v35 must load unchanged: same optimizer key, result still fresh, same projection.
 *  v35-baselines.json was captured on the v35 code (commit 869e998): the saved plan as that build
 *  stored it, its optimizer key, status and headline numbers. */

interface Baseline {
  name: string; key: string; resultKey: string; status: string;
  endTotalReal: number; lifetimeFedTax: number; saved: SavedPlan;
}
const baselines = JSON.parse(readFileSync(join(__dirname, '../engine/__fixtures__/exports/v35-baselines.json'), 'utf8')) as Baseline[];

/** The three legacy export files, imported by the v35 code (869e998): status, key and headline numbers. */
interface LegacyBaseline { n: string; status: string; key: string; endTotalReal: number; lifetimeFedTax: number; lifetimeConversion: number }
const legacy = JSON.parse(readFileSync(join(__dirname, '../engine/__fixtures__/exports/v35-legacy-imports.json'), 'utf8')) as LegacyBaseline[];

const migrateStore = (plan: unknown, from: number) =>
  (usePlanStore.persist.getOptions().migrate!({ plan, scenarios: [] }, from) as { plan: SavedPlan }).plan;

beforeAll(pinDate);
afterAll(unpinDate);

describe('v35 → v36 on captured plans', () => {
  it('is store version 36', () => {
    expect(PLAN_STORE_VERSION).toBe(36);
  });

  it('has fresh baselines for the sample, rich and golden plans', () => {
    expect(baselines.length).toBe(18);
    expect(baselines.every((b) => b.status === 'fresh' && b.key === b.resultKey)).toBe(true);
  });

  for (const b of baselines) {
    it(`${b.name}: store migration leaves the plan, key and status exactly as v35 had them`, () => {
      const stored = JSON.parse(JSON.stringify(b.saved));
      const after = migrateStore(JSON.parse(JSON.stringify(b.saved)), 35);
      expect(after).toEqual(stored);
      expect(SavedPlanSchema.safeParse(after).success).toBe(true);
      expect(savedOptimizerKey(after)).toBe(b.key);
      expect(after.strategy.result!.inputKey).toBe(b.resultKey);
      expect(planStatus(after)).toBe('fresh');
      const proj = runProjection(enginePlan(after));
      expect(proj.endTotalReal).toBe(b.endTotalReal);
      expect(proj.lifetimeFedTax).toBe(b.lifetimeFedTax);
    });

    it(`${b.name}: a v35 export imports fresh with the same key and projection`, () => {
      const file = JSON.stringify({ app: 'retirement-optimizer', version: 1, exportedAt: '2026-10-17T00:00:00Z', planVersion: 35, plan: b.saved });
      const r = importPlanFromJSON(file);
      expect(r.ok).toBe(true);
      expect(savedOptimizerKey(r.plan!)).toBe(b.key);
      expect(planStatus(r.plan!)).toBe('fresh');
      expect(runProjection(enginePlan(r.plan!)).endTotalReal).toBe(b.endTotalReal);
    });
  }

  it('no expense row gains a category or qcd key on the way in', () => {
    for (const b of baselines) {
      const after = migrateStore(JSON.parse(JSON.stringify(b.saved)), 35);
      for (const e of after.expenseStreams) {
        expect('category' in e).toBe(false);
        expect('qcd' in e).toBe(false);
      }
    }
  });
});

describe('legacy export files import exactly as they did on v35', () => {
  for (const b of legacy) {
    it(`${b.n}.json: same status, optimizer key and headline numbers`, () => {
      const r = importPlanFromJSON(readFileSync(join(__dirname, `../engine/__fixtures__/exports/${b.n}.json`), 'utf8'));
      expect(r.ok).toBe(true);
      expect(planStatus(r.plan!)).toBe(b.status);
      expect(savedOptimizerKey(r.plan!)).toBe(b.key);
      const proj = runProjection(enginePlan(r.plan!));
      expect(proj.endTotalReal).toBe(b.endTotalReal);
      expect(proj.lifetimeFedTax).toBe(b.lifetimeFedTax);
      expect(proj.lifetimeConversion).toBe(b.lifetimeConversion);
    });
  }
});

describe('plans written by v36', () => {
  it('round-trip through export and import unchanged, tags included', () => {
    const base = sampleSaved();
    const tagged: SavedPlan = {
      ...base,
      expenseStreams: base.expenseStreams.map((e, i) => i === 0 ? { ...e, category: 'charitable' as const, qcd: false } : e),
    };
    const fresh = optimizedSaved(tagged);
    const r = importPlanFromJSON(exportPlanToJSON(fresh));
    expect(r.ok).toBe(true);
    expect(r.plan!.expenseStreams[0]).toMatchObject({ category: 'charitable', qcd: false });
    expect(planStatus(r.plan!)).toBe('fresh');
    expect(savedOptimizerKey(r.plan!)).toBe(savedOptimizerKey(fresh));
  });

  it('tagging a row after a result is built marks the result out of date, as any plan fact does', () => {
    const fresh = optimizedSaved();
    const edited: SavedPlan = {
      ...fresh,
      expenseStreams: fresh.expenseStreams.map((e, i) => i === 0 ? { ...e, category: 'charitable' as const } : e),
    };
    expect(planStatus(edited)).toBe('stale');
  });
});
