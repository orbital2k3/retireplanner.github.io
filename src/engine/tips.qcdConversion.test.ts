import { describe, expect, it } from 'vitest';
import { runProjection } from './projection';
import { rmdDivisor } from './rmd';
import { assertProjectionInvariants } from './__invariants__/assertions';
import { planQ_qcdGiver } from './__golden/plans';
import { ladderRungs, thisYear, tipsRetireePlan, tipsRmdPlan, withExpenses, withTips } from './__testutil__/tipsPlans';
import type { Plan } from '../schemas/plan';

/** Part 3 item 5: a pre-tax ladder with QCDs and Roth conversions. The rung value is illiquid: it counts in
 *  the RMD base (D11) but a QCD or a conversion can only use the IRA's cash, which includes this year's
 *  coupons and maturities arriving from the rungs (tipsToTrad) and never the bond itself. */
const Y = thisYear();

const charity = (p: Plan, amount: number): Plan => withExpenses(p, [
  ...p.expenseStreams,
  { ...p.expenseStreams[0], id: 'give', name: 'Giving', category: 'charitable', annualAmount: amount, inflationPct: { mode: 'cpi' } },
]);

describe('QCD with an IRA ladder', () => {
  // Single 74-year-old, 1M IRA of which 990k is in rungs maturing over the next 10 years; 50k/yr of giving.
  const plan = () => withTips(charity(tipsRmdPlan(), 50_000),
    ladderRungs({ firstYear: Y + 1, years: 10, principal: 99_000, couponRate: 0.01, account: 'traditional', whose: 'A' }));

  it('QCDs are paid only from IRA cash (liquid balance plus this year\'s coupons and maturities)', () => {
    const p = plan();
    const g = p.assumptions.tradReturn;
    const rows = runProjection(p).rows;
    expect(rows.some((r) => r.qcd > 0)).toBe(true);
    for (const r of rows) {
      expect(r.qcd).toBeLessThanOrEqual(r.begTraditional * (1 + g) + r.tipsToTrad + 1e-6);
      expect(r.qcd).toBeLessThanOrEqual(r.charitableSpend + 1e-6);
      expect(r.endTraditional).toBeGreaterThanOrEqual(-1e-6);
    }
    assertProjectionInvariants(runProjection(p), p, { skipSpendingCoverage: true });
  });

  it('the rung value is in the RMD base, so the RMD outruns the cash and the shortfall is recorded, not taken from the bonds', () => {
    const p = plan();
    const g = p.assumptions.tradReturn;
    const r0 = runProjection(p).rows[0];
    const age = r0.ageA;
    // The required amount is on the full base (cash + bonds); the row's rmd is the part the cash could pay.
    expect(r0.rmd + r0.rmdUnmet).toBeCloseTo((r0.begTraditional + r0.begTips) / rmdDivisor(age), 4);
    expect(r0.rmdUnmet).toBeGreaterThan(0);
    expect(r0.rmd).toBeCloseTo(r0.begTraditional * (1 + g) + r0.tipsToTrad, 4);
    // QCD fills the cash there is; the rest of the RMD is unmet.
    expect(r0.qcd).toBeCloseTo(r0.begTraditional * (1 + g) + r0.tipsToTrad, 4);
  });

  it('the ladder itself is identical with and without giving: a QCD never touches a rung', () => {
    const a = runProjection(plan()).rows;
    const b = runProjection(withTips(tipsRmdPlan(), plan().portfolio.tipsLadder!.rungs)).rows;
    for (let i = 0; i < a.length; i++) {
      expect([a[i].begTips, a[i].endTipsTrad, a[i].tipsToTrad]).toEqual([b[i].begTips, b[i].endTipsTrad, b[i].tipsToTrad]);
    }
  });
});

describe('Roth conversions with an IRA ladder', () => {
  // Retired couple, 53/51, A's IRA 500k with 400k in rungs; a manual schedule asks for far more than the IRA has.
  const base = () => withTips(tipsRetireePlan(),
    ladderRungs({ firstYear: Y + 2, years: 8, principal: 50_000, couponRate: 0.015, account: 'traditional', whose: 'A' }));
  const converting = (): Plan => {
    const p = base();
    const sched = Object.fromEntries(Array.from({ length: 12 }, (_, k) => [String(53 + k), 5_000_000]));
    return { ...p, conversion: { ...p.conversion, mode: 'manual', optimize: false, manualSchedule: sched } };
  };

  it('a conversion never exceeds the IRA cash and never converts a rung', () => {
    const conv = runProjection(converting()).rows;
    const g = base().assumptions.tradReturn;
    const off = runProjection(base()).rows;
    expect(conv[0].rothConv).toBeGreaterThan(0);
    for (let i = 0; i < conv.length; i++) {
      const r = conv[i];
      expect(r.rothConv).toBeLessThanOrEqual(r.begTraditional * (1 + g) + r.tipsToTrad + 1e-6);
      expect(r.endTraditional).toBeGreaterThanOrEqual(-1e-6);
      expect([r.begTips, r.endTipsTrad, r.tipsToTrad]).toEqual([off[i].begTips, off[i].endTipsTrad, off[i].tipsToTrad]);
    }
    assertProjectionInvariants(runProjection(converting()), converting(), { skipSpendingCoverage: true });
  });

  it('once the liquid IRA is converted, later conversions are just the cash the rungs pay in', () => {
    const rows = runProjection(converting()).rows;
    const later = rows.filter((r) => r.year >= 3 && r.year <= 10 && r.begTraditional < 1);
    expect(later.length).toBeGreaterThan(0);
    for (const r of later) expect(r.rothConv).toBeCloseTo(r.tipsToTrad, 4);
  });
});

describe('QCD giver plus conversions plus an IRA ladder (planQ)', () => {
  it('holds every invariant and pays QCDs and conversions only from cash', () => {
    const q = planQ_qcdGiver();
    const sched = Object.fromEntries(Array.from({ length: 10 }, (_, k) => [String(74 + k), 200_000]));
    const p: Plan = withTips({ ...q, conversion: { ...q.conversion, mode: 'manual', optimize: false, manualSchedule: sched } },
      ladderRungs({ firstYear: Y + 1, years: 8, principal: 100_000, couponRate: 0.02, account: 'traditional', whose: 'A' }));
    const proj = runProjection(p);
    assertProjectionInvariants(proj, p, { skipSpendingCoverage: true });
    expect(proj.rows.some((r) => r.qcd > 0 && r.rothConv > 0 && r.begTips > 0)).toBe(true);
  });
});
