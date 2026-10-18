import { describe, expect, it } from 'vitest';
import { samplePlan, type Portfolio, type TipsRung } from '../schemas/plan';
import { carveOut, effectiveOwner, resolveTipsLadder, rungYear, taxableRungIncome, tipsLadderYear } from './tipsLadder';

const rung = (over: Partial<TipsRung> = {}): TipsRung => ({
  id: 'r', maturityYear: 2031, adjustedPrincipal: 10_000, couponRate: 0.01, account: 'taxable', whose: 'Household', ...over,
});

describe('rungYear', () => {
  it('indexes principal, pays the coupon on year-end principal, no cash accrual (hand-computed)', () => {
    const y = rungYear(rung(), 1, 1.02, false);
    expect(y.begVal).toBeCloseTo(10_000, 9);
    expect(y.coupon).toBeCloseTo(102, 9);      // 1% of 10,200
    expect(y.accrual).toBeCloseTo(200, 9);     // 10,000 -> 10,200
    expect(y.payout).toBe(0);
    expect(y.floorBonus).toBe(0);
    expect(y.endVal).toBeCloseTo(10_200, 9);
  });

  it('pays indexed principal at maturity and removes the rung', () => {
    const y = rungYear(rung(), 1.02, 1.0404, true);
    expect(y.payout).toBeCloseTo(10_404, 9);
    expect(y.endVal).toBe(0);
    expect(y.floorBonus).toBe(0);
    // sleeve mass balance: beg + accrual + floor = end + payout
    expect(y.begVal + y.accrual + y.floorBonus).toBeCloseTo(y.endVal + y.payout, 9);
  });

  it('applies the deflation floor at maturity only (face defaults to adjusted principal)', () => {
    const mid = rungYear(rung(), 1, 0.95, false);
    expect(mid.accrual).toBeCloseTo(-500, 9);
    expect(mid.floorBonus).toBe(0);
    expect(mid.endVal).toBeCloseTo(9_500, 9);
    const mat = rungYear(rung(), 1, 0.95, true);
    expect(mat.payout).toBeCloseTo(10_000, 9);
    expect(mat.floorBonus).toBeCloseTo(500, 9);
    expect(mat.begVal + mat.accrual + mat.floorBonus).toBeCloseTo(mat.payout, 9);
  });

  it('uses a lower par as the floor when faceValue is given', () => {
    const mat = rungYear(rung({ faceValue: 8_000 }), 1, 0.95, true);
    expect(mat.payout).toBeCloseTo(9_500, 9);   // indexed principal is above par: no bonus
    expect(mat.floorBonus).toBe(0);
    const high = rungYear(rung({ faceValue: 12_000 }), 1, 1.02, true);
    expect(high.payout).toBeCloseTo(12_000, 9);
    expect(high.floorBonus).toBeCloseTo(1_800, 9);
  });

  it('is independent of anything but the index (returns never enter)', () => {
    expect(rungYear(rung(), 1.1, 1.13, false)).toEqual(rungYear(rung(), 1.1, 1.13, false));
  });
});

describe('taxableRungIncome', () => {
  it('is coupon plus indexation', () => {
    expect(taxableRungIncome({ coupon: 102, accrual: 200, floorBonus: 0 })).toBeCloseTo(302, 9);
  });
  it('lets a deflation adjustment offset the coupon but nothing else', () => {
    expect(taxableRungIncome({ coupon: 100, accrual: -60, floorBonus: 0 })).toBe(40);
    expect(taxableRungIncome({ coupon: 100, accrual: -500, floorBonus: 0 })).toBe(0);
  });
  it('taxes the deflation-floor bonus at maturity', () => {
    expect(taxableRungIncome({ coupon: 100, accrual: -500, floorBonus: 500 })).toBe(500);
  });
});

