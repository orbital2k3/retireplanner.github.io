import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { Plan } from '../../../schemas/plan';
import type { SavedPlan } from '../../../schemas/savedPlan';
import type { OptimizeResult } from '../../optimizer';
import type { UserGoal } from '../../recommender';
import { runProjection } from '../../projection';
import { optimizerKey, canonicalStringify } from '../optimizerInput';
import { enginePlan, savedOptimizerKey, planStatus, resultStatus, canReOptimize, optimizerView, defaultSavedPlan } from '../savedPlan';
import { sampleSaved } from '../../__testutil__/savedPlans';
import { usePlanStore } from '../../../store/usePlanStore';
import { useOptimizerStore } from '../../../store/useOptimizerStore';
import { useWhatIfStore } from '../../../store/useWhatIfStore';
import { PLAN_STORE_VERSION } from '../../../store/planStoreVersion';
import {
  runOptimizer, commitOptimizerPlan, discardPending, chooseConversion, applyRule,
  type OptimizeFn, type ConversionChoice,
} from '../../../store/strategyActions';
import { exportPlanToJSON, importPlanFromJSON } from '../../../storage/exportImport';
import { FED_BRACKETS_MFJ } from '../../taxConstants';

/**
 * §6.4 model-based test. Random command sequences drive the real stores and the real runner;
 * only the worker is replaced by a deterministic fake whose policy depends on optimizerKey, so
 * runs are cheap and reproducible. The model tracks, independently of resultStatus, which key
 * the current result was built for and what it projected to.
 */

const GOALS: UserGoal[] = ['max-end-balance', 'max-sustainable-spending', 'min-retirement-age'];

