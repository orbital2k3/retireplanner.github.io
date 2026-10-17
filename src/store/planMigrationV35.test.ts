/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { samplePlan, type Plan } from '../schemas/plan';
import { SavedPlanSchema, type SavedPlan } from '../schemas/savedPlan';
import { runProjection } from '../engine/projection';
import { policyStatus } from '../engine/policyStatus';
import { optimizerKey } from '../engine/strategy/optimizerInput';
import { optimizerSettings } from '../engine/strategy/resultSettings';
import { enginePlan, planStatus } from '../engine/strategy/savedPlan';
import { importPlanFromJSON } from '../storage/exportImport';
import { usePlanStore } from './usePlanStore';
import { OPT_WINDOW } from '../engine/__testutil__/strategyPlans';

/** P19: a real export (sanitized) and the 2026-10-06 shape (two inherited IRAs) migrate to slots
 *  with the projection, the status and the optimizer result unchanged. */

const DIR = join(__dirname, '../engine/__fixtures__/exports');

/** Captured by running the v34 app (commit d469f27) on the sanitized 2026-07-31 export: the plan as
 *  v34 stored it, and what v34 projected and reported for it. */
interface Baseline { name: string; v34Plan: Plan; endTotalReal: number; lifetimeFedTax: number; lifetimeConversion: number; status: string }
const baselines = JSON.parse(readFileSync(join(DIR, 'v34-baselines.json'), 'utf8')) as Baseline[];

const migrateStore = (plan: unknown, from: number) =>
  (usePlanStore.persist.getOptions().migrate!({ plan, scenarios: [] }, from) as { plan: SavedPlan }).plan;

/** The 2026-10-06 shape: two inherited IRAs, an optimizer result current under the v34 key. */
function inheritedIrasV34(): Plan {
  const base: Plan = {
    ...samplePlan(),
    lumpSumEvents: [
      { id: 'inh-1', description: 'Inherited IRA 1', whose: 'A', bucket: 'inheritedPreTaxIRA', age: 60, amount: 400_000, ownerStartedRmds: true },
      { id: 'inh-2', description: 'Inherited IRA 2', whose: 'B', bucket: 'inheritedPreTaxIRA', age: 58, amount: 250_000 },
    ],
    conversion: { ...samplePlan().conversion, mode: 'bracket-fill', optimize: false, startAge: 62, endAge: 74 },
    withdrawalStrategy: 'proportional',
    optimizedForGoal: 'max-end-balance',
    optimizedBy: 'optimizer',
  };
  const withPolicy: Plan = { ...base, customPolicy: { windows: [{ ...OPT_WINDOW, convAmt: undefined }], source: 'optimizer', goal: 'max-end-balance' } };
  return { ...withPolicy, customPolicy: { ...withPolicy.customPolicy!, inputKey: optimizerKey(withPolicy), settings: optimizerSettings(withPolicy) } };
}

describe('P19 v34 → v35 on captured plans', () => {
  it('has baselines for none, fresh and stale', () => {
    expect(baselines.map((b) => b.status).sort()).toEqual(['fresh', 'none', 'stale']);
  });

  for (const b of baselines) {
    it(`${b.name}: store migration keeps the projection and status`, () => {
      const after = migrateStore(structuredClone(b.v34Plan), 34);
      expect(SavedPlanSchema.safeParse(after).success).toBe(true);
      const proj = runProjection(enginePlan(after));
      expect(proj.endTotalReal).toBeCloseTo(b.endTotalReal, 2);
      expect(proj.lifetimeFedTax).toBeCloseTo(b.lifetimeFedTax, 2);
      expect(proj.lifetimeConversion).toBeCloseTo(b.lifetimeConversion, 2);
      expect(planStatus(after)).toBe(b.status);
      if (b.v34Plan.customPolicy?.source === 'optimizer') {
        expect(after.strategy.result!.policy.windows).toEqual(b.v34Plan.customPolicy.windows);
      }
    });

    it(`${b.name}: a v34 export imports with the same projection and status`, () => {
      const file = JSON.stringify({ app: 'retirement-optimizer', version: 1, exportedAt: '2026-10-07T00:00:00Z', planVersion: 34, plan: b.v34Plan });
      const r = importPlanFromJSON(file);
      expect(r.ok).toBe(true);
      expect(runProjection(enginePlan(r.plan!)).endTotalReal).toBeCloseTo(b.endTotalReal, 2);
      expect(planStatus(r.plan!)).toBe(b.status);
    });
  }

  it('two inherited IRAs: store migration from v34 keeps everything', () => {
    const before = inheritedIrasV34();
    expect(policyStatus(before)).toBe('fresh');
    const after = migrateStore(JSON.parse(JSON.stringify(before)), 34);
    expect(runProjection(enginePlan(after))).toEqual(runProjection(before));
    expect(planStatus(after)).toBe('fresh');
    expect(after.strategy).toMatchObject({ active: 'optimizer', manual: { preset: 'proportional' }, optimizer: { optimizerDecidesConversions: false } });
  });
});
