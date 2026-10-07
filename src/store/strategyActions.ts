import * as Comlink from 'comlink';
import type { Plan } from '../schemas/plan';
import type { OptimizeResult } from '../engine/optimizer';
import type { UserGoal } from '../engine/recommender';
import type { OptimizeWorkerOptions } from '../engine/worker';
import { applyResultToPlan } from '../engine/applyOptimizerResult';
import { getEngineWorker } from '../engine/workerClient';
import { usePlanStore } from './usePlanStore';
import { useOptimizerStore } from './useOptimizerStore';
import { useWhatIfStore } from './useWhatIfStore';
import { useToastStore } from './useToastStore';

/** Monte Carlo robustness options. A run with these produces a preview, never a saved result. */
export type McRunOptions = Pick<OptimizeWorkerOptions, 'equityPct' | 'mcPosture' | 'mcSeed'>;

export interface RunOptimizerArgs {
  /** The saved plan, never a pending one, so results don't compound. Monte Carlo passes its
   *  simulated base (what-if applied) because its run is only a preview. */
  plan: Plan;
  goal: UserGoal;
  /** Settings to change for this run, e.g. from the rationale modal. Saved with the result. */
  patch?: Partial<Plan>;
  mc?: McRunOptions;
  onProgress?: (frac: number, message?: string) => void;
}

/** applied: saved to the plan. pending: waits for Apply / Discard. preview: Monte Carlo comparison. */
export type RunOutcome =
  | { kind: 'applied' | 'pending'; goal: UserGoal; plan: Plan; result: OptimizeResult }
  | { kind: 'preview'; goal: UserGoal; plan: Plan; result: OptimizeResult };

export type OptimizeFn = (
  plan: Plan, goal: UserGoal, options: OptimizeWorkerOptions, onProgress?: (frac: number, message?: string) => void,
) => Promise<OptimizeResult>;

/** Goals that rewrite inputs (expenses, retirement age) wait for the user's Apply. */
export function applyRule(goal: UserGoal): 'applied' | 'pending' {
  return goal === 'max-sustainable-spending' || goal === 'min-retirement-age' ? 'pending' : 'applied';
}

/** Pure core: runs the optimizer and decides what the result is. No store access. */
export async function runOptimizerCore(optimize: OptimizeFn, args: RunOptimizerArgs): Promise<RunOutcome> {
  const input = args.patch ? { ...args.plan, ...args.patch } : args.plan;
  const options: OptimizeWorkerOptions = args.mc
    ? { useNelderMead: true, thorough: true, mcAware: true, ...args.mc }
    : { useNelderMead: true, thorough: true };
  const result = await optimize(input, args.goal, options, args.onProgress);
  const plan = applyResultToPlan(input, result);
  return { kind: args.mc ? 'preview' : applyRule(args.goal), goal: args.goal, plan, result };
}

/** Saves an optimizer-produced plan and clears everything that described the old one. */
export function commitOptimizerPlan(plan: Plan): void {
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
