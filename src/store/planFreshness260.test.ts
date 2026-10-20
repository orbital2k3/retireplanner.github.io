/** @vitest-environment jsdom */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SavedPlanSchema, type SavedPlan } from '../schemas/savedPlan';
import { runProjection } from '../engine/projection';
import { enginePlan, planStatus, savedOptimizerKey } from '../engine/strategy/savedPlan';
import { importPlanFromJSON } from '../storage/exportImport';
import { pinDate, unpinDate } from '../engine/__regression__/snapshotUtil';
import { PLAN_STORE_VERSION } from './planStoreVersion';
import { usePlanStore } from './usePlanStore';

/** 2.6.0 (TIPS builder) has no store bump: a plan saved by 2.5.0 / v38 must load as it was. v38-baselines.json
 *  was captured on the 2.5.0 release commit 9f4c518 in a worktree: samplePlan, planQ, planR, planS and a
 *  builder-shaped ladder (par absent, coupon = yield), each with a current optimizer result. */
interface Baseline { name: string; key: string; resultKey: string; status: string; endTotalReal: number; lifetimeFedTax: number; saved: SavedPlan }
const baselines = JSON.parse(readFileSync(join(__dirname, '../engine/__fixtures__/exports/v38-baselines.json'), 'utf8')) as Baseline[];

beforeAll(pinDate);
afterAll(unpinDate);

describe('2.6.0 keeps v38 plans fresh', () => {
  it('is still store version 38', () => {
    expect(PLAN_STORE_VERSION).toBe(38);
    expect(baselines.map((b) => b.status)).toEqual(Array(5).fill('fresh'));
  });

  for (const b of baselines) {
    it(`${b.name}: store load and export/import keep the plan, key, status and numbers`, () => {
      const after = (usePlanStore.persist.getOptions().migrate!({ plan: JSON.parse(JSON.stringify(b.saved)), scenarios: [] }, 38) as { plan: SavedPlan }).plan;
      expect(after).toEqual(b.saved);
      expect(SavedPlanSchema.safeParse(after).success).toBe(true);
      expect(savedOptimizerKey(after)).toBe(b.key);
      expect(planStatus(after)).toBe('fresh');
      const proj = runProjection(enginePlan(after));
      expect(proj.endTotalReal).toBe(b.endTotalReal);
      expect(proj.lifetimeFedTax).toBe(b.lifetimeFedTax);
      const r = importPlanFromJSON(JSON.stringify({ app: 'retirement-optimizer', version: 1, exportedAt: '2026-10-20T00:00:00Z', planVersion: 38, plan: b.saved }));
      expect(r.ok).toBe(true);
      expect(savedOptimizerKey(r.plan!)).toBe(b.key);
      expect(planStatus(r.plan!)).toBe('fresh');
    });
  }
});
