import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Plan, Person, Assumptions, PersonPortfolio, Portfolio, IncomeStream, ExpenseStream, LumpSumEvent, Goal } from '../schemas/plan';
import type { SavedPlan, ManualStrategy, OptimizerStrategy, ConversionSettings, Strategy } from '../schemas/savedPlan';
import { defaultSavedPlan, enginePlan } from '../engine/strategy/savedPlan';
import { runProjection, type ProjectionResult } from '../engine/projection';
import type { Scenario } from '../engine/scenario';
import { defaultScenarios } from '../engine/scenario';
import { useWhatIfStore, applyWhatIf } from './useWhatIfStore';
import { useOptimizerStore } from './useOptimizerStore';
import { disposeEngineWorker } from '../engine/workerClient';
import { migrateStoredPlan } from './planMigrations';
import { PLAN_STORE_KEY, PLAN_STORE_VERSION } from './planStoreVersion';

export type DisplayMode = 'real' | 'nominal';

export type StrategySlot = 'manual' | 'optimizer';
type FactsAssumptions = Omit<Assumptions, 'legacyTargetTaxAdjReal'>;

/** A spending edit invalidates the solved Max Spending multiplier (it scaled the old amounts). */
function clearSolvedSpending(plan: SavedPlan): SavedPlan {
  const r = plan.strategy.result;
  if (r?.solvedSpendingMultiplier === undefined) return plan;
  return { ...plan, strategy: { ...plan.strategy, result: { ...r, solvedSpendingMultiplier: undefined } } };
}

const withStrategy = (plan: SavedPlan, patch: Partial<Strategy>): SavedPlan => ({ ...plan, strategy: { ...plan.strategy, ...patch } });

interface PlanState {
  plan: SavedPlan;
  scenarios: Scenario[];
  displayMode: DisplayMode;
  setupDismissed: boolean;
  setSetupDismissed: (v: boolean) => void;
  setDisplayMode: (m: DisplayMode) => void;
  addScenario: (s: Scenario) => void;
  updateScenario: (id: string, patch: Partial<Scenario>) => void;
  removeScenario: (id: string) => void;
  resetScenarios: () => void;
  setPersonA: (patch: Partial<Person>) => void;
  setPersonB: (patch: Partial<Person>) => void;
  setAssumptions: (patch: Partial<FactsAssumptions>) => void;
  setPersonAPortfolio: (patch: Partial<PersonPortfolio>) => void;
  setPersonBPortfolio: (patch: Partial<PersonPortfolio>) => void;
  /** Household HSA payment policy; undefined removes it (absent means age 65). */
  setHsaPolicy: (policy: Portfolio['hsaPolicy']) => void;
  /** TIPS ladder; undefined (or no rungs) removes it, so a plan without one keeps its saved shape. */
  setTipsLadder: (ladder: Portfolio['tipsLadder']) => void;
  setIncomeStreams: (streams: IncomeStream[]) => void;
  addIncomeStream: (s: IncomeStream) => void;
  updateIncomeStream: (id: string, patch: Partial<IncomeStream>) => void;
  removeIncomeStream: (id: string) => void;
  addLumpSumEvent: (e: LumpSumEvent) => void;
  updateLumpSumEvent: (id: string, patch: Partial<LumpSumEvent>) => void;
  removeLumpSumEvent: (id: string) => void;
  setExpenseStreams: (streams: ExpenseStream[]) => void;
  addExpenseStream: (s: ExpenseStream) => void;
  updateExpenseStream: (id: string, patch: Partial<ExpenseStream>) => void;
  removeExpenseStream: (id: string) => void;
  addPersonB: () => void;
  removePersonB: () => void;
  /** Which tab drives the charts. Neither tab's settings nor the optimizer result are touched. */
  setActiveStrategy: (active: StrategySlot) => void;
  /** "Set it myself" settings. Never read by the optimizer. */
  editManual: (patch: Partial<ManualStrategy>) => void;
  /** "Optimize for me" settings. Changing them marks the result out of date. */
  editOptimizer: (patch: Partial<OptimizerStrategy>) => void;
  setConversion: (slot: StrategySlot, patch: Partial<ConversionSettings>) => void;
  /** Save a whole plan produced by applyResult (optimizer Apply), atomically. */
  applyOptimizerResult: (next: SavedPlan) => void;
  setState: (state: string) => void;
  setCustomStateTaxRate: (rate: number) => void;
  addGoal: (g: Goal) => void;
  updateGoal: (id: string, patch: Partial<Goal>) => void;
  removeGoal: (id: string) => void;
  resetPlan: () => void;
}

