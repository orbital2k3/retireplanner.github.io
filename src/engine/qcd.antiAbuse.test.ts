import { afterAll, describe, expect, it } from 'vitest';
import { runProjection } from './projection';
import type { Plan } from '../schemas/plan';
import * as golden from './__golden/plans';
import { assertProjectionInvariants } from './__invariants__/assertions';
import { pinDate, unpinDate } from './__regression__/snapshotUtil';

/** §408(d)(8)(A) anti-abuse rule (audit M11): deductible IRA contributions made for years from 70½ on reduce
 *  the excludable QCD dollar for dollar, the unused amount carrying forward. Dates pinned (2026-06-15):
 *  A (born 1952-03-01) is 74 and still working; B (born 1954-03-01) is 72, retired, past 70½, and gets a
 *  spousal IRA contribution while A works. A holds no IRA, so every QCD is B's. */

pinDate();
afterAll(unpinDate);

function spousalPlan(spousal: number, target: 'traditional' | 'roth' = 'traditional', giving = 30_000): Plan {
  const p = golden.planQ_qcdGiver();
  p.personA = { ...p.personA, retirementAge: 78 };
  // A holds no IRA, so the giving comes from B's IRA (the allocator otherwise fills A's limit first).
  p.portfolio.personA = { ...p.portfolio.personA, traditional: 0, taxable: 1_200_000 };
  p.portfolio.personB = { ...p.portfolio.personB!, spousalContribution: spousal, spousalTarget: target };
  p.expenseStreams = p.expenseStreams.map((e) => e.category === 'charitable' ? { ...e, annualAmount: giving, inflationPct: { mode: 'fixed', rate: 0 } } : e);
  return p;
}

describe('QCD anti-abuse rule (§408(d)(8)(A))', () => {
  const base = runProjection(spousalPlan(0));
  const trad = runProjection(spousalPlan(8_000));

  it('B\'s QCD is taxed up to the cumulative post-70½ spousal contributions', () => {
    const p = spousalPlan(8_000);
    assertProjectionInvariants(trad, p);
    let offsetLeft = 0;
    for (const r of trad.rows) {
      offsetLeft += r.spousalB; // zero once A retires at 78
      const expected = Math.min(r.qcdB, offsetLeft);
      expect(r.qcdTaxable, `age ${r.ageA}`).toBeCloseTo(expected, 6);
      offsetLeft -= expected;
    }
    expect(trad.rows.some((r) => r.qcdTaxable > 0)).toBe(true);
  });

  it('a taxed QCD is still a QCD: same gift and RMD, the taxed part added to ordinary income', () => {
    // Against the same contribution sent to Roth, so the IRA balances (and RMDs) match in the first year.
    const roth = runProjection(spousalPlan(8_000, 'roth')).rows[0], r1 = trad.rows[0];
    expect(r1.qcdTaxable).toBeGreaterThan(0);
    expect(r1.qcd).toBe(roth.qcd);
    expect(r1.rmd).toBe(roth.rmd);
    expect(r1.ordIncome - roth.ordIncome).toBeGreaterThanOrEqual(r1.qcdTaxable - 1e-6);
    expect(trad.lifetimeFedTax).toBeGreaterThan(base.lifetimeFedTax);
  });

  it('carries an unused offset forward when B makes no QCD that year', () => {
    // $5k of giving against an $8k contribution: every year's QCD is fully taxed and $3k carries forward,
    // so once A retires (no more contributions) the carried offset still taxes the next QCDs.
    const small = runProjection(spousalPlan(8_000, 'traditional', 5_000));
    for (const r of small.rows.filter((r) => r.ageA < 78)) expect(r.qcdTaxable).toBeCloseTo(r.qcdB, 6);
    const carried = small.rows.filter((r) => r.ageA < 78).reduce((s, r) => s + r.spousalB - r.qcdTaxable, 0);
    expect(carried).toBeGreaterThan(10_000);
    const after = small.rows.filter((r) => r.ageA >= 78);
    expect(after[0].qcdTaxable).toBeCloseTo(after[0].qcdB, 6);
    expect(after.reduce((s, r) => s + r.qcdTaxable, 0)).toBeCloseTo(carried, 4);
  });

  it('is a no-op for a Roth spousal contribution, for no contribution, and with QCD disabled', () => {
    for (const p of [spousalPlan(8_000, 'roth'), spousalPlan(0)]) {
      expect(runProjection(p).rows.every((r) => r.qcdTaxable === 0)).toBe(true);
    }
    expect(runProjection(spousalPlan(8_000), { disableQCD: true }).rows.every((r) => r.qcdTaxable === 0)).toBe(true);
  });

  it('a contribution made before 70½ does not count', () => {
    const p = spousalPlan(8_000);
    // B born July 1956: 70 in 2026, reaching 70½ only in 2027.
    p.personB = { ...p.personB!, dob: '1956-07-01' };
    const proj = runProjection(p);
    const r0 = proj.rows[0];
    expect(r0.spousalB).toBeGreaterThan(0);
    expect(r0.qcdB).toBe(0); // B isn't QCD-eligible in 2026 either
    // From 2027 B gives and the 2026 contribution is not in the offset: the 2027 tax is at most one year's contribution.
    const r1 = proj.rows[1];
    expect(r1.qcdTaxable).toBeLessThanOrEqual(r1.spousalB + 1e-6);
  });
});
