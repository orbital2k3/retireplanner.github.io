import { describe, it, expect, beforeEach } from 'vitest';
import type { OptimizeResult } from '../engine/optimizer';
import type { UserGoal } from '../engine/recommender';
import { optimizerKey } from '../engine/strategy/optimizerInput';
import { planStatus, resultStatus } from '../engine/strategy/savedPlan';
import { sampleSaved } from '../engine/__testutil__/savedPlans';
import { usePlanStore } from './usePlanStore';
import { useOptimizerStore } from './useOptimizerStore';
import { useWhatIfStore } from './useWhatIfStore';
import { runOptimizer, commitOptimizerPlan, discardPending, applyRule, optimizerPatchFromFlat, type OptimizeFn } from './strategyActions';

const GOALS: UserGoal[] = ['max-end-balance', 'max-sustainable-spending', 'min-retirement-age'];
const CALLERS = ['inputs', 'chooser', 'dashboard-rationale', 'banner'] as const;

/** Deterministic stand-in for the worker: the policy depends only on the plan's key. */
const seen: string[] = [];
const fakeOptimize: OptimizeFn = async (plan, goal) => {
  seen.push(JSON.stringify(plan));
  const k = optimizerKey(plan).length % 50;
  const spend = plan.expenseStreams.reduce((s, e) => s + e.annualAmount, 0);
  return {
    goal,
    policy: { windows: [{ fromAge: 59, toAge: 98, pctTaxable: k / 100, pctTraditional: 1 - k / 100, pctRoth: 0, convAmt: 10_000 }], source: 'optimizer', goal },
    recommendedAnnualSpend: goal === 'max-sustainable-spending' ? spend * 1.1 : undefined,
    solvedRetirementAge: goal === 'min-retirement-age' ? plan.personA.retirementAge - 1 : undefined,
  } as unknown as OptimizeResult;
};

const saved = () => usePlanStore.getState().plan;
const opt = () => useOptimizerStore.getState();

beforeEach(() => {
  seen.length = 0;
  usePlanStore.setState({ plan: sampleSaved() });
  useOptimizerStore.setState({ result: null, pendingPlan: null, pendingGoal: null, robustnessPlan: null, robustnessComparison: null });
  useWhatIfStore.getState().reset();
});

describe('§3.3 one apply rule for every caller (I9, P1, P3)', () => {
  for (const caller of CALLERS) {
    for (const goal of GOALS) {
      it(`${caller} · ${goal} → ${applyRule(goal)}`, async () => {
        const before = saved();
        const out = await runOptimizer({ plan: before, goal }, fakeOptimize);
        expect(out.kind).toBe(applyRule(goal));
        expect(opt().result?.goal).toBe(goal);
        if (out.kind === 'applied') {
          expect(saved().strategy.active).toBe('optimizer');
          expect(saved().strategy.result?.goal).toBe(goal);
          expect(planStatus(saved())).toBe('fresh');
          expect(opt().pendingPlan).toBeNull();
        } else {
          expect(saved()).toBe(before);
          expect(opt().pendingPlan).toBe(out.plan);
          expect(opt().pendingGoal).toBe(goal);
          expect(planStatus(out.plan)).toBe('fresh');
        }
      });
    }
  }

  it('runs the saved optimizer goal when none is given', async () => {
    usePlanStore.getState().editOptimizer({ goal: 'min-retirement-age' });
    const out = await runOptimizer({ plan: saved() }, fakeOptimize);
    expect(out.goal).toBe('min-retirement-age');
  });
});