const fakeOptimize: OptimizeFn = async (plan, goal) => {
  const k = [...optimizerKey(plan)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 60;
  const ownsConv = plan.conversion.optimize ?? true;
  const spend = plan.expenseStreams.reduce((s, e) => s + e.annualAmount, 0);
  return {
    goal,
    policy: {
      windows: [{ fromAge: 40, toAge: 110, pctTaxable: k / 100, pctTraditional: 1 - k / 100, pctRoth: 0, convAmt: ownsConv ? 1000 * k : undefined }],
      source: 'optimizer', goal,
    },
    recommendedAnnualSpend: goal === 'max-sustainable-spending' ? spend * (1 + k / 1000) : undefined,
    solvedRetirementAge: goal === 'min-retirement-age' ? Math.max(45, plan.personA.retirementAge - 1) : undefined,
  } as unknown as OptimizeResult;
};

type Cmd =
  | { t: 'EditFact'; what: 'expense' | 'ss' | 'balance'; v: number }
  | { t: 'EditConversion'; choice: ConversionChoice; ceiling: number }
  | { t: 'EditManualAmounts'; age: number; v: number }
  | { t: 'EditPayTax' }
  | { t: 'EditLegacyTarget'; v: number }
  | { t: 'EditPreset'; v: Plan['withdrawalStrategy'] }
  | { t: 'EditBlend'; pct: number }
  | { t: 'EditCeiling'; v: number }
  | { t: 'EditManualConversion'; choice: Exclude<ConversionChoice, 'optimizer'>; age: number; v: number }
  | { t: 'EditManualPayTax' }
  | { t: 'SwitchTab' }
  | { t: 'SelectGoal'; g: UserGoal }
  | { t: 'Run' }
  | { t: 'ApplyPending' }
  | { t: 'DiscardPending' }
  | { t: 'McRobustness' }
  | { t: 'McApply' }
  | { t: 'McDiscard' }
  | { t: 'WhatIf'; v: number }
  | { t: 'ExportImport' }
  | { t: 'Reload' }
  | { t: 'Reset' };

const CEILINGS = FED_BRACKETS_MFJ.slice(0, 5).map(([top]) => top);
const cmd: fc.Arbitrary<Cmd> = fc.oneof(
  fc.record({ t: fc.constant('EditFact' as const), what: fc.constantFrom('expense' as const, 'ss' as const, 'balance' as const), v: fc.integer({ min: 1, max: 20 }) }),
  fc.record({ t: fc.constant('EditConversion' as const), choice: fc.constantFrom<ConversionChoice>('optimizer', 'off', 'bracket-fill', 'auto-window', 'manual'), ceiling: fc.constantFrom(...CEILINGS) }),
  fc.record({ t: fc.constant('EditManualAmounts' as const), age: fc.integer({ min: 55, max: 80 }), v: fc.integer({ min: 0, max: 100 }).map((x) => x * 1000) }),
  fc.constant({ t: 'EditPayTax' as const }),
  fc.record({ t: fc.constant('EditLegacyTarget' as const), v: fc.integer({ min: 0, max: 10 }).map((x) => x * 50_000) }),
  fc.record({ t: fc.constant('EditPreset' as const), v: fc.constantFrom<Plan['withdrawalStrategy']>('taxfirst', 'rothfirst', 'tradfirst', 'proportional', 'bracketfill') }),
  fc.record({ t: fc.constant('EditBlend' as const), pct: fc.integer({ min: 0, max: 10 }).map((x) => x / 10) }),
  fc.record({ t: fc.constant('EditCeiling' as const), v: fc.constantFrom(...CEILINGS) }),
  fc.record({ t: fc.constant('EditManualConversion' as const), choice: fc.constantFrom<Exclude<ConversionChoice, 'optimizer'>>('off', 'bracket-fill', 'auto-window', 'manual'), age: fc.integer({ min: 55, max: 80 }), v: fc.integer({ min: 0, max: 100 }).map((x) => x * 1000) }),
  fc.constant({ t: 'EditManualPayTax' as const }),
  fc.constant({ t: 'SwitchTab' as const }), fc.constant({ t: 'SwitchTab' as const }),
  fc.record({ t: fc.constant('SelectGoal' as const), g: fc.constantFrom(...GOALS) }),
  fc.constant({ t: 'Run' as const }), fc.constant({ t: 'Run' as const }),
  fc.constant({ t: 'ApplyPending' as const }),
  fc.constant({ t: 'DiscardPending' as const }),
  fc.constant({ t: 'McRobustness' as const }),
  fc.constant({ t: 'McApply' as const }),
  fc.constant({ t: 'McDiscard' as const }),
  fc.record({ t: fc.constant('WhatIf' as const), v: fc.integer({ min: 1, max: 5 }) }),
  fc.constant({ t: 'ExportImport' as const }),
  fc.constant({ t: 'Reload' as const }),
  fc.constant({ t: 'Reset' as const }),
);

/** Independent record of the current saved result: the key it was built for and its projection. */
interface Model { resultKey: string | null; resultEnd: number | null }

const saved = () => usePlanStore.getState().plan;
const opt = () => useOptimizerStore.getState();
const end = (p: SavedPlan) => runProjection(enginePlan(p)).endTotalReal;
const withActive = (p: SavedPlan, active: 'manual' | 'optimizer'): SavedPlan => ({ ...p, strategy: { ...p.strategy, active } });
/** Projection of the saved optimizer result, whichever tab is open. */
const resultEnd = (p: SavedPlan) => end(withActive(p, 'optimizer'));

function recordSaved(m: Model) {
  const p = saved();
  m.resultKey = p.strategy.result ? savedOptimizerKey(p) : null;
  m.resultEnd = p.strategy.result ? resultEnd(p) : null;
}

const OPTIMIZER_EDITS = new Set<Cmd['t']>(['EditConversion', 'EditManualAmounts', 'EditPayTax', 'EditLegacyTarget']);
const MANUAL_EDITS = new Set<Cmd['t']>(['EditPreset', 'EditBlend', 'EditCeiling', 'EditManualConversion', 'EditManualPayTax']);

async function step(m: Model, c: Cmd): Promise<void> {
  const ps = usePlanStore.getState();
  const before = saved();
  const beforeKey = savedOptimizerKey(before);
  const beforeView = canonicalStringify(optimizerView(before));
  const beforeResultEnd = before.strategy.result ? resultEnd(before) : null;

  switch (c.t) {
    case 'EditFact':
      if (c.what === 'expense') ps.updateExpenseStream(before.expenseStreams[0].id, { annualAmount: before.expenseStreams[0].annualAmount + c.v * 1000 });
      else if (c.what === 'ss') ps.setPersonA({ ssPIA: before.personA.ssPIA + c.v * 100 });
      else ps.setPersonAPortfolio({ taxable: before.portfolio.personA.taxable + c.v * 10_000 });
      break;
    case 'EditConversion':
      chooseConversion('optimizer', c.choice, c.choice === 'bracket-fill' ? { bracketCeiling: c.ceiling } : undefined);
      break;
    case 'EditManualAmounts':
      ps.setConversion('optimizer', { manualSchedule: { ...before.strategy.optimizer.conversion.manualSchedule, [String(c.age)]: c.v } });
      break;
    case 'EditPayTax': ps.editOptimizer({ payTaxFromBrokerage: !before.strategy.optimizer.payTaxFromBrokerage }); break;
    case 'EditLegacyTarget': ps.editOptimizer({ legacyTargetTaxAdjReal: c.v }); break;
    case 'EditPreset': ps.editManual({ preset: c.v, customWindows: undefined }); break;
    case 'EditBlend':
      ps.editManual({ customWindows: [{ fromAge: 40, toAge: 110, pctTaxable: c.pct, pctTraditional: 1 - c.pct, pctRoth: 0 }] });
      break;
    case 'EditCeiling': ps.editManual({ preset: 'bracketfill', withdrawalBracketCeiling: c.v }); break;
    case 'EditManualConversion':
      chooseConversion('manual', c.choice);
      ps.setConversion('manual', { manualSchedule: { ...before.strategy.manual.conversion.manualSchedule, [String(c.age)]: c.v } });
      break;
    case 'EditManualPayTax': ps.editManual({ payTaxFromBrokerage: !before.strategy.manual.payTaxFromBrokerage }); break;
    case 'SwitchTab': {
      const other = before.strategy.active === 'manual' ? 'optimizer' : 'manual';
      ps.setActiveStrategy(other);
      // I6: switching back returns the exact same plan.
      expect(withActive(saved(), before.strategy.active)).toEqual(before);
      break;
    }
    case 'SelectGoal': ps.editOptimizer({ goal: c.g }); break;
    case 'Run': {
      const goal = before.strategy.optimizer.goal;
      const out = await runOptimizer({ plan: before }, fakeOptimize);
      // I9: one apply rule for every caller.
      expect(out.kind).toBe(applyRule(goal));
      if (out.kind === 'pending') expect(saved()).toBe(before);
      break;
    }
    case 'ApplyPending': if (opt().pendingPlan) commitOptimizerPlan(opt().pendingPlan!); break;
    case 'DiscardPending': discardPending(); break;
    case 'McRobustness': {
      const goal = before.strategy.result?.goal ?? before.strategy.optimizer.goal;
      const out = await runOptimizer({ plan: before, goal, mc: { mcSeed: 1, mcPosture: 'balanced', equityPct: 0.6 } }, fakeOptimize);
      expect(out.kind).toBe('preview');
      expect(saved()).toBe(before);
      const r = out.plan.strategy.result!;
      opt().setRobustnessPlan({ ...out.plan, strategy: { ...out.plan.strategy, result: { ...r, optimizedBy: 'monte-carlo' } } });
      break;
    }
    case 'McApply': if (opt().robustnessPlan) commitOptimizerPlan(opt().robustnessPlan!); break;
    case 'McDiscard': opt().setRobustnessPlan(null); break;
    case 'WhatIf': useWhatIfStore.getState().setOverride('inflation', 0.02 + c.v / 100); break;
    case 'ExportImport': {
      const statusBefore = planStatus(before);
      const r = importPlanFromJSON(exportPlanToJSON(before));
      expect(r.ok).toBe(true);
      // I7: status, the active tab, both slots and the result survive export then import.
      expect(planStatus(r.plan!)).toBe(statusBefore);
      expect(resultStatus(r.plan!)).toBe(resultStatus(before));
      expect(r.plan!.strategy.active).toBe(before.strategy.active);
      expect(r.plan!.strategy.result?.policy).toEqual(before.strategy.result?.policy);
      expect(canonicalStringify(optimizerView(r.plan!))).toBe(canonicalStringify(optimizerView(JSON.parse(JSON.stringify(before)))));
      usePlanStore.setState({ plan: r.plan! });
      break;
    }
    case 'Reload': {
      const statusBefore = planStatus(before);
      const persisted = JSON.parse(JSON.stringify({ state: { plan: before }, version: PLAN_STORE_VERSION }));
      usePlanStore.setState({ plan: persisted.state.plan });
      useOptimizerStore.setState({ pendingPlan: null, pendingGoal: null, robustnessPlan: null, robustnessComparison: null, result: null });
      useWhatIfStore.getState().reset();
      // I8: the saved plan and its status survive; ephemeral state is gone.
      expect(planStatus(saved())).toBe(statusBefore);
      break;
    }
    case 'Reset':
      usePlanStore.setState({ plan: sampleSaved() });
      useOptimizerStore.setState({ pendingPlan: null, pendingGoal: null, robustnessPlan: null, robustnessComparison: null, result: null });
      break;
  }

  const after = saved();
  // The saved result changes only when one is committed or the plan is reset.
  if (after.strategy.result !== before.strategy.result && c.t !== 'ExportImport' && c.t !== 'Reload') recordSaved(m);

  // I2: the result is fresh exactly when it was built for the current key.
  const modelFresh = m.resultKey !== null && savedOptimizerKey(after) === m.resultKey;
  expect(resultStatus(after) === 'fresh').toBe(modelFresh);

  // I3: while fresh, the optimizer tab projects what the result produced.
  if (modelFresh) expect(resultEnd(after)).toBe(m.resultEnd);

  // I4: optimizer-setting edits never move the result's charts.
  if (OPTIMIZER_EDITS.has(c.t) && beforeResultEnd !== null) expect(resultEnd(after)).toBe(beforeResultEnd);
  // I4: a spending change always moves them.
  if (c.t === 'EditFact' && c.what === 'expense') expect(end(after)).not.toBe(end(before));

  // I5: "Set it myself" edits and tab switches never reach the optimizer and never touch the result.
  if (MANUAL_EDITS.has(c.t) || c.t === 'SwitchTab') {
    expect(savedOptimizerKey(after)).toBe(beforeKey);
    expect(canonicalStringify(optimizerView(after))).toBe(beforeView);
    expect(after.strategy.result).toBe(before.strategy.result);
  }

  // I1: Re-optimize is enabled exactly when there is no current result for the selected goal.
  const effective = opt().pendingPlan ?? after;
  const r = effective.strategy.result;
  const currentForGoal = resultStatus(effective) === 'fresh' && r?.goal === effective.strategy.optimizer.goal;
  expect(canReOptimize(effective)).toBe(!currentForGoal);

  // I10: no contradictory conversion state: while the optimizer decides, nothing user-chosen fires.
  if (after.strategy.optimizer.optimizerDecidesConversions) {
    expect(optimizerView(after).conversion).toMatchObject({ optimize: true, mode: 'off', manualSchedule: {} });
  }
}

const RUNS = process.env.HEAVY === '1' ? 10_000 : 500;

describe('§6.4 strategy state machine', () => {
  it(`holds I1-I10 over ${RUNS} random command sequences`, async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(cmd, { minLength: 1, maxLength: 25 }), async (cmds) => {
        usePlanStore.setState({ plan: sampleSaved() });
        useOptimizerStore.setState({ pendingPlan: null, pendingGoal: null, robustnessPlan: null, robustnessComparison: null, result: null });
        useWhatIfStore.getState().reset();
        const m: Model = { resultKey: null, resultEnd: null };
        for (const c of cmds) await step(m, c);
      }),
      { numRuns: RUNS },
    );
  }, 600_000);

  it('a blank plan starts on "Set it myself" with no result and Re-optimize enabled', () => {
    const p = defaultSavedPlan();
    expect(p.strategy.active).toBe('manual');
    expect(planStatus(p)).toBe('none');
    expect(canReOptimize(p)).toBe(true);
  });
});
