import { describe, expect, it } from 'vitest';
import { runProjection } from './projection';
import { rmdDivisor } from './rmd';
import {
  planA_simple, planB_largeTradSingle, planF_allTradCouple, planG_californiaCouple,
  planH_survivorMidPlan, planQ_qcdGiver, planR_hsaEarlyRetiree,
} from './__golden/plans';
import { ladderRungs, rung, thisYear, tipsIdlePlan, tipsRetireePlan, tipsRmdPlan, withTips } from './__testutil__/tipsPlans';

const A = [
  ['A', planA_simple], ['B', planB_largeTradSingle], ['F', planF_allTradCouple], ['G', planG_californiaCouple],
  ['H', planH_survivorMidPlan], ['Q', planQ_qcdGiver], ['R', planR_hsaEarlyRetiree],
] as const;

/** T-3: TIPS in runProjection. Without a ladder (or with nothing live in it) the run must be
 *  bit-identical, and the ladder's cash, tax and balance effects follow the D10-D12 rules. */
describe('TIPS projection: neutrality', () => {
  it.each(A)('plan %s: absent, empty, matured-only and "excluded" empty ladders are all bit-identical', (_n, make) => {
    const base = JSON.stringify(runProjection(make()));
    const p = make();
    expect(JSON.stringify(runProjection(withTips(p, [])))).toBe(base);
    expect(JSON.stringify(runProjection(withTips(p, [], false)))).toBe(base);
    expect(JSON.stringify(runProjection(withTips(p, [rung({ maturityYear: thisYear() - 1, adjustedPrincipal: 1e9 })])))).toBe(base);
  });

  it('an absent ladder gives all-zero ladder fields on every row', () => {
    for (const r of runProjection(planA_simple()).rows) {
      expect([r.begTips, r.endTipsTaxable, r.endTipsTrad, r.endTipsRoth, r.tipsCoupon, r.tipsAccrual, r.tipsMaturity,
        r.tipsFloorBonus, r.tipsCash, r.tipsToTrad, r.tipsToRoth, r.tipsOrdInc, r.rmdUnmet]).toEqual(Array(13).fill(0));
    }
  });
});

describe('TIPS projection: carve-out and no double count (D10)', () => {
  const g = 0.065, pi = 0.025;

  it('year-0 endTotal = entered totals grown, with the sleeve growing at CPI + coupon instead of the return (Roth rung)', () => {
    const idle = tipsIdlePlan({ taxable: 100_000, trad: 100_000, roth: 100_000 });
    const none = runProjection(idle).rows[0];
    expect(none.endTotal).toBeCloseTo(300_000 * (1 + g), 4);
    const withLadder = runProjection(withTips(idle, [rung({ maturityYear: thisYear() + 5, adjustedPrincipal: 40_000, couponRate: 0.02, account: 'roth' })])).rows[0];
    // 60k stays liquid in Roth and grows at g; the 40k sleeve grows at CPI, and its coupon lands in Roth
    const expected = 200_000 * (1 + g) + 60_000 * (1 + g) + 40_000 * (1 + pi) + 0.02 * 40_000 * (1 + pi);
    expect(withLadder.endTotal).toBeCloseTo(expected, 4);
    expect(withLadder.begRoth).toBe(60_000);
    expect(withLadder.begTips).toBeCloseTo(40_000, 9);
    expect(withLadder.endRoth).toBeCloseTo(60_000 * (1 + g) + 0.02 * 40_000 * (1 + pi), 4);
    expect(withLadder.endTipsRoth).toBeCloseTo(41_000, 6);
  });

  it('carves taxable (with its basis, floored at zero) and each person\'s IRA', () => {
    const p = tipsRetireePlan();
    const rungs = [
      ...ladderRungs({ firstYear: thisYear() + 1, years: 2, principal: 60_000, account: 'taxable' }),
      rung({ maturityYear: thisYear() + 3, adjustedPrincipal: 100_000, account: 'traditional', whose: 'A' }),
      rung({ maturityYear: thisYear() + 3, adjustedPrincipal: 30_000, account: 'traditional', whose: 'B' }),
    ];
    const r = runProjection(withTips(p, rungs)).rows[0];
    const base = runProjection(p).rows[0];
    expect(r.begTaxable).toBeCloseTo(base.begTaxable - 120_000, 6);
    expect(r.begTraditional).toBeCloseTo(base.begTraditional - 130_000, 6);
    expect(r.begRoth).toBeCloseTo(base.begRoth, 6);
    expect(r.begTips).toBeCloseTo(250_000, 6);
  });

  it('the taxable carve-out comes off the basis dollar for dollar, floored at zero', () => {
    const withBasis = (basis: number): Plan => {
      const p = tipsIdlePlan({ taxable: 300_000 });
      return { ...p, portfolio: { ...p.portfolio, personA: { ...p.portfolio.personA, taxableBasis: basis } } };
    };
    // Zero coupon and a later maturity: no ladder cash reaches the taxable account (and its basis) in year 0.
    const rungs = ladderRungs({ firstYear: thisYear() + 2, years: 2, principal: 60_000, couponRate: 0, account: 'taxable' });
    for (const [basis, after] of [[250_000, 130_000], [50_000, 0]] as const) {
      const base = runProjection(withBasis(basis)).rows[0];
      const r = runProjection(withTips(withBasis(basis), rungs)).rows[0];
      expect(base.endTaxableBasis).toBeCloseTo(basis, 6);
      expect(r.endTaxableBasis).toBeCloseTo(after, 6);
    }
  });

  it('adds the ladder on top when the balances exclude it', () => {
    const p = tipsRetireePlan();
    const rungs = ladderRungs({ firstYear: thisYear() + 1, years: 2, principal: 60_000, account: 'taxable' });
    const r = runProjection(withTips(p, rungs, false)).rows[0];
    expect(r.begTaxable).toBeCloseTo(runProjection(p).rows[0].begTaxable, 6);
    expect(r.begTips).toBeCloseTo(120_000, 6);
  });

  it('an over-subscribed account creates no money: the sleeve is capped at the balance', () => {
    const idle = tipsIdlePlan({ roth: 50_000 });
    const r = runProjection(withTips(idle, [rung({ maturityYear: thisYear() + 3, adjustedPrincipal: 1_000_000, account: 'roth' })])).rows[0];
    expect(r.begRoth).toBe(0);
    expect(r.begTips).toBeCloseTo(50_000, 6);
  });
});

