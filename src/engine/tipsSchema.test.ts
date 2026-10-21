import { describe, expect, it } from 'vitest';
import { PlanSchema, samplePlan, type Portfolio, type TipsRung } from '../schemas/plan';
import { classifyPath } from './strategy/fieldRegistry';
import { tipsLadderIssues, ladderInBalances } from './tipsValidation';

const rung = (over: Partial<TipsRung> = {}): TipsRung => ({
  id: 'r1', maturityYear: 2031, adjustedPrincipal: 48_000, couponRate: 0.0125, account: 'traditional', whose: 'A', ...over,
});

const withLadder = (rungs: TipsRung[], include?: boolean): Portfolio => {
  const pf = samplePlan().portfolio;
  return { ...pf, tipsLadder: { rungs, ...(include === undefined ? {} : { balancesIncludeLadder: include }) } };
};

/** T-1: the ladder fields are optional with no default, so parsing a plan without one leaves every
 *  key absent and no saved plan's optimizer key moves. */
describe('TIPS schema', () => {
  it('leaves tipsLadder absent when the input has none', () => {
    const parsed = PlanSchema.parse(JSON.parse(JSON.stringify(samplePlan())));
    expect('tipsLadder' in parsed.portfolio).toBe(false);
  });

  it('accepts a full ladder and keeps absent optionals absent', () => {
    const plan = samplePlan();
    const parsed = PlanSchema.parse({
      ...plan,
      portfolio: { ...plan.portfolio, tipsLadder: { rungs: [rung(), rung({ id: 'r2', faceValue: 45_000, account: 'taxable', whose: 'Household' })] } },
    });
    const l = parsed.portfolio.tipsLadder!;
    expect(l.rungs).toHaveLength(2);
    expect('faceValue' in l.rungs[0]).toBe(false);
    expect(l.rungs[1].faceValue).toBe(45_000);
    expect('balancesIncludeLadder' in l).toBe(false);
  });

  it('requires an owner on pre-tax rungs only', () => {
    const plan = samplePlan();
    const parse = (r: TipsRung) => PlanSchema.safeParse({ ...plan, portfolio: { ...plan.portfolio, tipsLadder: { rungs: [r] } } });
    expect(parse(rung({ account: 'traditional', whose: 'Household' })).success).toBe(false);
    expect(parse(rung({ account: 'taxable', whose: 'Household' })).success).toBe(true);
    expect(parse(rung({ account: 'roth', whose: 'Household' })).success).toBe(true);
    expect(parse(rung({ account: 'traditional', whose: 'B' })).success).toBe(true);
  });

  it('rejects non-positive principal and a coupon outside 0-20%', () => {
    const plan = samplePlan();
    const parse = (r: TipsRung) => PlanSchema.safeParse({ ...plan, portfolio: { ...plan.portfolio, tipsLadder: { rungs: [r] } } });
    expect(parse(rung({ adjustedPrincipal: 0 })).success).toBe(false);
    expect(parse(rung({ couponRate: -0.01 })).success).toBe(false);
    expect(parse(rung({ couponRate: 0.5 })).success).toBe(false);
  });

  it('classifies the ladder as a fact', () => {
    expect(classifyPath(['portfolio', 'tipsLadder'])).toBe('fact');
  });
});

describe('tipsLadderIssues', () => {
  const year = 2026;
  const pf = samplePlan().portfolio;

  it('is empty without a ladder or with no rungs', () => {
    expect(tipsLadderIssues(pf, year)).toEqual([]);
    expect(tipsLadderIssues(withLadder([]), year)).toEqual([]);
  });

  it('is empty for rungs inside every balance', () => {
    const small = rung({ adjustedPrincipal: 1_000 });
    expect(tipsLadderIssues(withLadder([small, { ...small, id: 'b', account: 'taxable', whose: 'Household' }, { ...small, id: 'c', account: 'roth', whose: 'Household' }]), year)).toEqual([]);
  });

  it('flags a matured rung, and ignores it in the overflow totals', () => {
    const huge = rung({ id: 'old', maturityYear: 2025, adjustedPrincipal: 1e9 });
    const issues = tipsLadderIssues(withLadder([huge]), year);
    expect(issues.map((i) => i.code)).toEqual(['matured']);
    expect(issues[0].rungId).toBe('old');
  });

  it('flags a rung that matures this calendar year as fine', () => {
    expect(tipsLadderIssues(withLadder([rung({ maturityYear: year, adjustedPrincipal: 1_000 })]), year)).toEqual([]);
  });

  it('flags a pre-tax rung with no owner', () => {
    const issues = tipsLadderIssues(withLadder([rung({ whose: 'Household', adjustedPrincipal: 1_000 })]), year);
    expect(issues.map((i) => i.code)).toEqual(['owner']);
  });

  it('flags each account whose rungs exceed its balance, per person for pre-tax', () => {
    const a = pf.personA.traditional, taxable = pf.personA.taxable + (pf.personB?.taxable ?? 0);
    const issues = tipsLadderIssues(withLadder([
      rung({ id: 'a', adjustedPrincipal: a + 1 }),
      rung({ id: 't', account: 'taxable', whose: 'Household', adjustedPrincipal: taxable + 1 }),
    ]), year);
    expect(issues.filter((i) => i.code === 'overflow').map((i) => `${i.code}:${i.account}`).sort()).toEqual(['overflow:taxable', 'overflow:traditional']);
    expect(issues.find((i) => i.account === 'traditional')!.message).toContain('Person A');
  });

  it('does not check overflow when the balances do not include the ladder', () => {
    const p = withLadder([rung({ adjustedPrincipal: 1e9 })], false);
    expect(ladderInBalances(p)).toBe(false);
    expect(tipsLadderIssues(p, year)).toEqual([]);
  });
});
