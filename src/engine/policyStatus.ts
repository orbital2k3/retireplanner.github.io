import type { Plan } from '../schemas/plan';
import { optimizerKey } from './strategy/optimizerInput';

export type PolicyStatus = 'none' | 'hand-edited' | 'fresh' | 'stale';

export function policyStatus(plan: Plan): PolicyStatus {
  const p = plan.customPolicy;
  if (!p) return 'none';
  if (p.source !== 'optimizer') return 'hand-edited';
  return p.inputKey === optimizerKey(plan) ? 'fresh' : 'stale';
}
