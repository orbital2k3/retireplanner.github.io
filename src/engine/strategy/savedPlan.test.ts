import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { samplePlan, PlanSchema, type Plan } from '../../schemas/plan';
import { SavedPlanSchema, type SavedPlan } from '../../schemas/savedPlan';
import { runProjection } from '../projection';
import { policyStatus } from '../policyStatus';
import { optimizerKey } from './optimizerInput';
import { optimizerSettings } from './resultSettings';
import { applyResultToPlan } from '../applyOptimizerResult';
import {
  enginePlan, optimizerView, savedOptimizerKey, resultStatus, planStatus, canReOptimize, applyResult, fromFlat,
} from './savedPlan';
import { richPlan, MANUAL_WINDOW, OPT_WINDOW } from '../__testutil__/strategyPlans';
import { sampleSaved, optimizedSaved, staleSaved, fakeResult } from '../__testutil__/savedPlans';
import { FED_BRACKETS_MFJ } from '../taxConstants';

const end = (p: SavedPlan) => runProjection(enginePlan(p)).endTotalReal;
const withManual = (p: SavedPlan, patch: Partial<SavedPlan['strategy']['manual']>): SavedPlan =>
  ({ ...p, strategy: { ...p.strategy, manual: { ...p.strategy.manual, ...patch } } });
const withOptimizer = (p: SavedPlan, patch: Partial<SavedPlan['strategy']['optimizer']>): SavedPlan =>
  ({ ...p, strategy: { ...p.strategy, optimizer: { ...p.strategy.optimizer, ...patch } } });
const setActive = (p: SavedPlan, active: 'manual' | 'optimizer'): SavedPlan => ({ ...p, strategy: { ...p.strategy, active } });

const manualEdit = fc.oneof(
  fc.constantFrom<Plan['withdrawalStrategy']>('taxfirst', 'rothfirst', 'tradfirst', 'proportional', 'bracketfill').map((preset) => ({ preset, customWindows: undefined })),
  fc.constantFrom(...FED_BRACKETS_MFJ.slice(0, 5).map(([t]) => t)).map((withdrawalBracketCeiling) => ({ withdrawalBracketCeiling })),
  fc.double({ min: 0, max: 1, noNaN: true }).map((pct) => ({ customWindows: [{ ...MANUAL_WINDOW, pctTaxable: pct, pctTraditional: 1 - pct, pctRoth: 0 }] })),
  fc.constantFrom('off', 'manual', 'auto-window', 'bracket-fill').map((mode) => ({ conversion: { ...sampleSaved().strategy.manual.conversion, mode, manualSchedule: { '60': 90_000 } } })),
  fc.boolean().map((payTaxFromBrokerage) => ({ payTaxFromBrokerage })),
);

describe('Phase 2 slots: the optimizer never sees "Set it myself"', () => {
  it('I5 any sequence of manual edits leaves the optimizer view, key and result untouched', () => {
    fc.assert(fc.property(fc.boolean(), fc.array(manualEdit, { maxLength: 12 }), (optimized, edits) => {
      const start = optimized ? optimizedSaved() : sampleSaved();
      const after = edits.reduce((p, e) => withManual(p, e), start);
      return JSON.stringify(optimizerView(after)) === JSON.stringify(optimizerView(start))
        && savedOptimizerKey(after) === savedOptimizerKey(start)
        && after.strategy.result === start.strategy.result
        && resultStatus(after) === resultStatus(start);
    }), { numRuns: 300 });
  });

  it('the withdrawal ceiling no longer touches any conversion ceiling (Phase 1 known leak)', () => {
    const p = withOptimizer(sampleSaved(), { optimizerDecidesConversions: false, conversion: { ...sampleSaved().strategy.optimizer.conversion, mode: 'bracket-fill', bracketCeiling: FED_BRACKETS_MFJ[3][0] } });
    const edited = withManual(p, { preset: 'bracketfill', withdrawalBracketCeiling: FED_BRACKETS_MFJ[1][0] });
    expect(optimizerView(edited).conversion.bracketCeiling).toBe(FED_BRACKETS_MFJ[3][0]);
  });

  it('a hand-built blend never seeds the optimizer', () => {
    const p = setActive(withManual(sampleSaved(), { customWindows: [MANUAL_WINDOW] }), 'manual');
    expect(optimizerView(p).customPolicy).toBeUndefined();
    expect(optimizerView(optimizedSaved(p)).customPolicy?.windows).toEqual([OPT_WINDOW]);
  });
});

describe('Phase 2 slots: switching tabs', () => {
  it('I6 switching away and back returns the exact same plan', () => {
    for (const p of [sampleSaved(), optimizedSaved(), staleSaved(), withManual(optimizedSaved(), { customWindows: [MANUAL_WINDOW] })]) {
      const other = p.strategy.active === 'manual' ? 'optimizer' : 'manual';
      expect(setActive(setActive(p, other), p.strategy.active)).toEqual(p);
    }
  });

  it('P9 "Set it myself" shows the manual projection at once and keeps the result fresh for the return', () => {
    const opt = optimizedSaved();
    const manual = setActive(withManual(opt, { preset: 'rothfirst' }), 'manual');
    expect(end(manual)).not.toBe(end(opt));
    expect(planStatus(manual)).toBe('none');
    expect(resultStatus(manual)).toBe('fresh');
    expect(end(setActive(manual, 'optimizer'))).toBe(end(opt));
    expect(planStatus(setActive(manual, 'optimizer'))).toBe('fresh');
  });
});

