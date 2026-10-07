import { usePlanStore } from '../store/usePlanStore';
import { useOptimizerStore } from '../store/useOptimizerStore';
import { planStatus } from '../engine/strategy/savedPlan';
import type { UserGoal } from '../engine/recommender';
import type { SavedPlan } from '../schemas/savedPlan';

/** Where the committed strategy came from. Absent on plans saved before provenance tracking. */
export type OptimizerSource = 'optimizer' | 'monte-carlo' | 'unknown';

export type OptimizerAppliedState =
  | { kind: 'none' }
  | { kind: 'pending'; goal: UserGoal | null }
  | { kind: 'stale'; goal: UserGoal; source: OptimizerSource; mcTuning: NonNullable<SavedPlan['strategy']['result']>['mcTuning'] }
  | { kind: 'applied'; goal: UserGoal; source: OptimizerSource; mcTuning: NonNullable<SavedPlan['strategy']['result']>['mcTuning'] }
  | { kind: 'hand-edited' };

/** Returns the optimizer applied state for the committed plan.
 *  Precedence: pending > applied/stale/hand-edited > none. */
export function useOptimizerApplied(): OptimizerAppliedState {
  const plan = usePlanStore((s) => s.plan);
  const pendingPlan = useOptimizerStore((s) => s.pendingPlan);
  const pendingGoal = useOptimizerStore((s) => s.pendingGoal);

  if (pendingPlan !== null) {
    return { kind: 'pending', goal: pendingGoal };
  }

  const status = planStatus(plan);
  if (status === 'none') return { kind: 'none' };
  if (status === 'hand-edited') return { kind: 'hand-edited' };

  // status is 'fresh' or 'stale': "Optimize for me" is active with a saved result.
  const { goal, optimizedBy, mcTuning } = plan.strategy.result!;
  const source: OptimizerSource = optimizedBy ?? 'unknown';
  if (status === 'stale') return { kind: 'stale', goal, source, mcTuning };
  return { kind: 'applied', goal, source, mcTuning };
}
