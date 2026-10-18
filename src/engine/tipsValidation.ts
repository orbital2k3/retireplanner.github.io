import type { Portfolio, TipsRung } from '../schemas/plan';

/** Plan-level checks for a TIPS ladder. They are kept out of the Zod schema on purpose: a rung that
 *  matures next year is valid today and stale tomorrow, and a saved plan must never fail to load
 *  because the calendar moved. The UI and the warnings strip show these; the engine stays safe on
 *  any input (it drops matured rungs and caps the carve-out at the account balance). */
export interface TipsIssue {
  code: 'matured' | 'owner' | 'overflow';
  message: string;
  /** Rung the issue is about (matured / owner). */
  rungId?: string;
  /** Account the issue is about (overflow). */
  account?: TipsRung['account'];
}

const money = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;

/** True when the entered balances already contain the ladder (the default). */
export const ladderInBalances = (portfolio: Portfolio): boolean =>
  portfolio.tipsLadder?.balancesIncludeLadder !== false;

export function tipsLadderIssues(portfolio: Portfolio, startYear: number): TipsIssue[] {
  const ladder = portfolio.tipsLadder;
  if (!ladder || ladder.rungs.length === 0) return [];
  const issues: TipsIssue[] = [];

  for (const r of ladder.rungs) {
    if (r.maturityYear < startYear) {
      issues.push({ code: 'matured', rungId: r.id, message: `The ${r.maturityYear} rung has already matured and is ignored.` });
    }
    if (r.account === 'traditional' && r.whose === 'Household') {
      issues.push({ code: 'owner', rungId: r.id, message: `The ${r.maturityYear} pre-tax rung needs an owner.` });
    }
  }

  if (!ladderInBalances(portfolio)) return issues;

  const live = ladder.rungs.filter((r) => r.maturityYear >= startYear);
  const sum = (pick: (r: TipsRung) => boolean) => live.filter(pick).reduce((s, r) => s + r.adjustedPrincipal, 0);
  const a = portfolio.personA, b = portfolio.personB;
  const checks: Array<{ account: TipsRung['account']; label: string; total: number; balance: number }> = [
    { account: 'taxable', label: 'Taxable', total: sum((r) => r.account === 'taxable'), balance: a.taxable + (b?.taxable ?? 0) },
    { account: 'roth', label: 'Roth', total: sum((r) => r.account === 'roth'), balance: a.roth + (b?.roth ?? 0) },
    { account: 'traditional', label: 'Pre-tax (Person A)', total: sum((r) => r.account === 'traditional' && r.whose === 'A'), balance: a.traditional },
    { account: 'traditional', label: 'Pre-tax (Person B)', total: sum((r) => r.account === 'traditional' && r.whose === 'B'), balance: b?.traditional ?? 0 },
  ];
  for (const c of checks) {
    if (c.total > c.balance + 0.005) {
      issues.push({
        code: 'overflow', account: c.account,
        message: `${c.label} rungs total ${money(c.total)} but that balance is ${money(c.balance)}.`,
      });
    }
  }
  return issues;
}