describe('effectiveOwner', () => {
  it.each([
    ['A', true, true, 'A'], ['A', false, true, 'B'], ['A', true, false, 'A'],
    ['B', true, true, 'B'], ['B', true, false, 'A'], ['B', false, true, 'B'],
    ['Household', true, true, 'A'], ['Household', false, true, 'B'],
  ] as const)('whose %s, aliveA %s, aliveB %s -> %s', (whose, aliveA, aliveB, want) => {
    expect(effectiveOwner(whose, aliveA, aliveB)).toBe(want);
  });
});

describe('carveOut', () => {
  it('subtracts directly when the rungs fit', () => {
    expect(carveOut(100, 40)).toEqual({ carved: 40, remaining: 60, scale: 1 });
  });
  it('caps at the balance and reports the share that fits', () => {
    const c = carveOut(100, 150);
    expect(c.carved).toBe(100);
    expect(c.remaining).toBe(0);
    expect(c.scale).toBeCloseTo(2 / 3, 12);
  });
  it('has no 0/0 for an empty total or an empty balance', () => {
    expect(carveOut(100, 0)).toEqual({ carved: 0, remaining: 100, scale: 1 });
    expect(carveOut(0, 50)).toEqual({ carved: 0, remaining: 0, scale: 0 });
    expect(Number.isNaN(carveOut(0, 0).scale)).toBe(false);
  });
});

describe('resolveTipsLadder', () => {
  const pf = (): Portfolio => samplePlan().portfolio;
  const withRungs = (rungs: TipsRung[], include?: boolean): Portfolio => ({
    ...pf(), tipsLadder: { rungs, ...(include === undefined ? {} : { balancesIncludeLadder: include }) },
  });

  it('returns null with no ladder, no rungs, or only matured rungs', () => {
    expect(resolveTipsLadder(pf(), 2026)).toBeNull();
    expect(resolveTipsLadder(withRungs([]), 2026)).toBeNull();
    expect(resolveTipsLadder(withRungs([rung({ maturityYear: 2025 })]), 2026)).toBeNull();
  });

  it('carves each account directly and splits pre-tax by owner', () => {
    const r = resolveTipsLadder(withRungs([
      rung({ id: 't', account: 'taxable', adjustedPrincipal: 30_000 }),
      rung({ id: 'a', account: 'traditional', whose: 'A', adjustedPrincipal: 20_000 }),
      rung({ id: 'b', account: 'traditional', whose: 'B', adjustedPrincipal: 5_000 }),
      rung({ id: 'r', account: 'roth', adjustedPrincipal: 7_000 }),
    ]), 2026)!;
    expect(r.carve).toEqual({ taxable: 30_000, roth: 7_000, tradA: 20_000, tradB: 5_000 });
    expect(r.rungs.map((x) => x.adjustedPrincipal)).toEqual([30_000, 20_000, 5_000, 7_000]);
  });

  it('adds the ladder on top (no carve) when the balances exclude it', () => {
    const r = resolveTipsLadder(withRungs([rung({ adjustedPrincipal: 1e9 })], false), 2026)!;
    expect(r.carve).toEqual({ taxable: 0, roth: 0, tradA: 0, tradB: 0 });
    expect(r.rungs[0].adjustedPrincipal).toBe(1e9);
  });

  it('scales an over-subscribed account down to its balance so no money is created', () => {
    const bal = pf().personA.taxable + (pf().personB?.taxable ?? 0);
    const r = resolveTipsLadder(withRungs([
      rung({ id: 'x', adjustedPrincipal: bal }), rung({ id: 'y', adjustedPrincipal: bal, faceValue: bal }),
    ]), 2026)!;
    expect(r.carve.taxable).toBeCloseTo(bal, 6);
    expect(r.rungs.reduce((s, x) => s + x.adjustedPrincipal, 0)).toBeCloseTo(bal, 6);
    expect(r.rungs[1].faceValue).toBeCloseTo(bal / 2, 6);
  });

  it('drops a pre-tax rung whose owner has no IRA', () => {
    const noB: Portfolio = { ...pf(), personB: undefined, tipsLadder: { rungs: [rung({ account: 'traditional', whose: 'B' })] } };
    expect(resolveTipsLadder(noB, 2026)).toBeNull();
  });
});

