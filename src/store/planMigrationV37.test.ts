/** @vitest-environment jsdom */
import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SavedPlanSchema, type SavedPlan } from '../schemas/savedPlan';
import { runProjection } from '../engine/projection';
import { enginePlan, planStatus, savedOptimizerKey } from '../engine/strategy/savedPlan';
import { exportPlanToJSON, importPlanFromJSON } from '../storage/exportImport';
import { optimizedSaved, sampleSaved } from '../engine/__testutil__/savedPlans';
import { pinDate, unpinDate } from '../engine/__regression__/snapshotUtil';
import { expectedNumbers } from '../engine/__testutil__/engineChanges';
import { PLAN_STORE_VERSION } from './planStoreVersion';
import { usePlanStore } from './usePlanStore';

/** Upgrade freshness for v36 → v37 (HSA). The v37 schema adds only optional fields, so a plan saved by
 *  v36 must load unchanged: same optimizer key, result still fresh, same projection.
 *  v36-baselines.json was captured on the v36 code (commit b36447b, the 2.3.0 release, built in a
 *  worktree): the saved plan as that build stored it, its optimizer key, status and headline numbers. */

interface Baseline {
  name: string; key: string; resultKey: string; status: string;
  endTotalReal: number; lifetimeFedTax: number; saved: SavedPlan;
}
const baselines = JSON.parse(readFileSync(join(__dirname, '../engine/__fixtures__/exports/v36-baselines.json'), 'utf8')) as Baseline[];

/** The three legacy export files as the v35 code (869e998) imported them. v36 reproduced these exactly
 *  (see planMigrationV36.test.ts), so they are also the v36 reference. */
interface LegacyBaseline { n: string; status: string; key: string; endTotalReal: number; lifetimeFedTax: number; lifetimeConversion: number }
const legacy = JSON.parse(readFileSync(join(__dirname, '../engine/__fixtures__/exports/v35-legacy-imports.json'), 'utf8')) as LegacyBaseline[];

const migrateStore = (plan: unknown, from: number) =>
  (usePlanStore.persist.getOptions().migrate!({ plan, scenarios: [] }, from) as { plan: SavedPlan }).plan;

pinDate(); // at load, so fixtures built while collecting describe blocks see the pinned year too
afterAll(unpinDate);

describe('v36 → v37 on captured plans', () => {
  it('is at least store version 37', () => {
    expect(PLAN_STORE_VERSION).toBeGreaterThanOrEqual(37);
  });

  it('has fresh baselines for the sample, rich and golden plans', () => {
    expect(baselines.length).toBe(19);
    expect(baselines.every((b) => b.status === 'fresh' && b.key === b.resultKey)).toBe(true);
  });

  for (const b of baselines) {
    it(`${b.name}: store migration leaves the plan, key and status exactly as v36 had them`, () => {
      const stored = JSON.parse(JSON.stringify(b.saved));
      const after = migrateStore(JSON.parse(JSON.stringify(b.saved)), 36);
      expect(after).toEqual(stored);
      expect(SavedPlanSchema.safeParse(after).success).toBe(true);
      expect(savedOptimizerKey(after)).toBe(b.key);
      expect(after.strategy.result!.inputKey).toBe(b.resultKey);
      expect(planStatus(after)).toBe('fresh');
      const proj = runProjection(enginePlan(after));
      const want = expectedNumbers(b.name, b, () => runProjection(enginePlan(b.saved)));
      expect(proj.endTotalReal).toBe(want.endTotalReal);
      expect(proj.lifetimeFedTax).toBe(want.lifetimeFedTax);
    });

    it(`${b.name}: a v36 export imports fresh with the same key and projection`, () => {
      const file = JSON.stringify({ app: 'retirement-optimizer', version: 1, exportedAt: '2026-10-18T00:00:00Z', planVersion: 36, plan: b.saved });
      const r = importPlanFromJSON(file);
      expect(r.ok).toBe(true);
      expect(savedOptimizerKey(r.plan!)).toBe(b.key);
      expect(planStatus(r.plan!)).toBe('fresh');
      expect(runProjection(enginePlan(r.plan!)).endTotalReal).toBe(expectedNumbers(b.name, b, () => runProjection(enginePlan(b.saved))).endTotalReal);
    });
  }

  it('no plan gains an HSA key on the way in', () => {
    for (const b of baselines) {
      const after = migrateStore(JSON.parse(JSON.stringify(b.saved)), 36);
      for (const pf of [after.portfolio.personA, after.portfolio.personB]) {
        if (!pf) continue;
        for (const k of ['hsa', 'hsaContribution', 'hsaCoverage', 'hsaContribInRetirement', 'hsaReceipts']) expect(k in pf).toBe(false);
      }
      expect('hsaPolicy' in after.portfolio).toBe(false);
      expect('hsaReturn' in after.assumptions).toBe(false);
    }
  });
});

describe('legacy export files import exactly as they did before the HSA', () => {
  for (const b of legacy) {
    it(`${b.n}.json: same status, optimizer key and headline numbers`, () => {
      const r = importPlanFromJSON(readFileSync(join(__dirname, `../engine/__fixtures__/exports/${b.n}.json`), 'utf8'));
      expect(r.ok).toBe(true);
      expect(planStatus(r.plan!)).toBe(b.status);
      expect(savedOptimizerKey(r.plan!)).toBe(b.key);
      const proj = runProjection(enginePlan(r.plan!));
      const want = expectedNumbers(b.n, b, () => proj);
      expect(proj.endTotalReal).toBe(want.endTotalReal);
      expect(proj.lifetimeFedTax).toBe(want.lifetimeFedTax);
      expect(proj.lifetimeConversion).toBe(want.lifetimeConversion);
    });
  }
});

describe('plans written by v37', () => {
  const withHsaFields = (base: SavedPlan): SavedPlan => ({
    ...base,
    assumptions: { ...base.assumptions, hsaReturn: 0.06 },
    portfolio: {
      ...base.portfolio,
      personA: { ...base.portfolio.personA, hsa: 62_000, hsaContribution: 4_400, hsaCoverage: 'family' as const, hsaContribInRetirement: true, hsaReceipts: 18_000 },
      hsaPolicy: { payMedicalFromAge: 70 },
    },
  });

  it('round-trip through export and import unchanged, HSA fields included', () => {
    const fresh = optimizedSaved(withHsaFields(sampleSaved()));
    const r = importPlanFromJSON(exportPlanToJSON(fresh));
    expect(r.ok).toBe(true);
    expect(r.plan!.portfolio.personA).toMatchObject({ hsa: 62_000, hsaContribution: 4_400, hsaCoverage: 'family', hsaContribInRetirement: true, hsaReceipts: 18_000 });
    expect(r.plan!.portfolio.hsaPolicy).toEqual({ payMedicalFromAge: 70 });
    expect(r.plan!.assumptions.hsaReturn).toBe(0.06);
    expect(planStatus(r.plan!)).toBe('fresh');
    expect(savedOptimizerKey(r.plan!)).toBe(savedOptimizerKey(fresh));
  });

  it('adding an HSA after a result is built marks the result out of date, as any plan fact does', () => {
    const fresh = optimizedSaved();
    expect(planStatus(withHsaFields(fresh))).toBe('stale');
  });

  it('survives the persisted-store migration at the current version', () => {
    const fresh = optimizedSaved(withHsaFields(sampleSaved()));
    const after = migrateStore(JSON.parse(JSON.stringify(fresh)), 37);
    expect(after).toEqual(JSON.parse(JSON.stringify(fresh)));
    expect(planStatus(after)).toBe('fresh');
  });
});
