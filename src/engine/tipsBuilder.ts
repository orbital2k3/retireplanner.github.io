import type { Portfolio, TipsRung } from '../schemas/plan';
import { ladderInBalances } from './tipsValidation';

/** TIPS ladder builder (pure). Sizes one rung per year so the ladder pays a fixed real income from
 *  `fromYear` through `throughYear`.
 *
 *  Sizing follows the engine's convention exactly (tipsLadder.ts): every flow of a year is valued at
 *  the year-end CPI index, the coupon is on year-end indexed principal and maturity pays the indexed
 *  principal (faceValue is left absent, so par = principal and the floor never adds cash). In real
 *  terms (nominal / year-end index) a rung with principal P and coupon c therefore pays c*P every year
 *  it is alive and P at maturity. Rungs are bought at par with coupon = real yield, so the cost today
 *  is the sum of the principals, which is also what the engine carves out of the funding account.
 *
 *  Backward bootstrap: the last rung covers its year on its own, P_N = I / (1 + c); each earlier
 *  rung covers what the later rungs' coupons leave over, P_k = (I - c * sum_{j>k} P_j) / (1 + c).
 *  With one yield for all rungs this is P_k = I / (1 + c)^(N - k + 1). */

export type BuilderFunding =
  | { account: 'taxable' | 'roth' }
  | { account: 'traditional'; whose: 'A' | 'B' };

export interface TipsBuildInput {
  /** Real income per year, today's dollars. */
  incomeReal: number;
  /** First and last calendar years the ladder pays (inclusive). */
  fromYear: number;
  throughYear: number;
  /** Real yield, e.g. 0.019. Also the coupon rate of every rung. */
  realYield: number;
  funding: BuilderFunding;
  /** Years before this are skipped (a rung can't mature before the plan starts). */
  startYear: number;
}

export interface TipsBuildRow {
  year: number;
  principal: number;
  /** What the whole ladder (these rungs only) pays in this year, in today's dollars. */
  paysReal: number;
}

export interface TipsBuildResult {
  rungs: TipsRung[];
  rows: TipsBuildRow[];
  /** Cost today: the sum of the rung principals. */
  cost: number;
}

/** Most rungs one build may add (a 40-year ladder is already longer than any real TIPS curve). */
export const MAX_BUILDER_RUNGS = 40;

const newId = (year: number, k: number): string =>
  `tips-b-${year}-${Date.now().toString(36)}-${k}-${Math.floor(Math.random() * 1e6)}`;

export function buildTipsLadder(input: TipsBuildInput, makeId: (year: number, k: number) => string = newId): TipsBuildResult {
  const first = Math.max(input.fromYear, input.startYear);
  const last = Math.min(input.throughYear, first + MAX_BUILDER_RUNGS - 1);
  const c = input.realYield;
  if (!(input.incomeReal > 0) || last < first || !(c >= 0)) return { rungs: [], rows: [], cost: 0 };

  const n = last - first + 1;
  const principal: number[] = new Array(n);
  let later = 0;
  for (let k = n - 1; k >= 0; k--) {
    // Whole dollars: brokerages quote TIPS in dollar amounts and the rounding moves a year's income by < $1.
    principal[k] = Math.max(0, Math.round((input.incomeReal - c * later) / (1 + c)));
    later += principal[k];
  }

  const whose: TipsRung['whose'] = input.funding.account === 'traditional' ? input.funding.whose : 'Household';
  const rungs: TipsRung[] = [];
  const rows: TipsBuildRow[] = [];
  let alive = later; // principal of rungs maturing this year or later
  for (let k = 0; k < n; k++) {
    const year = first + k;
    rungs.push({ id: makeId(year, k), maturityYear: year, adjustedPrincipal: principal[k], couponRate: c, account: input.funding.account, whose });
    rows.push({ year, principal: principal[k], paysReal: c * alive + principal[k] });
    alive -= principal[k];
  }
  return { rungs: rungs.filter((r) => r.adjustedPrincipal > 0), rows, cost: later };
}

/** Money the funding account still has for new rungs: its balance less the live rungs already carved
 *  out of it. Taxable and Roth are household pools (as in resolveTipsLadder); pre-tax is per person. */
export function builderFundingAvailable(portfolio: Portfolio, funding: BuilderFunding, startYear: number): number {
  const a = portfolio.personA, b = portfolio.personB;
  const ownerB = funding.account === 'traditional' && funding.whose === 'B';
  const balance = funding.account === 'taxable' ? a.taxable + (b?.taxable ?? 0)
    : funding.account === 'roth' ? a.roth + (b?.roth ?? 0)
    : ownerB ? (b?.traditional ?? 0) : a.traditional;
  const held = (portfolio.tipsLadder?.rungs ?? [])
    .filter((r) => r.maturityYear >= startYear && r.account === funding.account
      && (funding.account !== 'traditional' || (r.whose === 'B') === ownerB))
    .reduce((s, r) => s + r.adjustedPrincipal, 0);
  return balance - held;
}

/** Why the builder can't add its rungs, or null when it can. */
export function builderBlocker(portfolio: Portfolio, funding: BuilderFunding, cost: number, startYear: number): string | null {
  // On-top ladders are extra money beyond the balances; buying from a balance would count it twice.
  if (portfolio.tipsLadder && !ladderInBalances(portfolio)) {
    return 'Your ladder is set as extra money on top of your balances. Tick "My account balances above already include these bonds" to buy rungs from an account.';
  }
  const avail = builderFundingAvailable(portfolio, funding, startYear);
  if (cost > avail + 0.005) {
    return `This ladder costs $${Math.round(cost).toLocaleString('en-US')} but the account has $${Math.round(Math.max(0, avail)).toLocaleString('en-US')} left after the rungs it already holds.`;
  }
  return null;
}

/** The engine's calendar year in which a person reaches `age`, given their age in `startYear`. */
export const yearAtAge = (age: number, ageInStartYear: number, startYear: number): number =>
  startYear + (age - ageInStartYear);
