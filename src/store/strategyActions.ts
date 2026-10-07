import * as Comlink from 'comlink';
import type { Plan, ConversionParams } from '../schemas/plan';
import type { SavedPlan, OptimizerStrategy, ConversionSettings } from '../schemas/savedPlan';
import type { OptimizeResult } from '../engine/optimizer';
import type { UserGoal } from '../engine/recommender';
import type { OptimizeWorkerOptions } from '../engine/worker';
import { optimizerView, applyResult } from '../engine/strategy/savedPlan';
import { getEngineWorker } from '../engine/workerClient';
import { usePlanStore, type StrategySlot } from './usePlanStore';
import { useOptimizerStore } from './useOptimizerStore';
import { useWhatIfStore } from './useWhatIfStore';
import { useToastStore } from './useToastStore';

/** Monte Carlo robustness options. A run with these produces a preview, never a saved result. */
export type McRunOptions = Pick<OptimizeWorkerOptions, 'equityPct' | 'mcPosture' | 'mcSeed'>;

export interface RunOptimizerArgs {
  /** The saved plan, never a pending one, so results don't compound. Monte Carlo passes its
   *  simulated base (what-if applied) because its run is only a preview. */
  plan: SavedPlan;
  /** Defaults to the goal saved in the "Optimize for me" settings. */
  goal?: UserGoal;
  /** Optimizer settings to change for this run, e.g. from the rationale modal. Saved with the result. */
  patch?: Partial<OptimizerStrategy>;
  mc?: McRunOptions;
  onProgress?: (frac: number, message?: string) => void;
}

/** applied: saved to the plan. pending: waits for Apply / Discard. preview: Monte Carlo comparison. */
export type RunOutcome = { kind: 'applied' | 'pending' | 'preview'; goal: UserGoal; plan: SavedPlan; result: OptimizeResult };

export type OptimizeFn = (
  plan: Plan, goal: UserGoal, options: OptimizeWorkerOptions, onProgress?: (frac: number, message?: string) => void,
) => Promise<OptimizeResult>;

/** Goals that rewrite inputs (expenses, retirement age) wait for the user's Apply. */
export function applyRule(goal: UserGoal): 'applied' | 'pending' {
  return goal === 'max-sustainable-spending' || goal === 'min-retirement-age' ? 'pending' : 'applied';
}

/** Pure core: runs the optimizer on the optimizer view and decides what the result is. No store access. */
export async function runOptimizerCore(optimize: OptimizeFn, args: RunOptimizerArgs): Promise<RunOutcome> {
  const goal = args.goal ?? args.plan.strategy.optimizer.goal;
  const s = args.plan.strategy;
  const input: SavedPlan = { ...args.plan, strategy: { ...s, optimizer: { ...s.optimizer, ...args.patch, goal } } };
  const options: OptimizeWorkerOptions = args.mc
    ? { useNelderMead: true, thorough: true, mcAware: true, ...args.mc }
    : { useNelderMead: true, thorough: true };
  const result = await optimize(optimizerView(input), goal, options, args.onProgress);
  const plan = applyResult(input, result);
  return { kind: args.mc ? 'preview' : applyRule(goal), goal, plan, result };
}

/** Rationale-modal patches name flat plan fields; map them onto the optimizer settings. */
export function optimizerPatchFromFlat(patch: Partial<Plan>): Partial<OptimizerStrategy> {
  const out: Partial<OptimizerStrategy> = {};
  if (patch.conversion) {
    const { optimize, ...conversion } = patch.conversion;
    out.optimizerDecidesConversions = optimize ?? true;
    out.conversion = conversion;
  }
  if (patch.payTaxFromBrokerage !== undefined) out.payTaxFromBrokerage = patch.payTaxFromBrokerage;
  return out;
}

/** Saves an optimizer-produced plan and clears everything that described the old one. */
export function commitOptimizerPlan(plan: SavedPlan): void {
  usePlanStore.getState().applyOptimizerResult(plan);
  const opt = useOptimizerStore.getState();
  opt.setPendingPlan(null);
  opt.setPendingGoal(null);
  opt.setRobustnessPlan(null);
  opt.setRobustnessComparison(null);
  useWhatIfStore.getState().reset();
}

const workerOptimize: OptimizeFn = (plan, goal, options, onProgress) =>
  getEngineWorker().optimize(plan, goal, options, onProgress ? Comlink.proxy(onProgress) : undefined);

/** The one way to run the optimizer. Every caller gets the same apply rule (see applyRule).
 *  A Monte Carlo run returns a preview and leaves the plan and pending result alone. */
export async function runOptimizer(args: RunOptimizerArgs, optimize: OptimizeFn = workerOptimize): Promise<RunOutcome> {
  const opt = useOptimizerStore.getState();
  opt.setRobustnessPlan(null);
  opt.setRobustnessComparison(null);
  const outcome = await runOptimizerCore(optimize, args);
  if (outcome.kind === 'preview') return outcome;
  if (outcome.result.conversionsDisabled) {
    useToastStore.getState().show('info', 'Conversions turned off. The optimizer found a higher balance without Roth conversions. Re-run any time to check again.');
  }
  opt.setResult(outcome.result);
  if (outcome.kind === 'applied') {
    commitOptimizerPlan(outcome.plan);
  } else {
    opt.setPendingPlan(outcome.plan);
    opt.setPendingGoal(outcome.goal);
    useWhatIfStore.getState().reset();
  }
  return outcome;
}

/** "Optimizer decides", or a conversion mode the user picks. */
export type ConversionChoice = 'optimizer' | ConversionParams['mode'];

/** The one write for a conversion choice, on every page. In "Optimize for me", picking a mode turns
 *  the optimizer's own search off; "Optimizer decides" turns it back on and leaves the remembered
 *  mode inert (the optimizer never reads it). "Set it myself" has no optimizer choice. */
export function chooseConversion(slot: StrategySlot, choice: ConversionChoice, extra?: Partial<ConversionSettings>): void {
  const store = usePlanStore.getState();
  if (slot === 'optimizer') {
    if (choice === 'optimizer') {
      store.editOptimizer({ optimizerDecidesConversions: true });
    } else {
      store.editOptimizer({ optimizerDecidesConversions: false });
      store.setConversion('optimizer', { ...extra, mode: choice });
    }
  } else if (choice !== 'optimizer') {
    store.setConversion('manual', { ...extra, mode: choice });
  }
}
