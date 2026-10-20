import { describe, expect, it } from 'vitest';
import { runProjection } from './projection';
import { buildTipsLadder, builderBlocker, builderFundingAvailable, MAX_BUILDER_RUNGS, yearAtAge } from './tipsBuilder';
import { rung, thisYear, tipsIdlePlan, tipsRetireePlan, withTips } from './__testutil__/tipsPlans';
import type { Plan, TipsRung } from '../schemas/plan';

/** TB-1: the builder's rungs, fed through runProjection, pay the target real income every year
 *  under the engine's year-end-index convention. */

const ids = (year: number) => `t-${year}`;

describe('buildTipsLadder: bootstrap', () => {
  it('matches the hand-computed 5-rung case ($10,000 a year, 2% real yield)', () => {
    // P5 = 10000/1.02 = 9803.92 -> 9804; P4 = (10000 - .02*9804)/1.02 = 9611.76 -> 9612;
    // P3 = (10000 - .02*19416)/1.02 = 9423.22 -> 9423; P2 = (10000 - .02*28839)/1.02 = 9238.45 -> 9238;
    // P1 = (10000 - .02*38077)/1.02 = 9057.31 -> 9057. Cost 47,134 (annuity factor 4.7135 x 10,000).
    const y0 = 2030;
    const r = buildTipsLadder({ incomeReal: 10_000, fromYear: y0, throughYear: y0 + 4, realYield: 0.02, funding: { account: 'roth' }, startYear: 2026 }, ids);
    expect(r.rungs.map((x) => x.adjustedPrincipal)).toEqual([9057, 9238, 9423, 9612, 9804]);
    expect(r.rungs.map((x) => x.maturityYear)).toEqual([2030, 2031, 2032, 2033, 2034]);
    expect(r.cost).toBe(47_134);
    for (const x of r.rungs) {
      expect(x).toMatchObject({ couponRate: 0.02, account: 'roth', whose: 'Household' });
      expect(x.faceValue).toBeUndefined();
    }
    for (const row of r.rows) expect(Math.abs(row.paysReal - 10_000)).toBeLessThan(1);
  });

  it('zero yield buys the income one-for-one; pre-tax rungs carry the owner', () => {
    const r = buildTipsLadder({ incomeReal: 30_000, fromYear: 2030, throughYear: 2032, realYield: 0, funding: { account: 'traditional', whose: 'B' }, startYear: 2026 }, ids);
    expect(r.cost).toBe(90_000);
    expect(r.rungs.every((x) => x.whose === 'B' && x.account === 'traditional')).toBe(true);
  });

  it('skips years before the plan starts, caps the length and returns nothing for empty input', () => {
    const r = buildTipsLadder({ incomeReal: 1000, fromYear: 2020, throughYear: 2028, realYield: 0.01, funding: { account: 'taxable' }, startYear: 2026 }, ids);
    expect(r.rungs[0].maturityYear).toBe(2026);
    expect(r.rungs).toHaveLength(3);
    const long = buildTipsLadder({ incomeReal: 1000, fromYear: 2026, throughYear: 2200, realYield: 0.01, funding: { account: 'taxable' }, startYear: 2026 }, ids);
    expect(long.rungs).toHaveLength(MAX_BUILDER_RUNGS);
    for (const bad of [{ incomeReal: 0 }, { throughYear: 2025 }, { realYield: -0.01 }]) {
      expect(buildTipsLadder({ incomeReal: 1000, fromYear: 2026, throughYear: 2030, realYield: 0.01, funding: { account: 'taxable' }, startYear: 2026, ...bad }, ids).rungs).toEqual([]);
    }
  });

  it('yearAtAge maps an age to the engine calendar year', () => {
    expect(yearAtAge(62, 55, 2026)).toBe(2033);
  });
});

