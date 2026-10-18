import type { Plan } from '../schemas/plan';
import type { ProjectionRow } from './projection';
import type { PlanWarning } from './planWarnings';
import { federalPovertyLevel } from './aca';

/** Warnings that need the projection rows (the plan alone can't tell them). */

/** Keeping an HSA contribution in retirement lowers ACA income. Below 100% of the poverty level the
 *  household gets no premium credit at all, so the "lever" backfires. Fires when a contribution is the
 *  reason a year falls below it (the income without the contribution would have been at or above). */
export function hsaAcaFloorWarning(plan: Plan, rows: ProjectionRow[]): PlanWarning | null {
  const a = plan.assumptions;
  if (!a.modelACA || a.acaBenchmarkPremium <= 0 || a.acaNoSubsidy) return null;
  const years = rows.filter((r) => {
    if (r.hsaContribRet <= 0 || r.acaPremium <= 0) return false;
    const fpl = federalPovertyLevel(a.acaHouseholdSize) * r.inflationFactor;
    return r.acaMagi < fpl && r.acaMagi + r.hsaContribRet >= fpl;
  });
  if (years.length === 0) return null;
  const first = years[0].ageA, last = years[years.length - 1].ageA;
  const span = first === last ? `at ${first}` : `from ${first} to ${last}`;
  return {
    id: 'hsa-aca-below-fpl',
    severity: 'warn',
    message: `Your HSA contribution in retirement drops your ACA income below 100% of the poverty level ${span}, so you would lose the marketplace premium credit. Lower the contribution or turn it off for those years.`,
  };
}
