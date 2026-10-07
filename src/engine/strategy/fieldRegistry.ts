import type { Plan, Assumptions, ConversionParams } from '../../schemas/plan';
import type { SavedPlan } from '../../schemas/savedPlan';

/** What a Plan field is, for deciding what the optimizer sees and what makes its result stale.
 *  - fact: describes the household. Always live in projections; changes make a result stale.
 *  - optimizerSetting: a strategy setting the optimizer reads. Changes make a result stale.
 *  - manualSetting: "Set it myself" only. The optimizer never sees it.
 *  - output: written by the optimizer (or derived from its result). Never part of the key.
 *  - display: stored with the plan but read by no engine code. */
export type FieldClass = 'fact' | 'optimizerSetting' | 'manualSetting' | 'output' | 'display';

/** A string classifies the whole subtree; an object classifies each key of a nested object. */
export type RegistryEntry = FieldClass | { readonly [key: string]: RegistryEntry };

const ASSUMPTIONS: Record<keyof Assumptions, FieldClass> = {
  taxableReturn: 'fact',
  taxableDivYield: 'fact',
  taxableQualifiedPct: 'fact',
  taxableExemptYield: 'fact',
  taxableExemptStatePct: 'fact',
  taxableDistributePct: 'fact',
  taxAdjOrdRate: 'fact',
  taxAdjLtcgRate: 'fact',
  legacyTargetTaxAdjReal: 'optimizerSetting',
  tradReturn: 'fact',
  rothReturn: 'fact',
  inflation: 'fact',
  modelACA: 'fact',
  acaHouseholdSize: 'fact',
  acaBenchmarkPremium: 'fact',
  acaNoSubsidy: 'fact',
  acaStartAgeA: 'fact',
  acaStartAgeB: 'fact',
};

// Shared by "Set it myself" and "Optimize for me" until the Phase 2 slots split them.
const CONVERSION: Record<keyof ConversionParams, FieldClass> = {
  mode: 'optimizerSetting',
  startAge: 'optimizerSetting',
  endAge: 'optimizerSetting',
  autoAmount: 'optimizerSetting',
  bracketCeiling: 'optimizerSetting',
  manualSchedule: 'optimizerSetting',
  optimize: 'optimizerSetting',
};

export const FIELD_REGISTRY: Record<keyof Plan, RegistryEntry> = {
  personA: 'fact',
  personB: 'fact',
  assumptions: ASSUMPTIONS,
  portfolio: 'fact',
  incomeStreams: 'fact',
  lumpSumEvents: 'fact',
  expenseStreams: 'fact',
  state: 'fact',
  customStateTaxRate: 'fact',
  withdrawalStrategy: 'manualSetting',
  withdrawalBracketCeiling: 'manualSetting',
  conversion: CONVERSION,
  payTaxFromBrokerage: 'optimizerSetting',
  customPolicy: 'output',
  conversionBaselinePolicy: 'output',
  optimizedForGoal: 'output',
  optimizedBy: 'output',
  mcTuning: 'output',
  solvedSpendingMultiplier: 'output',
  goals: 'display',
};

/** Classification of a dotted path (e.g. "assumptions.inflation"); the deepest registry entry wins. */
export function classifyPath(path: readonly string[]): FieldClass | undefined {
  let entry: RegistryEntry | undefined = { ...FIELD_REGISTRY };
  for (const key of path) {
    if (typeof entry === 'string') return entry;
    entry = entry?.[key];
  }
  return typeof entry === 'string' ? entry : undefined;
}

/** The same classification for the stored plan (facts + strategy slots). The goal pill and the
 *  active tab are 'display' for the key: the goal is compared against the result's goal
 *  separately, and switching tabs never changes what the optimizer sees. */
export const SAVED_FIELD_REGISTRY: Record<keyof SavedPlan, RegistryEntry> = {
  personA: 'fact',
  personB: 'fact',
  assumptions: Object.fromEntries(Object.entries(ASSUMPTIONS).filter(([k]) => k !== 'legacyTargetTaxAdjReal')),
  portfolio: 'fact',
  incomeStreams: 'fact',
  lumpSumEvents: 'fact',
  expenseStreams: 'fact',
  state: 'fact',
  customStateTaxRate: 'fact',
  goals: 'display',
  strategy: {
    active: 'display',
    manual: 'manualSetting',
    optimizer: {
      goal: 'display',
      optimizerDecidesConversions: 'optimizerSetting',
      conversion: 'optimizerSetting',
      payTaxFromBrokerage: 'optimizerSetting',
      legacyTargetTaxAdjReal: 'optimizerSetting',
    },
    result: 'output',
  },
};

/** classifyPath for the stored plan. */
export function classifySavedPath(path: readonly string[]): FieldClass | undefined {
  let entry: RegistryEntry | undefined = { ...SAVED_FIELD_REGISTRY };
  for (const key of path) {
    if (typeof entry === 'string') return entry;
    entry = entry?.[key];
  }
  return typeof entry === 'string' ? entry : undefined;
}