describe('Phase 2 slots: optimizer settings and the result', () => {
  it('optimizer-setting edits mark the result stale and leave the charts frozen', () => {
    const p = optimizedSaved(withOptimizer(sampleSaved(), { optimizerDecidesConversions: false, conversion: { ...sampleSaved().strategy.optimizer.conversion, mode: 'bracket-fill' } }));
    const before = end(p);
    for (const e of [
      withOptimizer(p, { conversion: { ...p.strategy.optimizer.conversion, startAge: 70 } }),
      withOptimizer(p, { optimizerDecidesConversions: true }),
      withOptimizer(p, { payTaxFromBrokerage: !p.strategy.optimizer.payTaxFromBrokerage }),
      withOptimizer(p, { legacyTargetTaxAdjReal: 250_000 }),
    ]) {
      expect(resultStatus(e)).toBe('stale');
      expect(end(e)).toBe(before);
    }
  });

  it('the remembered conversion mode is inert while the optimizer decides', () => {
    const p = optimizedSaved();
    expect(p.strategy.optimizer.optimizerDecidesConversions).toBe(true);
    const e = withOptimizer(p, { conversion: { ...p.strategy.optimizer.conversion, mode: 'manual', manualSchedule: { '50': 99_000 } } });
    expect(resultStatus(e)).toBe('fresh');
  });

  it('a goal change offers Re-optimize without making the result stale', () => {
    const p = optimizedSaved();
    expect(canReOptimize(p)).toBe(false);
    const e = withOptimizer(p, { goal: 'min-retirement-age' });
    expect(resultStatus(e)).toBe('fresh');
    expect(canReOptimize(e)).toBe(true);
  });

  it('fact edits move the charts and mark the result stale', () => {
    const p = optimizedSaved();
    const e = { ...p, expenseStreams: p.expenseStreams.map((x) => ({ ...x, annualAmount: x.annualAmount + 10_000 })) };
    expect(end(e)).not.toBe(end(p));
    expect(resultStatus(e)).toBe('stale');
  });

  it('applyResult matches the flat apply path exactly (round-trip contract)', () => {
    const base = withOptimizer(sampleSaved(), { optimizerDecidesConversions: false, conversion: { ...sampleSaved().strategy.optimizer.conversion, mode: 'bracket-fill' } });
    for (const goal of ['max-end-balance', 'max-sustainable-spending', 'min-retirement-age'] as const) {
      const r = fakeResult(goal, [OPT_WINDOW], { recommendedAnnualSpend: 160_000, solvedRetirementAge: 57 });
      const saved = applyResult(base, r);
      const flat = applyResultToPlan(optimizerView(base), r);
      expect(runProjection(enginePlan(saved))).toEqual(runProjection(flat));
      expect(resultStatus(saved)).toBe('fresh');
      expect(SavedPlanSchema.safeParse(saved).success).toBe(true);
      expect(saved.strategy.result!.settings).toEqual(optimizerSettings(optimizerView(saved)));
    }
  });

  it('conversionsDisabled turns the optimizer slot to None and keeps the result fresh', () => {
    const saved = applyResult(sampleSaved(), fakeResult('max-end-balance', [{ ...OPT_WINDOW, convAmt: undefined }], { conversionsDisabled: true }));
    expect(saved.strategy.optimizer).toMatchObject({ optimizerDecidesConversions: false, conversion: { mode: 'off' } });
    expect(resultStatus(saved)).toBe('fresh');
  });
});

describe('v35 fromFlat keeps every projection and status', () => {
  const flats: Array<[string, Plan]> = [
    ['no result', samplePlan()],
    ['rich optimized (user-owned conversions)', PlanSchema.parse(richPlan())],
    ['manual blend', { ...samplePlan(), customPolicy: { windows: [MANUAL_WINDOW], source: 'manual' } }],
    ['leftover manual schedule under optimizer-decides', { ...samplePlan(), conversion: { ...samplePlan().conversion, mode: 'manual', optimize: true, manualSchedule: { '50': 80_000, '60': 40_000, '70': 30_000 } } }],
    ['bracket-fill preset + conversions', { ...samplePlan(), withdrawalStrategy: 'bracketfill', conversion: { ...samplePlan().conversion, mode: 'bracket-fill', optimize: false } }],
  ];
  for (const [name, raw] of flats) {
    it(name, () => {
      const flat: Plan = raw.customPolicy?.source === 'optimizer'
        ? { ...raw, customPolicy: { ...raw.customPolicy, inputKey: optimizerKey(raw), settings: optimizerSettings(raw) } }
        : raw;
      const fresh = policyStatus(flat) === 'fresh';
      const saved = fromFlat(flat, fresh);
      expect(SavedPlanSchema.safeParse(saved).success).toBe(true);
      expect(runProjection(enginePlan(saved)).endTotalReal).toBe(runProjection(flat).endTotalReal);
      expect(planStatus(saved)).toBe(policyStatus(flat));
      expect(savedOptimizerKey(saved)).toBe(optimizerKey(flat));
    });
  }

  it('a stale flat result stays stale', () => {
    const flat: Plan = { ...samplePlan(), customPolicy: { windows: [OPT_WINDOW], source: 'optimizer', inputKey: 'old' }, optimizedForGoal: 'max-end-balance' };
    expect(planStatus(fromFlat(flat, false))).toBe('stale');
  });
});
