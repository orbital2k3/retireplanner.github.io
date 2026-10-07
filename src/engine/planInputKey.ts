import type { Plan } from '../schemas/plan';

/**
 * Returns the projection horizon expressed in Person A's age frame:
 * max(A.planThroughAge, B.planThroughAge-in-A-frame).
 * Drop-in replacement for the old `householdPlanToAgeA`.
 */
export function householdPlanThroughAgeA(plan: Plan): number {
  const ptA = plan.personA.planThroughAge;
  if (!plan.personB) return ptA;
  const birthYearA = parseInt(plan.personA.dob.slice(0, 4), 10);
  const birthYearB = parseInt(plan.personB.dob.slice(0, 4), 10);
  // When B reaches planThroughAgeB, A's equivalent age = B.planThroughAge + (birthYearB - birthYearA)
  const bEndInATerms = plan.personB.planThroughAge + (birthYearB - birthYearA);
  return Math.max(ptA, bEndInATerms);
}

export const OPTIMIZER_INPUT_FIELDS = [
  'personA', 'personB', 'assumptions', 'portfolio',
  'incomeStreams', 'lumpSumEvents', 'expenseStreams', 'withdrawalStrategy',
  'withdrawalBracketCeiling', 'conversion', 'payTaxFromBrokerage', 'state',
  'customStateTaxRate', 'goals',
] as const;

export const OPTIMIZER_OUTPUT_FIELDS = [
  'customPolicy', 'conversionBaselinePolicy', 'optimizedForGoal', 'solvedSpendingMultiplier',
  'optimizedBy', 'mcTuning',
] as const;

/** Fingerprint used by the Monte Carlo page to drop results after an input change elsewhere.
 *  Optimizer staleness uses optimizerKey (strategy/optimizerInput.ts), not this. */
export function planInputKey(plan: Plan): string {
  // manualSchedule is excluded: the optimizer either ignores it (optimize=true) or keeps it
  // fixed while choosing withdrawal ordering, and projections always use the current schedule.
  // Keying on it made every keystroke in the manual table trip the stale gate.
  const { manualSchedule, ...conversion } = plan.conversion;
  void manualSchedule;
  return JSON.stringify(
    Object.fromEntries(OPTIMIZER_INPUT_FIELDS.map((k) => [k, k === 'conversion' ? conversion : plan[k]]))
  );
}
