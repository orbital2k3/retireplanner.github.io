import type { ExpenseStream, Plan, PersonPortfolio } from '../../schemas/plan';

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
