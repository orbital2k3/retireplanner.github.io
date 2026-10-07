import { defaultPlan, type Plan, type ConversionParams } from '../../schemas/plan';
import type { SavedPlan, ConversionSettings, OptimizerResult, Strategy } from '../../schemas/savedPlan';
import type { OptimizeResult } from '../optimizer';
import type { UserGoal } from '../recommender';
import type { PolicyStatus } from '../policyStatus';
import { applyResultToPlan } from '../applyOptimizerResult';
import { firstRetirementAgeA } from '../streamWindow';
import { optimizerKey } from './optimizerInput';
import { liveSettings } from './resultSettings';

/**
 * Bridges the stored plan (facts + strategy slots) and the flat engine `Plan`.
 *  - enginePlan: what the user sees (the active slot, or the optimizer result's frozen settings).
 *  - optimizerView: what the optimizer reads (facts + optimizer slot only, never the manual slot).
 */

type Facts = Omit<SavedPlan, 'strategy'>;

const toSettings = ({ optimize: _o, ...rest }: ConversionParams): ConversionSettings => {
  void _o;
  return rest;
};

function factsOf(saved: SavedPlan): Facts {
  const { strategy: _s, ...facts } = saved;
  void _s;
  return facts;
}

/** Facts in flat form, with the optimizer slot's legacy target back in assumptions. */
function flatFacts(saved: SavedPlan) {
  const facts = factsOf(saved);
  return {
    ...facts,
    assumptions: { ...facts.assumptions, legacyTargetTaxAdjReal: saved.strategy.optimizer.legacyTargetTaxAdjReal },
  };
}

/** The flat plan the optimizer reads. Its seed is the stored result's policy, if any. */
export function optimizerView(saved: SavedPlan): Plan {
  const { optimizer: o, result: r } = saved.strategy;
  const neutral = defaultPlan();
  return {
    ...flatFacts(saved),
    withdrawalStrategy: neutral.withdrawalStrategy,
    withdrawalBracketCeiling: neutral.withdrawalBracketCeiling,
    conversion: o.optimizerDecidesConversions ? { ...neutral.conversion, optimize: true } : { ...o.conversion, optimize: false },
    payTaxFromBrokerage: o.payTaxFromBrokerage,
    customPolicy: r ? { windows: r.policy.windows, source: 'optimizer', goal: r.goal } : undefined,
  };
}

/** The flat plan the engine simulates for the charts. */
export function enginePlan(saved: SavedPlan): Plan {
  const s = saved.strategy;
  if (s.active === 'manual') {
    const m = s.manual;
    return {
      ...flatFacts(saved),
      withdrawalStrategy: m.preset,
      withdrawalBracketCeiling: m.withdrawalBracketCeiling,
      conversion: { ...m.conversion, optimize: false },
      payTaxFromBrokerage: m.payTaxFromBrokerage,
      customPolicy: m.customWindows ? { windows: m.customWindows, source: 'manual' } : undefined,
    };
  }
  const view = optimizerView(saved);
  const r = s.result;
  if (!r) return { ...view, customPolicy: undefined };
  return {
    ...view,
    ...r.settings,
    customPolicy: { windows: r.policy.windows, source: 'optimizer', goal: r.goal },
    conversionBaselinePolicy: r.conversionBaseline ? { windows: r.conversionBaseline.windows, source: 'optimizer' } : undefined,
    optimizedForGoal: r.goal,
    optimizedBy: r.optimizedBy,
    mcTuning: r.mcTuning,
    solvedSpendingMultiplier: r.solvedSpendingMultiplier,
  };
}

/** Fingerprint of what the optimizer receives. The manual slot and `active` never enter it. */
export function savedOptimizerKey(saved: SavedPlan): string {
  return optimizerKey(optimizerView(saved));
}

export type ResultStatus = 'none' | 'fresh' | 'stale';

/** Whether the stored optimizer result matches the current facts and optimizer settings. */
export function resultStatus(saved: SavedPlan): ResultStatus {
  const r = saved.strategy.result;
  if (!r) return 'none';
  return r.inputKey === savedOptimizerKey(saved) ? 'fresh' : 'stale';
}

/** Status of what the charts show: the manual slot, or the optimizer result. */
export function planStatus(saved: SavedPlan): PolicyStatus {
  const s = saved.strategy;
  if (s.active === 'manual') return s.manual.customWindows ? 'hand-edited' : 'none';
  return resultStatus(saved);
}

/** Re-optimize is offered exactly when there is no current result for the selected goal. */
export function canReOptimize(saved: SavedPlan): boolean {
  const r = saved.strategy.result;
  return resultStatus(saved) !== 'fresh' || r?.goal !== saved.strategy.optimizer.goal;
}

