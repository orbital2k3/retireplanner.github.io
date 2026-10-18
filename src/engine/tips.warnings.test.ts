import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computePlanWarnings } from './planWarnings';
import { computeTipsProjectionWarnings } from './tipsWarnings';
import { runProjection } from './projection';
import { planF_allTradCouple, planL_survivorARMD } from './__golden/plans';
import { pinDate, unpinDate } from './__regression__/snapshotUtil';
import { ladderRungs, rung, thisYear, tipsRmdPlan, withTips } from './__testutil__/tipsPlans';

beforeAll(pinDate);
afterAll(unpinDate);
const Y = thisYear();
const tipsIds = (p: Parameters<typeof computePlanWarnings>[0]) => computePlanWarnings(p).filter((w) => w.id.startsWith('tips'));

describe('TIPS plan warnings', () => {
  it('has none without a ladder', () => {
    expect(tipsIds(planF_allTradCouple())).toEqual([]);
  });

  it('flags rungs bigger than their account as an error, in the M4-C wording', () => {
    const f = planF_allTradCouple();
    const plan = withTips({ ...f, portfolio: { ...f.portfolio, personB: { ...f.portfolio.personB!, roth: 40_000 } } },
      [rung({ maturityYear: Y + 5, adjustedPrincipal: 60_000, account: 'roth', whose: 'Household' })]);
    const w = tipsIds(plan).find((x) => x.id.startsWith('tips-overflow'))!;
    expect(w.severity).toBe('error');
    expect(w.message).toContain('TIPS rungs in Roth ($60,000) exceed the Roth balance ($40,000).');
  });

  it('names whose pre-tax account is over-subscribed', () => {
    const f = planF_allTradCouple();
    const plan = withTips(f, [rung({ maturityYear: Y + 5, adjustedPrincipal: f.portfolio.personB!.traditional + 1, account: 'traditional', whose: 'B' })]);
    const w = tipsIds(plan).find((x) => x.id.startsWith('tips-overflow'))!;
    expect(w.message).toContain(`${f.personB!.name}'s pre-tax account`);
  });

  it('does not flag an over-subscription when the balances exclude the ladder', () => {
    const plan = withTips(planF_allTradCouple(), [rung({ maturityYear: Y + 5, adjustedPrincipal: 1e9, account: 'roth', whose: 'Household' })], false);
    expect(tipsIds(plan).some((x) => x.id.startsWith('tips-overflow'))).toBe(false);
  });

  it('warns about a matured rung', () => {
    const plan = withTips(planF_allTradCouple(), [rung({ maturityYear: Y - 1, adjustedPrincipal: 1_000, account: 'traditional', whose: 'A' })]);
    const w = tipsIds(plan).find((x) => x.id.startsWith('tips-matured'))!;
    expect(w.severity).toBe('warn');
  });

  it('shows the phantom-income note only for live taxable rungs', () => {
    const f = { ...planF_allTradCouple() };
    const taxableCap = { ...f, portfolio: { ...f.portfolio, personA: { ...f.portfolio.personA, taxable: 500_000, taxableBasis: 400_000 } } };
    const w = tipsIds(withTips(taxableCap, ladderRungs({ firstYear: Y + 1, years: 3, principal: 50_000, account: 'taxable' }))).find((x) => x.id === 'tips-phantom-income')!;
    expect(w.severity).toBe('info');
    expect(w.message).toContain('$150,000');
    expect(w.message).toContain('IRA is often a better home');
    expect(tipsIds(withTips(planF_allTradCouple(), ladderRungs({ firstYear: Y + 1, years: 3, principal: 50_000, account: 'traditional' }))).some((x) => x.id === 'tips-phantom-income')).toBe(false);
  });
});

describe('TIPS projection warnings', () => {
  it('flags an RMD the IRA cannot pay because it is all in bonds', () => {
    const plan = withTips(tipsRmdPlan({ trad: 1_000_000 }), [rung({ maturityYear: Y + 8, adjustedPrincipal: 1_000_000, couponRate: 0.01, account: 'traditional', whose: 'A' })]);
    const w = computeTipsProjectionWarnings(runProjection(plan).rows).find((x) => x.id === 'tips-rmd-unmet')!;
    expect(w.severity).toBe('warn');
    expect(w.message).toMatch(/can't be paid in cash/);
  });

  it('flags a year the plan cannot fund spending while bonds are still held to maturity', () => {
    const l = planL_survivorARMD();
    const plan = withTips(l, [rung({ maturityYear: Y + 30, adjustedPrincipal: 150_000, couponRate: 0.015, account: 'traditional', whose: 'A' })]);
    const w = computeTipsProjectionWarnings(runProjection(plan).rows).find((x) => x.id === 'tips-stranded')!;
    expect(w.message).toMatch(/never sells bonds early/);
  });

  it('is silent for a ladder that causes neither problem', () => {
    const plan = withTips(planF_allTradCouple(), ladderRungs({ firstYear: Y + 12, years: 3, principal: 30_000, account: 'traditional', whose: 'A' }));
    expect(computeTipsProjectionWarnings(runProjection(plan).rows)).toEqual([]);
  });
});
