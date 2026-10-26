import type { ExpenseStream, Plan, TipsRung } from '../../schemas/plan';
import { planA_simple, planB_largeTradSingle } from '../__golden/plans';

/** Fixture helpers for the TIPS tests: layer a ladder onto any plan without touching its other fields. */

export const thisYear = (): number => new Date().getFullYear();

let seq = 0;
/** One rung. Defaults: taxable, household, $10k, 1% coupon, maturing in `maturityYear`. */
export function rung(over: Partial<TipsRung> & { maturityYear: number }): TipsRung {
  return {
    id: `rung-${++seq}`, adjustedPrincipal: 10_000, couponRate: 0.01, account: 'taxable', whose: 'Household', ...over,
  };
}

/** A run of consecutive annual rungs, one per maturity year from `firstYear`, all alike. */
export function ladderRungs(opts: {
  firstYear: number; years: number; principal: number; couponRate?: number;
  account?: TipsRung['account']; whose?: TipsRung['whose']; faceValue?: number;
}): TipsRung[] {
  return Array.from({ length: opts.years }, (_, k) => rung({
    maturityYear: opts.firstYear + k,
    adjustedPrincipal: opts.principal,
    couponRate: opts.couponRate ?? 0.01,
    account: opts.account ?? 'taxable',
    whose: opts.whose ?? (opts.account === 'traditional' ? 'A' : 'Household'),
    ...(opts.faceValue !== undefined ? { faceValue: opts.faceValue } : {}),
  }));
}

/** Attach a ladder. `include` = balancesIncludeLadder (omitted = absent = true). */
export function withTips(plan: Plan, rungs: TipsRung[], include?: boolean): Plan {
  return {
    ...plan,
    portfolio: {
      ...plan.portfolio,
      tipsLadder: { rungs, ...(include === undefined ? {} : { balancesIncludeLadder: include }) },
    },
  };
}

/** Replace the plan's expense rows. */
export const withExpenses = (plan: Plan, rows: ExpenseStream[]): Plan => ({ ...plan, expenseStreams: rows });

const zeroBal = { taxable: 0, taxableBasis: 0, traditional: 0, roth: 0, annualContribution: 0 };

/** A retired couple (A 53, B 51 in 2026) living on a mix of accounts: taxable 400k (basis 250k),
 *  pre-tax A 500k / B 200k, Roth 150k, 70k of spending from retirement. IL, taxfirst, no conversions.
 *  Social Security starts at 67, so the early years are all portfolio. */
export function tipsRetireePlan(): Plan {
  const p = planA_simple();
  return withExpenses({
    ...p,
    personA: { ...p.personA, retirementAge: 53, ssClaimAge: 67 },
    personB: { ...p.personB!, retirementAge: 51, ssClaimAge: 67 },
    portfolio: {
      personA: { ...p.portfolio.personA, taxable: 250_000, taxableBasis: 150_000, traditional: 500_000, roth: 90_000, annualContribution: 0 },
      personB: { ...p.portfolio.personB!, taxable: 150_000, taxableBasis: 100_000, traditional: 200_000, roth: 60_000, annualContribution: 0 },
    },
    conversion: { ...p.conversion, mode: 'off', optimize: false },
  }, [
    { ...p.expenseStreams[0], startAge: 53, annualAmount: 70_000, inflationPct: { mode: 'fixed', rate: 0.025 } },
  ]);
}

/** Retired, no spending, no income, only accounts: nothing is taxed or withdrawn, so every balance
 *  moves by its own growth and the ladder's year-0 effect can be computed by hand. */
export function tipsIdlePlan(over: { taxable?: number; trad?: number; roth?: number } = {}): Plan {
  const p = planA_simple();
  return {
    ...p,
    personA: { ...p.personA, retirementAge: 53, ssClaimAge: 70 },
    personB: { ...p.personB!, retirementAge: 51, ssClaimAge: 70 },
    portfolio: {
      personA: { ...p.portfolio.personA, ...zeroBal, taxable: over.taxable ?? 0, taxableBasis: over.taxable ?? 0, traditional: over.trad ?? 0, roth: over.roth ?? 0 },
      personB: { ...p.portfolio.personB!, ...zeroBal },
    },
    expenseStreams: [],
    conversion: { ...p.conversion, mode: 'off', optimize: false },
  };
}

/** A single retiree, 74 in 2026 (RMDs from 73), living on a large IRA. */
export function tipsRmdPlan(over: { trad?: number; taxable?: number } = {}): Plan {
  const p = planB_largeTradSingle();
  return withExpenses({
    ...p,
    personA: { ...p.personA, dob: '1952-03-01', retirementAge: 65, planThroughAge: 95, ssPIA: 30_000, ssClaimAge: 67 },
    portfolio: {
      personA: { ...p.portfolio.personA, taxable: over.taxable ?? 500_000, taxableBasis: over.taxable ?? 500_000, traditional: over.trad ?? 1_000_000, roth: 0, annualContribution: 0 },
      personB: undefined,
    },
    conversion: { ...p.conversion, mode: 'off', optimize: false },
  }, [
    { ...p.expenseStreams[0], startAge: 65, annualAmount: 40_000, inflationPct: { mode: 'fixed', rate: 0.025 } },
  ]);
}