export const usePlanStore = create<PlanState>()(
  persist(
    (set) => ({
      plan: defaultSavedPlan(),
      scenarios: defaultScenarios(),
      displayMode: 'real',
      setupDismissed: false,
      setSetupDismissed: (setupDismissed) => set({ setupDismissed }),
      setDisplayMode: (displayMode) => set({ displayMode }),
      addScenario: (s) => set((st) => ({ scenarios: [...st.scenarios, s] })),
      updateScenario: (id, patch) => set((st) => ({ scenarios: st.scenarios.map((x) => x.id === id ? { ...x, ...patch } : x) })),
      removeScenario: (id) => set((st) => ({ scenarios: st.scenarios.filter((x) => x.id !== id) })),
      resetScenarios: () => set({ scenarios: defaultScenarios() }),
      setPersonA: (patch) => set((s) => ({ plan: { ...s.plan, personA: { ...s.plan.personA, ...patch } } })),
      setPersonB: (patch) => set((s) => ({ plan: { ...s.plan, personB: s.plan.personB ? { ...s.plan.personB, ...patch } : undefined } })),
      addPersonB: () => set((s) => ({
        plan: {
          ...s.plan,
          personB: { name: 'Person B', dob: '1975-01-01', retirementAge: 65, planThroughAge: 90, ssPIA: 0, ssClaimAge: 67 },
          portfolio: { ...s.plan.portfolio, personB: { taxable: 0, taxableBasis: 0, traditional: 0, roth: 0, annualContribution: 0, contribGrowth: { mode: 'cpi' }, contribSplit: { taxable: 0.2, traditional: 0.4, roth: 0.4 } } },
        },
      })),
      // B's pre-tax TIPS rungs sit in B's IRA, which leaves with B (like B's HSA), so they go too; an
      // emptied ladder is stored as absent, as setTipsLadder does.
      removePersonB: () => set((s) => {
        const { tipsLadder, ...rest } = s.plan.portfolio;
        const rungs = tipsLadder?.rungs.filter((r) => !(r.account === 'traditional' && r.whose === 'B'));
        const portfolio = tipsLadder && rungs && rungs.length > 0
          ? { ...rest, tipsLadder: rungs.length === tipsLadder.rungs.length ? tipsLadder : { ...tipsLadder, rungs } }
          : rest;
        return { plan: { ...s.plan, personB: undefined, portfolio: { ...portfolio, personB: undefined } } };
      }),
      setAssumptions: (patch) => set((s) => ({ plan: { ...s.plan, assumptions: { ...s.plan.assumptions, ...patch } } })),
      setPersonAPortfolio: (patch) => set((s) => ({
        plan: { ...s.plan, portfolio: { ...s.plan.portfolio, personA: { ...s.plan.portfolio.personA, ...patch } } },
      })),
      setPersonBPortfolio: (patch) => set((s) => ({
        plan: { ...s.plan, portfolio: { ...s.plan.portfolio, personB: s.plan.portfolio.personB ? { ...s.plan.portfolio.personB, ...patch } : undefined } },
      })),
      setHsaPolicy: (policy) => set((s) => {
        const { hsaPolicy: _drop, ...rest } = s.plan.portfolio;
        void _drop;
        return { plan: { ...s.plan, portfolio: policy ? { ...rest, hsaPolicy: policy } : rest } };
      }),
      setTipsLadder: (ladder) => set((s) => {
        const { tipsLadder: _drop, ...rest } = s.plan.portfolio;
        void _drop;
        return { plan: { ...s.plan, portfolio: ladder && ladder.rungs.length > 0 ? { ...rest, tipsLadder: ladder } : rest } };
      }),
      setIncomeStreams: (incomeStreams) => set((s) => ({ plan: { ...s.plan, incomeStreams } })),
      addIncomeStream: (stream) => set((s) => ({ plan: { ...s.plan, incomeStreams: [...s.plan.incomeStreams, stream] } })),
      updateIncomeStream: (id, patch) => set((s) => ({
        plan: { ...s.plan, incomeStreams: s.plan.incomeStreams.map(x => x.id === id ? { ...x, ...patch } : x) },
      })),
      removeIncomeStream: (id) => set((s) => ({ plan: { ...s.plan, incomeStreams: s.plan.incomeStreams.filter(x => x.id !== id) } })),
      addLumpSumEvent: (e) => set((s) => ({ plan: { ...s.plan, lumpSumEvents: [...(s.plan.lumpSumEvents ?? []), e] } })),
      updateLumpSumEvent: (id, patch) => set((s) => ({ plan: { ...s.plan, lumpSumEvents: (s.plan.lumpSumEvents ?? []).map(x => x.id === id ? { ...x, ...patch } : x) } })),
      removeLumpSumEvent: (id) => set((s) => ({ plan: { ...s.plan, lumpSumEvents: (s.plan.lumpSumEvents ?? []).filter(x => x.id !== id) } })),
      setExpenseStreams: (expenseStreams) => set((s) => ({ plan: clearSolvedSpending({ ...s.plan, expenseStreams }) })),
      addExpenseStream: (stream) => set((s) => ({ plan: clearSolvedSpending({ ...s.plan, expenseStreams: [...s.plan.expenseStreams, stream] }) })),
      updateExpenseStream: (id, patch) => set((s) => ({
        plan: clearSolvedSpending({ ...s.plan, expenseStreams: s.plan.expenseStreams.map(x => x.id === id ? { ...x, ...patch } : x) }),
      })),
      removeExpenseStream: (id) => set((s) => ({ plan: clearSolvedSpending({ ...s.plan, expenseStreams: s.plan.expenseStreams.filter(x => x.id !== id) }) })),
      setActiveStrategy: (active) => set((s) => ({ plan: withStrategy(s.plan, { active }) })),
      editManual: (patch) => set((s) => ({ plan: withStrategy(s.plan, { manual: { ...s.plan.strategy.manual, ...patch } }) })),
      editOptimizer: (patch) => set((s) => ({ plan: withStrategy(s.plan, { optimizer: { ...s.plan.strategy.optimizer, ...patch } }) })),
      setConversion: (slot, patch) => set((s) => {
        const cur = s.plan.strategy[slot];
        return { plan: withStrategy(s.plan, { [slot]: { ...cur, conversion: { ...cur.conversion, ...patch } } }) };
      }),
      applyOptimizerResult: (next) => set(() => ({ plan: next })),
      setState: (state) => set((s) => ({ plan: { ...s.plan, state } })),
      setCustomStateTaxRate: (rate) => set((s) => ({ plan: { ...s.plan, customStateTaxRate: rate } })),
      addGoal: (g) => set((s) => ({ plan: { ...s.plan, goals: [...(s.plan.goals ?? []), g] } })),
      updateGoal: (id, patch) => set((s) => ({ plan: { ...s.plan, goals: (s.plan.goals ?? []).map((x) => x.id === id ? { ...x, ...patch } : x) } })),
      removeGoal: (id) => set((s) => ({ plan: { ...s.plan, goals: (s.plan.goals ?? []).filter((x) => x.id !== id) } })),
      resetPlan: () => {
        disposeEngineWorker();
        // A pending or preview result describes the old plan; Apply would bring it back.
        useOptimizerStore.setState({ result: null, pendingPlan: null, pendingGoal: null });
        useOptimizerStore.getState().clearMcResults();
        useWhatIfStore.getState().reset();
        set({ plan: defaultSavedPlan() });
      },
    }),
    {
      name: PLAN_STORE_KEY,
      version: PLAN_STORE_VERSION,
      migrate: (persistedState: unknown, fromVersion: number) => {
        if (!persistedState || typeof persistedState !== 'object') return persistedState as PlanState;
        const ps = persistedState as Record<string, unknown> & { plan?: Record<string, unknown> };
        if (ps.plan && typeof ps.plan === 'object') ps.plan = migrateStoredPlan(ps.plan, fromVersion);
        if (!('displayMode' in ps)) ps.displayMode = 'real';
        return ps as unknown as PlanState;
      },
    }
  )
);

/** Selector hook — returns a projection result, re-run on every plan change.
 *  Engine is fast (~1-5ms per full 75y run), so we just run on every render.
 *
 *  Accepts an optional planOverride (e.g. the pending optimizer plan on the Dashboard).
 *  When provided, what-if overrides are layered on top of it instead of the stored plan.
 *  The saved plan in usePlanStore is never mutated. */
export function useProjection(planOverride?: SavedPlan): ProjectionResult {
  const plan = usePlanStore((s) => s.plan);
  const pendingPlan = useOptimizerStore((s) => s.pendingPlan);
  const whatIf = useWhatIfStore();
  // When the optimizer has a pending result (not yet applied), use it as the base so all
  // projection views reflect the optimizer's recommended plan without requiring Apply first.
  const effective = applyWhatIf(enginePlan(planOverride ?? pendingPlan ?? plan), whatIf);
  return runProjection(effective, { explain: true });
}

/** The saved plan as the engine sees it (active strategy flattened). Memoized per saved plan. */
export function useEnginePlan(): Plan {
  const plan = usePlanStore((s) => s.plan);
  return useMemo(() => enginePlan(plan), [plan]);
}
