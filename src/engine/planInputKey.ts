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