describe('buildTipsLadder through runProjection', () => {
  const I = 40_000;
  const y = thisYear();
  const cases: Array<[string, TipsRung['account'], 'A' | undefined, keyof ReturnType<typeof runProjection>['rows'][number]]> = [
    ['Roth', 'roth', undefined, 'tipsToRoth'],
    ['pre-tax A', 'traditional', 'A', 'tipsToTrad'],
    ['taxable', 'taxable', undefined, 'tipsCash'],
  ];

  const project = (plan: Plan, cpi?: number[]) => runProjection(plan, cpi ? { inflationOverrides: cpi } : undefined).rows;

  it.each(cases)('%s ladder: cash each year = target x year-end index (plan inflation)', (_n, account, whose, field) => {
    const funding = account === 'traditional' ? { account, whose: whose! } : { account } as { account: 'taxable' | 'roth' };
    const built = buildTipsLadder({ incomeReal: I, fromYear: y, throughYear: y + 7, realYield: 0.019, funding, startYear: y });
    const plan = withTips(tipsIdlePlan({ taxable: 2e6, trad: 2e6, roth: 2e6 }), built.rungs);
    const rows = project(plan);
    const pi = plan.assumptions.inflation;
    for (let i = 0; i < 8; i++) {
      const idxE = rows[i].inflationFactor * (1 + pi);
      expect(Math.abs((rows[i][field] as number) / idxE - I)).toBeLessThan(1);
    }
    expect(rows[8][field]).toBe(0);
    // The carve-out takes exactly the cost from the funding account.
    expect(rows[0].begTips).toBeCloseTo(built.cost, 6);
  });

  it('holds along a varying CPI path, deflation years included', () => {
    const built = buildTipsLadder({ incomeReal: I, fromYear: y + 1, throughYear: y + 6, realYield: 0.012, funding: { account: 'roth' }, startYear: y });
    const cpi = [0.03, 0.08, -0.02, 0.01, 0.045, -0.005, 0.02, 0.02, 0.02];
    const rows = project(withTips(tipsIdlePlan({ roth: 1e6 }), built.rungs), cpi);
    // Before the first maturity the rungs already pay their coupons (extra to the target).
    expect(rows[0].tipsToRoth).toBeCloseTo(0.012 * built.cost * (1 + cpi[0]), 6);
    for (let i = 1; i <= 6; i++) {
      const idxE = rows[i].inflationFactor * (1 + cpi[i]);
      // Par = principal, so the deflation floor binds only if the cumulative index is below 1; it isn't here.
      expect(Math.abs(rows[i].tipsToRoth / idxE - I)).toBeLessThan(1);
    }
  });
});

describe('builder funding checks', () => {
  const y = thisYear();

  it('available = balance less live rungs already in that account (pooled taxable/Roth, per-person pre-tax)', () => {
    const p = tipsRetireePlan().portfolio; // taxable 400k, Roth 150k, trad A 500k / B 200k
    const withRungs = {
      ...p,
      tipsLadder: { rungs: [
        rung({ maturityYear: y + 2, adjustedPrincipal: 50_000, account: 'roth' }),
        rung({ maturityYear: y + 2, adjustedPrincipal: 70_000, account: 'traditional', whose: 'B' }),
        rung({ maturityYear: y - 1, adjustedPrincipal: 99_000, account: 'roth' }),
      ] },
    };
    expect(builderFundingAvailable(withRungs, { account: 'roth' }, y)).toBe(100_000);
    expect(builderFundingAvailable(withRungs, { account: 'taxable' }, y)).toBe(400_000);
    expect(builderFundingAvailable(withRungs, { account: 'traditional', whose: 'A' }, y)).toBe(500_000);
    expect(builderFundingAvailable(withRungs, { account: 'traditional', whose: 'B' }, y)).toBe(130_000);
  });

  it('blocks a cost above the account and any build onto an on-top ladder', () => {
    const p = tipsRetireePlan().portfolio;
    expect(builderBlocker(p, { account: 'roth' }, 150_000, y)).toBeNull();
    expect(builderBlocker(p, { account: 'roth' }, 150_001, y)).toMatch(/costs \$150,001 but the account has \$150,000/);
    const onTop = { ...p, tipsLadder: { rungs: [rung({ maturityYear: y + 3 })], balancesIncludeLadder: false } };
    expect(builderBlocker(onTop, { account: 'taxable' }, 1, y)).toMatch(/on top of your balances/);
  });
});
