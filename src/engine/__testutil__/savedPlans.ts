import { samplePlan, type Plan } from '../../schemas/plan';
import type { SavedPlan } from '../../schemas/savedPlan';
import type { OptimizeResult } from '../optimizer';
import type { UserGoal } from '../recommender';
import type { BlendWindow } from '../blendPolicy';
import { fromFlat, applyResult } from '../strategy/savedPlan';
import { OPT_WINDOW } from './strategyPlans';

/** A stand-in optimizer result: the fields applyResult reads. */
export function fakeResult(goal: UserGoal = 'max-end-balance', windows: BlendWindow[] = [OPT_WINDOW], extra: Partial<OptimizeResult> = {}): OptimizeResult {
  return { goal, policy: { windows, source: 'optimizer', goal }, ...extra } as unknown as OptimizeResult;
}

/** samplePlan as a saved plan: "Set it myself" active, no result. */
export const sampleSaved = (flat: Plan = samplePlan()): SavedPlan => fromFlat(flat, false);

/** A saved plan with a current optimizer result, as Build Plan would save it. */
export function optimizedSaved(base: SavedPlan = sampleSaved(), goal: UserGoal = 'max-end-balance', windows: BlendWindow[] = [OPT_WINDOW]): SavedPlan {
  return applyResult(base, fakeResult(goal, windows));
}

/** The same, with the result out of date. */
export function staleSaved(base?: SavedPlan): SavedPlan {
  const p = optimizedSaved(base);
  return { ...p, strategy: { ...p.strategy, result: { ...p.strategy.result!, inputKey: 'old-key' } } };
}
