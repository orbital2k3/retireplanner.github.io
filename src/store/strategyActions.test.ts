import { describe, it, expect, beforeEach } from 'vitest';
import { samplePlan, type Plan } from '../schemas/plan';
import type { OptimizeResult } from '../engine/optimizer';
import type { UserGoal } from '../engine/recommender';
import { policyStatus } from '../engine/policyStatus';
import { optimizerKey } from '../engine/strategy/optimizerInput';
import { usePlanStore } from './usePlanStore';
import { useOptimizerStore } from './useOptimizerStore';
import { useWhatIfStore } from './useWhatIfStore';
import { runOptimizer, commitOptimizerPlan, applyRule, type OptimizeFn } from './strategyActions';

const GOALS: UserGoal[] = ['max-end-balance', 'max-sustainable-spending', 'min-retirement-age'];
const CALLERS = ['inputs', 'chooser', 'dashboard-rationale', 'banner'] as const;

/** Deterministic stand-in for the worker: the policy depends only on the plan's key. */
const fakeOptimize: OptimizeFn = async (plan, goal) => {
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
  usePlanStore.setState({ plan: samplePlan() });
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
          expect(saved().optimizedForGoal).toBe(goal);
          expect(policyStatus(saved())).toBe('fresh');
          expect(opt().pendingPlan).toBeNull();
        } else {
          expect(saved()).toBe(before);
          expect(opt().pendingPlan).toBe(out.plan);
          expect(opt().pendingGoal).toBe(goal);
          expect(policyStatus(out.plan)).toBe('fresh');
        }
      });
    }
  }
});

describe('§3.3 pathways through the runner', () => {
  it('P11 a stale result is fresh after re-optimizing', async () => {
    await runOptimizer({ plan: saved(), goal: 'max-end-balance' }, fakeOptimize);
    usePlanStore.getState().setPersonA({ ssPIA: 50_000 });
    expect(policyStatus(saved())).toBe('stale');
    await runOptimizer({ plan: saved(), goal: 'max-end-balance' }, fakeOptimize);
    expect(policyStatus(saved())).toBe('fresh');
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
    expect(policyStatus(saved())).toBe('fresh');
    expect(opt().pendingPlan).toBeNull();
  });

  it('P13 a rationale patch is saved with the result and follows the same rule', async () => {
    const flipped = !saved().payTaxFromBrokerage;
    const out = await runOptimizer({ plan: saved(), goal: 'max-end-balance', patch: { payTaxFromBrokerage: flipped } }, fakeOptimize);
    expect(out.kind).toBe('applied');
    expect(saved().payTaxFromBrokerage).toBe(flipped);
    expect(policyStatus(saved())).toBe('fresh');
  });

  it('P14 a Monte Carlo run previews only; Apply sets provenance; the next goal run resets it', async () => {
    await runOptimizer({ plan: saved(), goal: 'max-end-balance' }, fakeOptimize);
    const before = saved();
    const out = await runOptimizer({ plan: before, goal: 'max-end-balance', mc: { mcPosture: 'balanced', mcSeed: 1, equityPct: 0.6 } }, fakeOptimize);
    expect(out.kind).toBe('preview');
    expect(saved()).toBe(before);
    expect(opt().pendingPlan).toBeNull();
    commitOptimizerPlan({ ...out.plan, optimizedBy: 'monte-carlo' });
    expect(saved().optimizedBy).toBe('monte-carlo');
    expect(policyStatus(saved())).toBe('fresh');
    await runOptimizer({ plan: saved(), goal: 'max-end-balance' }, fakeOptimize);
    expect(saved().optimizedBy).toBe('optimizer');
  });

  it('clears a robustness preview when a run starts and resets what-if on apply', async () => {
    opt().setRobustnessPlan(samplePlan());
    useWhatIfStore.setState({ active: true, overrides: { inflation: 0.04 } });
    await runOptimizer({ plan: saved(), goal: 'max-end-balance' }, fakeOptimize);
    expect(opt().robustnessPlan).toBeNull();
    expect(useWhatIfStore.getState()).toMatchObject({ active: false, overrides: {} });
  });

  it('never compounds: a pending plan is not used as the next run input', async () => {
    const before: Plan = saved();
    await runOptimizer({ plan: before, goal: 'max-sustainable-spending' }, fakeOptimize);
    const second = await runOptimizer({ plan: saved(), goal: 'max-sustainable-spending' }, fakeOptimize);
    const base = before.expenseStreams[0].annualAmount;
    expect(second.plan.expenseStreams[0].annualAmount).toBeCloseTo(base * 1.1);
  });
});