describe('tipsLadderYear', () => {
  const ladder = resolveTipsLadder({
    ...samplePlan().portfolio,
    tipsLadder: { balancesIncludeLadder: false, rungs: [
      rung({ id: 't', account: 'taxable', maturityYear: 2027, adjustedPrincipal: 10_000, couponRate: 0.01 }),
      rung({ id: 'a', account: 'traditional', whose: 'A', maturityYear: 2026, adjustedPrincipal: 20_000, couponRate: 0.02 }),
      rung({ id: 'r', account: 'roth', maturityYear: 2028, adjustedPrincipal: 5_000, couponRate: 0 }),
    ] },
  }, 2026)!;

  it('aggregates by account and keeps cash and sleeve identities (hand-computed, 2% CPI, plan year 0)', () => {
    const y = tipsLadderYear(ladder, 2026, 1, 1.02, true, true);
    expect(y.beg).toBeCloseTo(35_000, 9);
    expect(y.begTradA).toBeCloseTo(20_000, 9);
    expect(y.begTradB).toBe(0);
    expect(y.coupon).toBeCloseTo(0.01 * 10_200 + 0.02 * 20_400, 9);          // 102 + 408
    expect(y.accrual).toBeCloseTo(35_000 * 0.02, 9);
    expect(y.maturity).toBeCloseTo(20_400, 9);                              // the 2026 pre-tax rung
    expect(y.cash).toBeCloseTo(102, 9);                                     // taxable coupon only
    expect(y.toTradA).toBeCloseTo(408 + 20_400, 9);
    expect(y.toRoth).toBe(0);
    expect(y.ordInc).toBeCloseTo(102 + 200, 9);                             // coupon + phantom accrual, taxable rung only
    expect(y.endTaxable).toBeCloseTo(10_200, 9);
    expect(y.endTrad).toBe(0);
    expect(y.endRoth).toBeCloseTo(5_100, 9);
    // sleeve mass balance and cash identity
    expect(y.beg + y.accrual + y.floorBonus).toBeCloseTo(y.endTaxable + y.endTrad + y.endRoth + y.maturity, 9);
    expect(y.cash + y.toTradA + y.toTradB + y.toRoth).toBeCloseTo(y.coupon + y.maturity, 9);
  });

  it('skips matured rungs in later years', () => {
    const y = tipsLadderYear(ladder, 2028, 1.0404, 1.0612, true, true);
    expect(y.cash).toBe(0);
    expect(y.toTradA).toBe(0);
    expect(y.beg).toBeCloseTo(5_000 * 1.0404, 9);
    expect(y.maturity).toBeCloseTo(5_000 * 1.0612, 9);
    expect(y.toRoth).toBeCloseTo(5_000 * 1.0612, 9);
  });

  it('moves a pre-tax rung to the survivor when its owner has died', () => {
    const y = tipsLadderYear(ladder, 2026, 1, 1.02, false, true);
    expect(y.begTradA).toBe(0);
    expect(y.begTradB).toBeCloseTo(20_000, 9);
    expect(y.toTradB).toBeCloseTo(20_808, 9);
    expect(y.toTradA).toBe(0);
  });

  it('is unaffected by anything but CPI: the same index gives the same flows', () => {
    expect(tipsLadderYear(ladder, 2027, 1.0404, 1.0612, true, true))
      .toEqual(tipsLadderYear(ladder, 2027, 1.0404, 1.0612, true, true));
  });

  it('offsets coupons with a deflation adjustment but never goes below zero', () => {
    const y = tipsLadderYear(ladder, 2026, 1, 0.9, true, true);
    expect(y.ordInc).toBe(0);                   // taxable rung: coupon 90, accrual -1,000
    expect(y.accrual).toBeCloseTo(-0.1 * 35_000, 9);
    // in its maturity year the same deflation pays the floor, which is taxed as interest
    const m = tipsLadderYear(ladder, 2027, 1, 0.9, true, true);
    expect(m.floorBonus).toBeCloseTo(1_000, 9);
    expect(m.ordInc).toBeCloseTo(1_000, 9);
  });
});