describe('§3.3 pathways through the runner', () => {
  it('the optimizer never receives "Set it myself" settings', async () => {
    usePlanStore.getState().editManual({ preset: 'rothfirst', withdrawalBracketCeiling: 1, customWindows: [{ fromAge: 40, toAge: 110, pctTaxable: 0, pctTraditional: 1, pctRoth: 0 }] });
    await runOptimizer({ plan: saved() }, fakeOptimize);
    const sent = JSON.parse(seen[0]);
    expect(sent.withdrawalStrategy).toBe('taxfirst');
    expect(sent.customPolicy).toBeUndefined();
    expect(saved().strategy.manual.preset).toBe('rothfirst');
  });

  it('P11 a stale result is fresh after re-optimizing', async () => {
    await runOptimizer({ plan: saved(), goal: 'max-end-balance' }, fakeOptimize);
    usePlanStore.getState().setPersonA({ ssPIA: 50_000 });
    expect(planStatus(saved())).toBe('stale');
    await runOptimizer({ plan: saved(), goal: 'max-end-balance' }, fakeOptimize);
    expect(planStatus(saved())).toBe('fresh');
  });

  it('P12 Apply saves the pending result; Discard leaves the plan unchanged', async () => {
    const before = saved();
    const out = await runOptimizer({ plan: before, goal: 'max-sustainable-spending' }, fakeOptimize);
    opt().setPendingPlan(null);
    opt().setPendingGoal(null);
    expect(saved()).toBe(before);
    await runOptimizer({ plan: before, goal: 'max-sustainable-spending' }, fakeOptimize);
    commitOptimizerPlan(opt().pendingPlan!);
    expect(saved().expenseStreams[0].annualAmount).toBeCloseTo(out.plan.expenseStreams[0].annualAmount);
    expect(saved().strategy.result?.solvedSpendingMultiplier).toBeCloseTo(1.1);
    expect(planStatus(saved())).toBe('fresh');
    expect(opt().pendingPlan).toBeNull();
  });

  it('P13 a rationale patch is saved with the result and follows the same rule', async () => {
    const flipped = !saved().strategy.optimizer.payTaxFromBrokerage;
    const out = await runOptimizer({ plan: saved(), goal: 'max-end-balance', patch: optimizerPatchFromFlat({ payTaxFromBrokerage: flipped }) }, fakeOptimize);
    expect(out.kind).toBe('applied');
    expect(saved().strategy.optimizer.payTaxFromBrokerage).toBe(flipped);
    expect(planStatus(saved())).toBe('fresh');
  });

  it('P14 a Monte Carlo run previews only; Apply sets provenance; the next goal run resets it', async () => {
    await runOptimizer({ plan: saved(), goal: 'max-end-balance' }, fakeOptimize);
    const before = saved();
    const out = await runOptimizer({ plan: before, goal: 'max-end-balance', mc: { mcPosture: 'balanced', mcSeed: 1, equityPct: 0.6 } }, fakeOptimize);
    expect(out.kind).toBe('preview');
    expect(saved()).toBe(before);
    expect(opt().pendingPlan).toBeNull();
    const r = out.plan.strategy.result!;
    commitOptimizerPlan({ ...out.plan, strategy: { ...out.plan.strategy, result: { ...r, optimizedBy: 'monte-carlo' } } });
    expect(saved().strategy.result?.optimizedBy).toBe('monte-carlo');
    expect(planStatus(saved())).toBe('fresh');
    await runOptimizer({ plan: saved(), goal: 'max-end-balance' }, fakeOptimize);
    expect(saved().strategy.result?.optimizedBy).toBe('optimizer');
  });

  it('switching to "Set it myself" keeps the result; switching back finds it fresh', async () => {
    await runOptimizer({ plan: saved(), goal: 'max-end-balance' }, fakeOptimize);
    usePlanStore.getState().setActiveStrategy('manual');
    usePlanStore.getState().editManual({ preset: 'proportional' });
    expect(saved().strategy.result).toBeDefined();
    usePlanStore.getState().setActiveStrategy('optimizer');
    expect(planStatus(saved())).toBe('fresh');
  });

  it('clears a robustness preview when a run starts and resets what-if on apply', async () => {
    opt().setRobustnessPlan(sampleSaved());
    useWhatIfStore.setState({ active: true, overrides: { inflation: 0.04 } });
    await runOptimizer({ plan: saved(), goal: 'max-end-balance' }, fakeOptimize);
    expect(opt().robustnessPlan).toBeNull();
    expect(useWhatIfStore.getState()).toMatchObject({ active: false, overrides: {} });
  });

  it('never compounds: a pending plan is not used as the next run input', async () => {
    const before = saved();
    await runOptimizer({ plan: before, goal: 'max-sustainable-spending' }, fakeOptimize);
    const second = await runOptimizer({ plan: saved(), goal: 'max-sustainable-spending' }, fakeOptimize);
    expect(second.plan.expenseStreams[0].annualAmount).toBeCloseTo(before.expenseStreams[0].annualAmount * 1.1);
  });

  it('a spending edit drops the solved spending multiplier but keeps the result', async () => {
    await runOptimizer({ plan: saved(), goal: 'max-sustainable-spending' }, fakeOptimize);
    commitOptimizerPlan(opt().pendingPlan!);
    usePlanStore.getState().updateExpenseStream(saved().expenseStreams[0].id, { annualAmount: 1 });
    expect(saved().strategy.result?.solvedSpendingMultiplier).toBeUndefined();
    expect(resultStatus(saved())).toBe('stale');
  });
});

describe('Discard', () => {
  it('drops the pending result and puts the goal pill back on the saved result\'s goal', async () => {
    await runOptimizer({ plan: saved(), goal: 'max-end-balance' }, fakeOptimize);
    const applied = saved();
    usePlanStore.getState().editOptimizer({ goal: 'max-sustainable-spending' });
    await runOptimizer({ plan: saved() }, fakeOptimize);
    expect(opt().pendingPlan).not.toBeNull();

    discardPending();
    expect(opt()).toMatchObject({ pendingPlan: null, pendingGoal: null, result: null });
    expect(saved()).toEqual(applied);
    expect(planStatus(saved())).toBe('fresh');
  });

  it('with no saved result the pill keeps the user\'s pick', async () => {
    usePlanStore.getState().editOptimizer({ goal: 'min-retirement-age' });
    await runOptimizer({ plan: saved() }, fakeOptimize);
    discardPending();
    expect(opt().pendingPlan).toBeNull();
    expect(saved().strategy.optimizer.goal).toBe('min-retirement-age');
    expect(saved().strategy.result).toBeUndefined();
  });
});