describe('TIPS projection: taxable rung (phantom income, D12)', () => {
  const pi = 0.025;
  const idle = () => tipsIdlePlan({ taxable: 200_000 });
  const mature = thisYear() + 3;
  const plan = () => withTips(idle(), [rung({ maturityYear: mature, adjustedPrincipal: 50_000, couponRate: 0.01 })]);

  it('taxes coupon + indexation as ordinary income but pays only the coupon in cash', () => {
    const r = runProjection(plan()).rows[0];
    const principalEnd = 50_000 * (1 + pi);
    expect(r.tipsCoupon).toBeCloseTo(0.01 * principalEnd, 6);
    expect(r.tipsAccrual).toBeCloseTo(50_000 * pi, 6);
    expect(r.tipsCash).toBeCloseTo(r.tipsCoupon, 9);
    expect(r.tipsOrdInc).toBeCloseTo(r.tipsCoupon + r.tipsAccrual, 9);
    expect(r.ordIncome).toBeCloseTo(r.tipsOrdInc, 6);            // nothing else is taxable in this plan
    expect(r.endTipsTaxable).toBeCloseTo(principalEnd, 6);
    expect(r.cashSurplus).toBeCloseTo(r.tipsCash - r.fedTax - r.stateTaxAmt - r.niit, 4);
  });

  it('pays principal at maturity as cash, then the sleeve is gone', () => {
    const rows = runProjection(plan()).rows;
    const m = rows[3];
    const idx4 = Math.pow(1 + pi, 4);
    expect(m.tipsMaturity).toBeCloseTo(50_000 * idx4, 4);
    expect(m.tipsCash).toBeCloseTo(0.01 * 50_000 * idx4 + 50_000 * idx4, 4);
    expect(m.endTipsTaxable).toBe(0);
    expect(rows[4].begTips).toBe(0);
    expect(rows[4].tipsCash).toBe(0);
    expect(rows[4].tipsOrdInc).toBe(0);
    // the sleeve follows CPI only: value at the start of year k is principal x (1+pi)^k
    for (let k = 0; k <= 3; k++) expect(rows[k].begTips).toBeCloseTo(50_000 * Math.pow(1 + pi, k), 6);
  });

  it('counts in endTotal but not in endTaxable', () => {
    const r = runProjection(plan()).rows[1];
    expect(r.endTotal).toBeCloseTo(r.endTaxable + r.endTraditional + r.endRoth + r.endHSA + r.endTipsTaxable, 6);
  });
});

