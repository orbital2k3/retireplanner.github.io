import type { ProjectionRow } from './projection';
import type { PlanWarning } from './planWarnings';

/** TIPS warnings that need the projection rows (the plan alone can't tell them). */

const money = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;

/** The IRA's money is tied up in bonds: the required withdrawal is bigger than the cash in the IRA.
 *  The plan holds bonds to maturity and never takes them out in kind, so it pays only what the IRA can. */
export function tipsRmdUnmetWarning(rows: ProjectionRow[]): PlanWarning | null {
  const years = rows.filter((r) => r.rmdUnmet > 1);
  if (years.length === 0) return null;
  const total = years.reduce((s, r) => s + r.rmdUnmet / r.inflationFactor, 0);
  const first = years[0].ageA, last = years[years.length - 1].ageA;
  const span = first === last ? `at ${first}` : `from ${first} to ${last}`;
  return {
    id: 'tips-rmd-unmet',
    severity: 'warn',
    message: `Your required withdrawals ${span} are bigger than the cash in your IRA, because part of it is held in TIPS that mature later. About ${money(total)} (today's dollars) can't be paid in cash. In real life you would take the bonds out in kind or risk a penalty; the plan doesn't model that.`,
  };
}

/** Spending can't be funded while bonds are still held: the plan holds each rung to maturity and never
 *  sells early, so the ladder can't rescue a year that comes before the rung. */
export function tipsStrandedWarning(rows: ProjectionRow[]): PlanWarning | null {
  const r = rows.find((x) => x.shortfall > 1 && x.begTips > 0);
  if (!r) return null;
  return {
    id: 'tips-stranded',
    severity: 'warn',
    message: `From age ${r.ageA} the plan can't fund spending, but ${money(r.begTips / r.inflationFactor)} (today's dollars) is still held in TIPS until they mature. The plan never sells bonds early. Shorten the ladder or keep more in cash-like accounts for those years.`,
  };
}

export function computeTipsProjectionWarnings(rows: ProjectionRow[]): PlanWarning[] {
  return [tipsRmdUnmetWarning(rows), tipsStrandedWarning(rows)].filter((w): w is PlanWarning => w !== null);
}
