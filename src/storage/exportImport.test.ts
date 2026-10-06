import { describe, it, expect } from 'vitest';
import { importPlanFromJSON, exportPlanToJSON } from './exportImport';
import { planInputKey } from '../engine/planInputKey';
import { policyStatus } from '../engine/policyStatus';
import { samplePlan, type Plan } from '../schemas/plan';

const WINDOW = { fromAge: 60, toAge: 95, pctTaxable: 0.5, pctTraditional: 0.3, pctRoth: 0.2 };

/** A plan as an older app version saved it: retired field present, keys in a different order. */
function legacyShapedPlan(): Plan {
  const base = samplePlan();
  const { name, dob, ...restA } = base.personA;
  const raw = { ...base, personA: { ...restA, passingAge: 95, dob, name } } as unknown as Plan;
  return raw;
}

describe('importPlanFromJSON', () => {
  it('keeps a current optimizer policy current when parsing reorders or drops fields', () => {
    const raw = legacyShapedPlan();
    raw.customPolicy = { windows: [WINDOW], source: 'optimizer', inputKey: planInputKey(raw) };
    const r = importPlanFromJSON(exportPlanToJSON(raw));
    expect(r.ok).toBe(true);
    expect(policyStatus(r.plan!)).toBe('fresh');
  });

  it('leaves a policy that was already out of date as stale', () => {
    const raw = legacyShapedPlan();
    raw.customPolicy = { windows: [WINDOW], source: 'optimizer', inputKey: 'old-key' };
    const r = importPlanFromJSON(exportPlanToJSON(raw));
    expect(policyStatus(r.plan!)).toBe('stale');
  });
});
