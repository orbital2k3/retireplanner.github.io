import type { ExpenseStream, Plan, PersonPortfolio } from '../../schemas/plan';
import { planA_simple } from '../__golden/plans';

/** Fixture helpers for the HSA tests: layer an HSA onto any plan without touching its other fields. */
export interface HsaPlanPatch {
  a?: Partial<PersonPortfolio>;
  b?: Partial<PersonPortfolio>;
  hsaReturn?: number;
  policyAge?: number;
}

export function withHsa(plan: Plan, patch: HsaPlanPatch): Plan {
  const pf = plan.portfolio;
  return {
    ...plan,
    assumptions: patch.hsaReturn !== undefined ? { ...plan.assumptions, hsaReturn: patch.hsaReturn } : plan.assumptions,
    portfolio: {
      ...pf,
      personA: { ...pf.personA, ...patch.a },
      ...(pf.personB ? { personB: { ...pf.personB, ...patch.b } } : {}),
      ...(patch.policyAge !== undefined ? { hsaPolicy: { payMedicalFromAge: patch.policyAge } } : {}),
    },
  };
}

/** A medical-tagged household expense row. */
export function medicalRow(over: Partial<ExpenseStream> & { annualAmount: number }): ExpenseStream {
  return {
    id: 'med', description: 'Medical', whose: 'Household', startAge: 0, end: { mode: 'life' },
    survivorPct: 1, inflationPct: { mode: 'cpi' }, category: 'medical', ...over,
  } as ExpenseStream;
}

/** Replace the plan's expense rows (keeping the tags on whatever is passed). */
export const withExpenses = (plan: Plan, rows: ExpenseStream[]): Plan => ({ ...plan, expenseStreams: rows });

/** planA retiring at 58 with 40k of medical spending starting then. A is 53 in 2026. */
export function medicalPlan(over: Parameters<typeof withHsa>[1], medical = 40_000): Plan {
  const p = planA_simple();
  const retired = { ...p, personA: { ...p.personA, retirementAge: 58 }, personB: { ...p.personB!, retirementAge: 55 } };
  return withExpenses(
    withHsa(retired, over),
    [
      { ...p.expenseStreams[0], startAge: 58 },
      medicalRow({ id: 'med', startAge: 58, annualAmount: medical, inflationPct: { mode: 'fixed', rate: 0.03 } }),
    ],
  );
}

/** Nothing but an HSA: the household has to live on it (plus Social Security later). */
export function hsaOnlyPlan(receipts = 0, medical = 10_000): Plan {
  const p = planA_simple();
  const zero = { taxable: 0, taxableBasis: 0, traditional: 0, roth: 0, annualContribution: 0 };
  const hsa = withHsa({
    ...p,
    personA: { ...p.personA, retirementAge: 55, ssClaimAge: 70 },
    personB: { ...p.personB!, retirementAge: 55, ssClaimAge: 70 },
    portfolio: { personA: { ...p.portfolio.personA, ...zero }, personB: { ...p.portfolio.personB!, ...zero } },
  }, { a: { hsa: 700_000, hsaReceipts: receipts } });
  return withExpenses(hsa, [
    { ...p.expenseStreams[0], startAge: 55, annualAmount: 30_000, inflationPct: { mode: 'fixed', rate: 0.025 } },
    medicalRow({ id: 'med', startAge: 55, annualAmount: medical, inflationPct: { mode: 'fixed', rate: 0.025 } }),
  ]);
}
