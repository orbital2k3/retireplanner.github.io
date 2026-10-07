import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { samplePlan, defaultPlan, type Plan } from '../../../schemas/plan';
import type { OptimizeResult } from '../../optimizer';
import type { UserGoal } from '../../recommender';
import { runProjection } from '../../projection';
import { policyStatus } from '../../policyStatus';
import { optimizerKey } from '../optimizerInput';
import { usePlanStore } from '../../../store/usePlanStore';
import { useOptimizerStore } from '../../../store/useOptimizerStore';
import { useWhatIfStore } from '../../../store/useWhatIfStore';
import { PLAN_STORE_VERSION } from '../../../store/planStoreVersion';
import {
  runOptimizer, commitOptimizerPlan, chooseConversion, applyRule, canReOptimize,
  type OptimizeFn, type ConversionChoice,
} from '../../../store/strategyActions';
import { exportPlanToJSON, importPlanFromJSON } from '../../../storage/exportImport';
import { FED_BRACKETS_MFJ } from '../../taxConstants';

/**
 * §6.4 model-based test. Random command sequences drive the real stores and the real runner;
 * only the worker is replaced by a deterministic fake whose policy depends on optimizerKey, so
 * runs are cheap and reproducible. The model tracks, independently of policyStatus, which key
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
interface Model { resultKey: string | null; resultEnd: number | null; selectedGoal: UserGoal | null }

const saved = () => usePlanStore.getState().plan;
const opt = () => useOptimizerStore.getState();
const end = (p: Plan) => runProjection(p).endTotalReal;
const hasOptimizerResult = (p: Plan) => p.customPolicy?.source === 'optimizer';

function recordSaved(m: Model) {
  const p = saved();
  m.resultKey = hasOptimizerResult(p) ? optimizerKey(p) : null;
  m.resultEnd = hasOptimizerResult(p) ? end(p) : null;
}

const STRATEGY_EDITS = new Set<Cmd['t']>(['EditConversion', 'EditManualAmounts', 'EditPayTax', 'EditLegacyTarget']);
const MANUAL_EDITS = new Set<Cmd['t']>(['EditPreset', 'EditBlend', 'EditCeiling']);

async function step(m: Model, c: Cmd): Promise<void> {
  const ps = usePlanStore.getState();
  const before = saved();
  const beforeKey = optimizerKey(before);
  const beforeEnd = hasOptimizerResult(before) ? end(before) : null;

  switch (c.t) {
    case 'EditFact':
      if (c.what === 'expense') ps.updateExpenseStream(before.expenseStreams[0].id, { annualAmount: before.expenseStreams[0].annualAmount + c.v * 1000 });
      else if (c.what === 'ss') ps.setPersonA({ ssPIA: before.personA.ssPIA + c.v * 100 });
      else ps.setPersonAPortfolio({ taxable: before.portfolio.personA.taxable + c.v * 10_000 });
      break;
    case 'EditConversion':
      chooseConversion(c.choice, c.choice === 'bracket-fill' ? { bracketCeiling: c.ceiling } : undefined);
      break;
    case 'EditManualAmounts':
      ps.setConversion({ manualSchedule: { ...before.conversion.manualSchedule, [String(c.age)]: c.v } });
      break;
    case 'EditPayTax': ps.setPayTaxFromBrokerage(!before.payTaxFromBrokerage); break;
    case 'EditLegacyTarget': ps.setAssumptions({ legacyTargetTaxAdjReal: c.v }); break;
    case 'EditPreset': ps.setWithdrawalStrategy(c.v); break;
    case 'EditBlend':
      ps.setCustomPolicy({ windows: [{ fromAge: 40, toAge: 110, pctTaxable: c.pct, pctTraditional: 1 - c.pct, pctRoth: 0 }], source: 'manual' });
      break;
    case 'EditCeiling': ps.setWithdrawalBracketCeiling(c.v); break;
    case 'SelectGoal': m.selectedGoal = c.g; break;
    case 'Run': {
      const goal = m.selectedGoal ?? (before.optimizedForGoal as UserGoal | undefined) ?? 'max-end-balance';
      const out = await runOptimizer({ plan: before, goal }, fakeOptimize);
      // I9: one apply rule for every caller.
      expect(out.kind).toBe(applyRule(goal));
      if (out.kind === 'pending') expect(saved()).toBe(before);
      break;
    }
    case 'ApplyPending': if (opt().pendingPlan) commitOptimizerPlan(opt().pendingPlan!); break;
    case 'DiscardPending': opt().setPendingPlan(null); opt().setPendingGoal(null); break;
    case 'McRobustness': {
      const goal = (before.optimizedForGoal as UserGoal | undefined) ?? 'max-end-balance';
      const out = await runOptimizer({ plan: before, goal, mc: { mcSeed: 1, mcPosture: 'balanced', equityPct: 0.6 } }, fakeOptimize);
      expect(out.kind).toBe('preview');
      expect(saved()).toBe(before);
      opt().setRobustnessPlan({ ...out.plan, optimizedBy: 'monte-carlo' });
      break;
    }
    case 'McApply': if (opt().robustnessPlan) commitOptimizerPlan(opt().robustnessPlan!); break;
    case 'McDiscard': opt().setRobustnessPlan(null); break;
    case 'WhatIf': useWhatIfStore.getState().setOverride('inflation', 0.02 + c.v / 100); break;
    case 'ExportImport': {
      const statusBefore = policyStatus(before);
      const r = importPlanFromJSON(exportPlanToJSON(before));
      expect(r.ok).toBe(true);
      // I7: status and result survive export then import.
      expect(policyStatus(r.plan!)).toBe(statusBefore);
      expect(r.plan!.customPolicy?.windows).toEqual(before.customPolicy?.windows);
      usePlanStore.setState({ plan: r.plan! });
      break;
    }
    case 'Reload': {
      const statusBefore = policyStatus(before);
      const persisted = JSON.parse(JSON.stringify({ state: { plan: before }, version: PLAN_STORE_VERSION }));
      usePlanStore.setState({ plan: persisted.state.plan });
      useOptimizerStore.setState({ pendingPlan: null, pendingGoal: null, robustnessPlan: null, robustnessComparison: null, result: null });
      useWhatIfStore.getState().reset();
      m.selectedGoal = null;
      // I8: the saved plan and its status survive; ephemeral state is gone.
      expect(policyStatus(saved())).toBe(statusBefore);
      break;
    }
    case 'Reset':
      usePlanStore.setState({ plan: samplePlan() });
      useOptimizerStore.setState({ pendingPlan: null, pendingGoal: null, robustnessPlan: null, robustnessComparison: null, result: null });
      m.selectedGoal = null;
      break;
  }

  const after = saved();
  // The saved result changes only when a result is committed or a manual edit discards it.
  if (after.customPolicy !== before.customPolicy && c.t !== 'ExportImport' && c.t !== 'Reload') recordSaved(m);

  // I2: status is fresh exactly when the saved result was built for the current key.
  const modelFresh = m.resultKey !== null && optimizerKey(after) === m.resultKey;
  expect(policyStatus(after) === 'fresh').toBe(modelFresh);

  // I3: while fresh, the projection is the one the result produced.
  if (modelFresh) expect(end(after)).toBe(m.resultEnd);

  // I4: strategy edits while optimized never move the charts.
  if (STRATEGY_EDITS.has(c.t) && beforeEnd !== null && hasOptimizerResult(after)) expect(end(after)).toBe(beforeEnd);
  // I4: a spending change always moves them.
  if (c.t === 'EditFact' && c.what === 'expense') expect(end(after)).not.toBe(end(before));

  // I5: "Set it myself" edits never change optimizerKey. The ceiling edit can clamp the shared
  // conversion ceiling (known, Phase 2), so it is checked only when no clamp happens.
  const clamped = c.t === 'EditCeiling' && before.conversion.bracketCeiling > c.v;
  if (MANUAL_EDITS.has(c.t) && !clamped) expect(optimizerKey(after)).toBe(beforeKey);

  // I1: Re-optimize is enabled exactly when there is no current result for the selected goal.
  const effective = opt().pendingPlan ?? after;
  const resultGoal = effective.optimizedForGoal as UserGoal | undefined;
  const currentForGoal = policyStatus(effective) === 'fresh' && (m.selectedGoal === null || m.selectedGoal === resultGoal);
  expect(canReOptimize(policyStatus(effective), m.selectedGoal, resultGoal)).toBe(!currentForGoal);

  // I10: "Optimizer decides" never leaves a mode that could fire.
  if (after.conversion.optimize) expect(after.conversion.mode).toBe('off');
}

const RUNS = process.env.HEAVY === '1' ? 10_000 : 500;

describe('§6.4 strategy state machine', () => {
  it(`holds I1-I5, I7-I10 over ${RUNS} random command sequences`, async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(cmd, { minLength: 1, maxLength: 25 }), async (cmds) => {
        usePlanStore.setState({ plan: samplePlan() });
        useOptimizerStore.setState({ pendingPlan: null, pendingGoal: null, robustnessPlan: null, robustnessComparison: null, result: null });
        useWhatIfStore.getState().reset();
        const m: Model = { resultKey: null, resultEnd: null, selectedGoal: null };
        for (const c of cmds) await step(m, c);
      }),
      { numRuns: RUNS },
    );
  }, 600_000);

  it('a blank plan starts with no result and Re-optimize enabled', () => {
    const p = defaultPlan();
    expect(policyStatus(p)).toBe('none');
    expect(canReOptimize('none', null, undefined)).toBe(true);
  });
});
