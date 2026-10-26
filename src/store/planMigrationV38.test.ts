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

/** Upgrade freshness for v37 → v38 (TIPS ladder). The v38 schema adds only an optional portfolio field, so a
 *  plan saved by v37 must load unchanged: same optimizer key, result still fresh, same projection.
 *  v37-baselines.json was captured on the v37 code (commit ca0dc15, the 2.4.0 release, built in a worktree):
 *  the saved plan as that build stored it, its optimizer key, status and headline numbers. */

interface Baseline {
  name: string; key: string; resultKey: string; status: string;
  endTotalReal: number; lifetimeFedTax: number; saved: SavedPlan;
}
const baselines = JSON.parse(readFileSync(join(__dirname, '../engine/__fixtures__/exports/v37-baselines.json'), 'utf8')) as Baseline[];

/** The three legacy export files as the v35 code (869e998) imported them. v36 and v37 reproduced these exactly
 *  (see planMigrationV36/V37.test.ts), so they are also the v37 reference. */
interface LegacyBaseline { n: string; status: string; key: string; endTotalReal: number; lifetimeFedTax: number; lifetimeConversion: number }
const legacy = JSON.parse(readFileSync(join(__dirname, '../engine/__fixtures__/exports/v35-legacy-imports.json'), 'utf8')) as LegacyBaseline[];


const migrateStore = (plan: unknown, from: number) =>
  (usePlanStore.persist.getOptions().migrate!({ plan, scenarios: [] }, from) as { plan: SavedPlan }).plan;

pinDate(); // at load, so fixtures built while collecting describe blocks see the pinned year too
afterAll(unpinDate);

describe('v37 → v38 on captured plans', () => {
  it('is store version 38', () => {
    expect(PLAN_STORE_VERSION).toBe(38);
  });

  it('has fresh baselines for the sample, rich and golden plans', () => {
    expect(baselines.length).toBe(20);
    expect(baselines.every((b) => b.status === 'fresh' && b.key === b.resultKey)).toBe(true);
  });

  for (const b of baselines) {
    it(`${b.name}: store migration leaves the plan, key and status exactly as v37 had them`, () => {
      const stored = JSON.parse(JSON.stringify(b.saved));
      const after = migrateStore(JSON.parse(JSON.stringify(b.saved)), 37);
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

    it(`${b.name}: a v37 export imports fresh with the same key and projection`, () => {
      const file = JSON.stringify({ app: 'retirement-optimizer', version: 1, exportedAt: '2026-10-18T00:00:00Z', planVersion: 37, plan: b.saved });
      const r = importPlanFromJSON(file);
      expect(r.ok).toBe(true);
      expect(savedOptimizerKey(r.plan!)).toBe(b.key);
      expect(planStatus(r.plan!)).toBe('fresh');
      expect(runProjection(enginePlan(r.plan!)).endTotalReal).toBe(expectedNumbers(b.name, b, () => runProjection(enginePlan(b.saved))).endTotalReal);
    });
  }

  it('no plan gains a ladder key on the way in', () => {
    for (const b of baselines) {
      const after = migrateStore(JSON.parse(JSON.stringify(b.saved)), 37);
      expect('tipsLadder' in after.portfolio).toBe(false);
    }
  });
});

describe('legacy export files import exactly as they did before the TIPS ladder', () => {
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

describe('plans written by v38', () => {
  const withLadder = (base: SavedPlan, excluded = false): SavedPlan => ({
    ...base,
    portfolio: {
      ...base.portfolio,
      tipsLadder: {
        rungs: [
          { id: 'r1', maturityYear: 2031, adjustedPrincipal: 48_000, faceValue: 45_000, couponRate: 0.0125, account: 'traditional', whose: 'A' },
          { id: 'r2', maturityYear: 2033, adjustedPrincipal: 48_000, couponRate: 0.0175, account: 'taxable', whose: 'Household' },
        ],
        ...(excluded ? { balancesIncludeLadder: false } : {}),
      },
    },
  });

  it('round-trip through export and import unchanged, ladder included', () => {
    const fresh = optimizedSaved(withLadder(sampleSaved(), true));
    const r = importPlanFromJSON(exportPlanToJSON(fresh));
    expect(r.ok).toBe(true);
    expect(r.plan!.portfolio.tipsLadder).toEqual(fresh.portfolio.tipsLadder);
    expect(planStatus(r.plan!)).toBe('fresh');
    expect(savedOptimizerKey(r.plan!)).toBe(savedOptimizerKey(fresh));
  });

  it('adding a ladder after a result is built marks the result out of date, as any plan fact does', () => {
    expect(planStatus(withLadder(optimizedSaved()))).toBe('stale');
  });

  it('survives the persisted-store migration at the current version', () => {
    const fresh = optimizedSaved(withLadder(sampleSaved()));
    const after = migrateStore(JSON.parse(JSON.stringify(fresh)), 38);
    expect(after).toEqual(JSON.parse(JSON.stringify(fresh)));
    expect(planStatus(after)).toBe('fresh');
  });
});