/** Facts of a flat plan (strategy fields and the legacy target dropped). */
function factsFromFlat(flat: Plan): Facts {
  const {
    withdrawalStrategy: _a, withdrawalBracketCeiling: _b, customPolicy: _c, conversionBaselinePolicy: _d,
    optimizedForGoal: _e, optimizedBy: _f, mcTuning: _g, solvedSpendingMultiplier: _h, conversion: _i,
    payTaxFromBrokerage: _j, ...facts
  } = flat;
  void [_a, _b, _c, _d, _e, _f, _g, _h, _i, _j];
  const { legacyTargetTaxAdjReal: _l, ...assumptions } = facts.assumptions;
  void _l;
  return { ...facts, assumptions };
}

/** Saves an optimizer result: facts it rewrote (Max Spending, Earliest Retire), the result with its
 *  frozen settings, and `active: 'optimizer'`. Contract: runProjection(enginePlan(next)) equals
 *  result.projection. */
export function applyResult(saved: SavedPlan, result: OptimizeResult): SavedPlan {
  const flat = applyResultToPlan(optimizerView(saved), result);
  const s = saved.strategy;
  const cp = flat.customPolicy!;
  const optimizer = result.conversionsDisabled
    ? { ...s.optimizer, goal: result.goal, optimizerDecidesConversions: false, conversion: { ...s.optimizer.conversion, mode: 'off' as const } }
    : { ...s.optimizer, goal: result.goal };
  const next: SavedPlan = {
    ...factsFromFlat(flat),
    strategy: {
      ...s,
      active: 'optimizer',
      optimizer,
      result: {
        policy: { windows: cp.windows },
        goal: result.goal,
        inputKey: '',
        settings: cp.settings!,
        optimizedBy: 'optimizer',
        conversionBaseline: flat.conversionBaselinePolicy ? { windows: flat.conversionBaselinePolicy.windows } : undefined,
        solvedSpendingMultiplier: flat.solvedSpendingMultiplier,
      },
    },
  };
  next.strategy.result!.inputKey = savedOptimizerKey(next);
  return next;
}

/** Maps a flat (pre-v35) plan into slots. The projection is unchanged: the active slot is the one
 *  the flat plan was showing, and an optimizer result keeps its frozen settings. `fresh` says
 *  whether the flat plan's result was current; it stays current under the new key. */
export function fromFlat(flat: Plan, fresh: boolean): SavedPlan {
  const cp = flat.customPolicy;
  const hasResult = cp?.source === 'optimizer';
  const settings = toSettings(flat.conversion);
  const goal = (flat.optimizedForGoal ?? (cp?.goal as UserGoal | undefined) ?? 'max-end-balance') as UserGoal;
  const decides = flat.conversion.optimize ?? true;

  // A flat plan without a result showed its conversion mode with optimize:true still blocking
  // pre-retirement conversions. Keep that: drop schedule ages before anyone retires.
  let manualConversion = settings;
  if (!hasResult && decides && settings.mode === 'manual') {
    const firstRetire = firstRetirementAgeA(flat);
    manualConversion = {
      ...settings,
      manualSchedule: Object.fromEntries(Object.entries(settings.manualSchedule).filter(([age]) => Number(age) >= firstRetire)),
    };
  }

  const strategy: Strategy = {
    active: hasResult ? 'optimizer' : 'manual',
    manual: {
      preset: flat.withdrawalStrategy,
      customWindows: cp && !hasResult ? cp.windows : undefined,
      withdrawalBracketCeiling: flat.withdrawalBracketCeiling,
      conversion: { ...manualConversion, manualSchedule: { ...manualConversion.manualSchedule } },
      payTaxFromBrokerage: flat.payTaxFromBrokerage,
    },
    optimizer: {
      goal,
      optimizerDecidesConversions: decides,
      // Each slot gets its own copy: they are edited independently from here on.
      conversion: { ...settings, manualSchedule: { ...settings.manualSchedule } },
      payTaxFromBrokerage: flat.payTaxFromBrokerage,
      legacyTargetTaxAdjReal: flat.assumptions.legacyTargetTaxAdjReal ?? 0,
    },
  };
  const saved: SavedPlan = { ...factsFromFlat(flat), strategy };
  if (hasResult) {
    const result: OptimizerResult = {
      policy: { windows: cp.windows },
      goal,
      inputKey: '',
      settings: cp.settings ?? liveSettings(flat),
      optimizedBy: flat.optimizedBy ?? 'optimizer',
      mcTuning: flat.mcTuning,
      conversionBaseline: flat.conversionBaselinePolicy ? { windows: flat.conversionBaselinePolicy.windows } : undefined,
      solvedSpendingMultiplier: flat.solvedSpendingMultiplier,
    };
    saved.strategy.result = result;
    result.inputKey = fresh ? savedOptimizerKey(saved) : (cp.inputKey ?? 'pre-v35-stale');
  }
  return saved;
}

/** A new user's plan: the blank defaults, no result yet, "Set it myself" active. */
export function defaultSavedPlan(): SavedPlan {
  return fromFlat(defaultPlan(), false);
}