describe('TIPS projection: pre-tax rung (D11)', () => {
  const mature = thisYear() + 10;
  const age = thisYear() - 1952;

  it('puts the rung in the RMD base and returns coupons to the IRA', () => {
    const base = tipsRmdPlan({ trad: 1_000_000 });
    const half = withTips(base, [rung({ maturityYear: mature, adjustedPrincipal: 500_000, couponRate: 0.01, account: 'traditional', whose: 'A' })]);
    const r = runProjection(half).rows[0];
    expect(r.begTraditional).toBeCloseTo(500_000, 6);
    expect(r.rmd).toBeCloseTo(1_000_000 / rmdDivisor(age), 6);       // base = liquid 500k + rung 500k
    expect(r.rmdUnmet).toBe(0);
    expect(r.tipsToTrad).toBeCloseTo(0.01 * 500_000 * 1.025, 6);
    expect(r.endTipsTrad).toBeCloseTo(500_000 * 1.025, 6);
    expect(r.tipsOrdInc).toBe(0);                                    // no tax while it sits in the IRA
    // the same IRA without a ladder has a much smaller RMD
    expect(runProjection(tipsRmdPlan({ trad: 500_000 })).rows[0].rmd).toBeCloseTo(500_000 / rmdDivisor(age), 6);
  });

  it('clamps the RMD to the liquid IRA balance and records the rest as unmet', () => {
    const all = withTips(tipsRmdPlan({ trad: 1_000_000 }), [rung({ maturityYear: mature, adjustedPrincipal: 1_000_000, couponRate: 0.01, account: 'traditional', whose: 'A' })]);
    const r = runProjection(all).rows[0];
    const coupon = 0.01 * 1_000_000 * 1.025;
    const wanted = 1_000_000 / rmdDivisor(age);
    expect(r.begTraditional).toBe(0);
    expect(r.rmd).toBeCloseTo(coupon, 6);
    expect(r.rmdUnmet).toBeCloseTo(wanted - coupon, 6);
    expect(r.endTraditional).toBeCloseTo(0, 6);
    expect(r.endTipsTrad).toBeCloseTo(1_025_000, 6);
  });
});

describe('TIPS projection: roth rung', () => {
  it('returns coupons and maturities to the Roth tax-free', () => {
    const idle = tipsIdlePlan({ roth: 100_000 });
    const rows = runProjection(withTips(idle, [rung({ maturityYear: thisYear() + 1, adjustedPrincipal: 40_000, couponRate: 0.02, account: 'roth' })])).rows;
    expect(rows[0].tipsOrdInc).toBe(0);
    expect(rows[0].fedTax).toBe(0);
    expect(rows[1].tipsMaturity).toBeCloseTo(40_000 * 1.025 * 1.025, 6);
    expect(rows[1].tipsToRoth).toBeCloseTo(40_000 * 1.025 * 1.025 * 1.02, 6);
    expect(rows[1].endTipsRoth).toBe(0);
  });
});

describe('TIPS projection: working years', () => {
  it('ladder income is not taxed (and brings no withdrawals) until someone has retired, like dividends', () => {
    // planA: A works to 65, B to 63. A taxable rung from year 0; the coupon cash is saved.
    const plan = withTips(planA_simple(), [rung({ maturityYear: thisYear() + 20, adjustedPrincipal: 200_000, couponRate: 0.02 })]);
    const rows = runProjection(plan).rows;
    const working = rows.filter((r) => r.phase === 'Accum.');
    expect(working.length).toBeGreaterThan(5);
    for (const r of working) {
      expect(r.tipsOrdInc).toBe(0);
      expect(r.fedTax).toBe(0);
      expect(r.totalWD).toBe(0);
      expect(r.tipsCash).toBeGreaterThan(0);               // the coupon still arrives, and is saved
    }
    const retired = rows.find((r) => r.phase !== 'Accum.')!;
    expect(retired.tipsOrdInc).toBeGreaterThan(0);          // taxed from the first year someone retires
  });
});
