import type { Plan } from '../schemas/plan';
import { optimizerKey } from './strategy/optimizerInput';

export type PolicyStatus = 'none' | 'hand-edited' | 'fresh' | 'stale';

/** Status of a flat plan's customPolicy. Pre-v35 data and the optimizer's flat contract
 *  (applyResultToPlan) still use the flat shape, so the migration, import and engine tests judge
 *  them with this. App code reads the saved plan through planStatus / resultStatus instead. */
export function policyStatus(plan: Plan): PolicyStatus {
  const p = plan.customPolicy;
  if (!p) return 'none';
  if (p.source !== 'optimizer') return 'hand-edited';
  return p.inputKey === optimizerKey(plan) ? 'fresh' : 'stale';
}
