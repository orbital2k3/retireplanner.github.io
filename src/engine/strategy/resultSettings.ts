import type { Plan, ResultSettings } from '../../schemas/plan';
import { optimizerInput } from './optimizerInput';

/** The strategy settings the optimizer sees for this plan (what applyResultToPlan freezes). */
export function optimizerSettings(plan: Plan): ResultSettings {
  const i = optimizerInput(plan);
  return {
    conversion: i.conversion,
    payTaxFromBrokerage: i.payTaxFromBrokerage,
    withdrawalStrategy: i.withdrawalStrategy,
    withdrawalBracketCeiling: i.withdrawalBracketCeiling,
  };
}

/** The plan's own strategy fields, unchanged (used to freeze results saved before v34). */
export function liveSettings(plan: Plan): ResultSettings {
  return {
    conversion: plan.conversion,
    payTaxFromBrokerage: plan.payTaxFromBrokerage,
    withdrawalStrategy: plan.withdrawalStrategy,
    withdrawalBracketCeiling: plan.withdrawalBracketCeiling,
  };
}

/** The plan the engine should simulate. While an optimizer result is active, its frozen
 *  settings replace the live strategy fields; facts stay live. The snapshot is removed from
 *  the returned policy, so variants built from the result (counterfactuals, previews) can
 *  override a setting and have it take effect. Idempotent. */
export function resolveStrategy(plan: Plan): Plan {
  const cp = plan.customPolicy;
  if (!cp?.settings) return plan;
  const { settings, ...policy } = cp;
  return cp.source === 'optimizer' ? { ...plan, ...settings, customPolicy: policy } : { ...plan, customPolicy: policy };
}
