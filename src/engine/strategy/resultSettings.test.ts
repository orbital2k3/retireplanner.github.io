import { describe, it, expect } from 'vitest';
import { samplePlan, type Plan } from '../../schemas/plan';
import { runProjection } from '../projection';
import { policyStatus } from '../policyStatus';
import { optimizerInput, optimizerKey } from './optimizerInput';
import { optimizerSettings, resolveStrategy, liveSettings } from './resultSettings';
import { migratePlanToV34, legacyPlanInputKey } from '../../store/planMigrations';
import { FED_BRACKETS_MFJ } from '../taxConstants';
import type { BlendWindow } from '../blendPolicy';

// Optimizer-owned withdrawals, user-owned bracket-fill conversions (convAmt undefined).
const WINDOW: BlendWindow = { fromAge: 59, toAge: 98, pctTaxable: 0.5, pctTraditional: 0.3, pctRoth: 0.2 };

function optimizedPlan(): Plan {
  const base = samplePlan();
  const p: Plan = { ...base, conversion: { ...base.conversion, mode: 'bracket-fill', optimize: false, startAge: 62, endAge: 77 } };
  return { ...p, customPolicy: { windows: [WINDOW], source: 'optimizer', goal: 'max-end-balance', inputKey: optimizerKey(p), settings: optimizerSettings(p) } };
}

const end = (p: Plan) => runProjection(p).endTotalReal;

describe('§3.2 optimizer result carries its settings', () => {
  it('strategy edits leave the projection unchanged and mark the result stale', () => {
    const p = optimizedPlan();
    const before = end(p);
    const edits: Plan[] = [
      { ...p, conversion: { ...p.conversion, startAge: 65 } },
      { ...p, conversion: { ...p.conversion, mode: 'manual', manualSchedule: { '62': 90_000 } } },
      { ...p, conversion: { ...p.conversion, bracketCeiling: FED_BRACKETS_MFJ[3][0] } },
      { ...p, payTaxFromBrokerage: !p.payTaxFromBrokerage },
    ];
    for (const e of edits) {
      expect(end(e)).toBe(before);
      expect(policyStatus(e)).toBe('stale');
    }
  });

  it('"Set it myself" edits leave the projection unchanged and the result fresh', () => {
    const p = optimizedPlan();
    const e = { ...p, withdrawalStrategy: 'bracketfill' as const, withdrawalBracketCeiling: FED_BRACKETS_MFJ[2][0] };
    expect(end(e)).toBe(end(p));
    expect(policyStatus(e)).toBe('fresh');
  });

  it('fact edits move the projection', () => {
    const p = optimizedPlan();
    const e = { ...p, expenseStreams: p.expenseStreams.map((x) => ({ ...x, annualAmount: x.annualAmount + 10_000 })) };
    expect(end(e)).not.toBe(end(p));
  });

  it('a fresh result projects the same with or without the snapshot', () => {
    const p = optimizedPlan();
    const { settings: _s, ...noSnapshot } = p.customPolicy!;
    void _s;
    expect(end(p)).toBe(end({ ...p, customPolicy: noSnapshot }));
  });

  it('variants built from a resolved plan can override a setting', () => {
    const r = resolveStrategy(optimizedPlan());
    expect(r.customPolicy?.settings).toBeUndefined();
    expect(resolveStrategy(r)).toEqual(r);
    expect(end({ ...r, payTaxFromBrokerage: !r.payTaxFromBrokerage })).not.toBe(end(r));
  });

  it('a hand-built blend ignores a copied snapshot', () => {
    const p = optimizedPlan();
    const manual = { ...p, customPolicy: { ...p.customPolicy!, source: 'manual' as const } };
    const edited = { ...manual, conversion: { ...manual.conversion, startAge: 70 } };
    expect(end(edited)).not.toBe(end(manual));
  });

  it('the optimizer never sees a seed snapshot', () => {
    expect(optimizerInput(optimizedPlan()).customPolicy?.settings).toBeUndefined();
  });
});

describe('§3.2 v34 stamps a snapshot on saved results', () => {
  it('freezes the current fields without moving the projection', () => {
    const base = samplePlan();
    const raw = JSON.parse(JSON.stringify({ ...base, conversion: { ...base.conversion, mode: 'bracket-fill', optimize: false } })) as Record<string, unknown>;
    raw.customPolicy = { windows: [WINDOW], source: 'optimizer' };
    (raw.customPolicy as Record<string, unknown>).inputKey = legacyPlanInputKey(raw);
    const before = end(raw as unknown as Plan);
    migratePlanToV34(raw);
    const migrated = raw as unknown as Plan;
    expect(migrated.customPolicy?.settings).toEqual(liveSettings(migrated));
    expect(end(migrated)).toBe(before);
    expect(policyStatus(migrated)).toBe('fresh');
    expect(end({ ...migrated, conversion: { ...migrated.conversion, startAge: 70 } })).toBe(before);
  });
});
