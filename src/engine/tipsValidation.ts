import type { Portfolio, TipsRung } from '../schemas/plan';

/** Plan-level checks for a TIPS ladder. They are kept out of the Zod schema on purpose: a rung that
 *  matures next year is valid today and stale tomorrow, and a saved plan must never fail to load
 *  because the calendar moved. The UI and the warnings strip show these; the engine stays safe on
 *  any input (it drops matured rungs and caps the carve-out at the account balance). */
export interface TipsIssue {
  code: 'matured' | 'owner' | 'overflow' | 'face' | 'basis';
  message: string;
  /** Rung the issue is about (matured / owner / face). */
  rungId?: string;
  /** Account the issue is about (overflow). */
  account?: TipsRung['account'];
  /** Overflow only: where it sits ("Roth", "taxable", "Alex's pre-tax account"), the rung total and the balance. */
  place?: string;
  total?: number;
  balance?: number;
}

const money = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;

/** Par above the adjusted principal only happens after deflation since the bond was issued, so it is
 *  checked above `TIPS_FACE_CHECK_RATIO` and the engine never uses more than `TIPS_MAX_FACE_RATIO`
 *  times the principal (no issued TIPS has had an index ratio near 0.8). A typo can't create money. */
export const TIPS_FACE_CHECK_RATIO = 1.05;
export const TIPS_MAX_FACE_RATIO = 1.25;

/** True when the entered balances already contain the ladder (the default). */
export const ladderInBalances = (portfolio: Portfolio): boolean =>
  portfolio.tipsLadder?.balancesIncludeLadder !== false;

export function tipsLadderIssues(portfolio: Portfolio, startYear: number, names: { a?: string; b?: string } = {}): TipsIssue[] {
  const ladder = portfolio.tipsLadder;
  if (!ladder || ladder.rungs.length === 0) return [];
  const issues: TipsIssue[] = [];

  const inBalances = ladderInBalances(portfolio);
  for (const r of ladder.rungs) {
    if (r.maturityYear < startYear) {
      // With the ladder inside the balances its proceeds are already in an account; on top of the balances
      // they are in none, so the plan stops counting that money until the user adds it to a balance.
      issues.push({
        code: 'matured', rungId: r.id,
        message: inBalances
          ? `The ${r.maturityYear} rung has already matured and is ignored: its proceeds should now be in your account balance. Remove it.`
          : `The ${r.maturityYear} rung has already matured. Your balances leave out the ladder, so the plan no longer counts the money it paid. Add those proceeds to the account balance, then remove the rung.`,
      });
    }
    if (r.faceValue !== undefined && r.faceValue > r.adjustedPrincipal * TIPS_FACE_CHECK_RATIO) {
      const capped = r.faceValue > r.adjustedPrincipal * TIPS_MAX_FACE_RATIO;
      issues.push({
        code: 'face', rungId: r.id,
        message: `The ${r.maturityYear} rung's face value (${money(r.faceValue)}) is above its adjusted principal (${money(r.adjustedPrincipal)}). That only happens after deflation since the bond was issued, so check the number.${capped ? ` The plan uses at most ${money(r.adjustedPrincipal * TIPS_MAX_FACE_RATIO)}.` : ''}`,
      });
    }
    if (r.account === 'traditional' && r.whose === 'Household') {
      issues.push({ code: 'owner', rungId: r.id, message: `The ${r.maturityYear} pre-tax rung needs an owner.` });
    }
  }

  if (!inBalances) return issues;

  const live = ladder.rungs.filter((r) => r.maturityYear >= startYear);
  const sum = (pick: (r: TipsRung) => boolean) => live.filter(pick).reduce((s, r) => s + r.adjustedPrincipal, 0);
  const a = portfolio.personA, b = portfolio.personB;
  const checks: Array<{ account: TipsRung['account']; label: string; place: string; total: number; balance: number }> = [
    { account: 'taxable', label: 'Taxable', place: 'taxable', total: sum((r) => r.account === 'taxable'), balance: a.taxable + (b?.taxable ?? 0) },
    { account: 'roth', label: 'Roth', place: 'Roth', total: sum((r) => r.account === 'roth'), balance: a.roth + (b?.roth ?? 0) },
    { account: 'traditional', label: `Pre-tax (${names.a ?? 'Person A'})`, place: `${names.a ?? 'Person A'}'s pre-tax account`, total: sum((r) => r.account === 'traditional' && r.whose === 'A'), balance: a.traditional },
    { account: 'traditional', label: `Pre-tax (${names.b ?? 'Person B'})`, place: `${names.b ?? 'Person B'}'s pre-tax account`, total: sum((r) => r.account === 'traditional' && r.whose === 'B'), balance: b?.traditional ?? 0 },
  ];
  // Taxable rungs are carved out with their share of the basis. Any part of them the entered basis can't
  // cover is unrealized gain, which the engine realizes as the rungs mature.
  const taxableRungs = checks[0].total;
  const basis = a.taxableBasis + (b?.taxableBasis ?? 0);
  const carved = Math.min(taxableRungs, checks[0].balance);
  if (carved > basis + 0.5) {
    issues.push({
      code: 'basis', account: 'taxable', total: carved, balance: basis,
      message: `Your taxable rungs (${money(carved)}) are more than your taxable basis (${money(basis)}). The plan counts the ${money(carved - basis)} difference as a capital gain, taxed as those rungs mature. If you bought these bonds a while ago, their basis is about their adjusted principal: include it in Taxable Basis.`,
    });
  }
  for (const c of checks) {
    if (c.total > c.balance + 0.005) {
      issues.push({
        code: 'overflow', account: c.account, place: c.place, total: c.total, balance: c.balance,
        message: `${c.label} rungs total ${money(c.total)} but that balance is ${money(c.balance)}.`,
      });
    }
  }
  return issues;
}
