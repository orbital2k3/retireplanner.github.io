import { describe, it, expect } from 'vitest';
import { runProjection } from './projection';
import { remainingYearFraction } from './yearFraction';
import { samplePlan } from '../schemas/plan';
import type { Plan } from '../schemas/plan';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** A couple still working, no returns variation, so year 1 is easy to check by hand. */
function workingPlan(): Plan {
  const p = clone(samplePlan());
  p.personA.retirementAge = 70; p.personA.dob = '1985-03-01';
  if (p.personB) { p.personB.retirementAge = 70; p.personB.dob = '1985-03-01'; }
  p.assumptions.taxableReturn = p.assumptions.tradReturn = p.assumptions.rothReturn = 0.08;
  p.portfolio.personA = { ...p.portfolio.personA, taxable: 100_000, taxableBasis: 100_000, traditional: 100_000, roth: 100_000,
    annualContribution: 60_000, contribSplit: { taxable: 0, traditional: 1, roth: 0 }, year1Contribution: undefined };
  p.portfolio.personB = undefined; p.personB = undefined;
  p.incomeStreams = []; p.expenseStreams = [];
  return p;
}

describe('remainingYearFraction', () => {
  it('counts today and handles the ends of the year', () => {
    expect(remainingYearFraction(new Date(2026, 0, 1, 12))).toBe(1);
    expect(remainingYearFraction(new Date(2026, 11, 31, 12))).toBeCloseTo(1 / 365, 12);
    expect(remainingYearFraction(new Date(2026, 9, 26, 12))).toBeCloseTo(67 / 365, 12); // Oct 26 → 67 days incl. today
    expect(remainingYearFraction(new Date(2028, 2, 1, 12))).toBeCloseTo(306 / 366, 12); // leap year
  });
});

describe('year 1 proration', () => {
  const asOf = new Date(2026, 6, 2, 12); // Jul 2 → 183 of 365 days left
  const f = remainingYearFraction(asOf);

  it('earns only the rest of the year\'s return on today\'s balances', () => {
    const full = runProjection(workingPlan(), { asOf: new Date(2026, 0, 1, 12) });
    const part = runProjection(workingPlan(), { asOf });
    const g = Math.pow(1.08, f) - 1;
    expect(full.rows[0].endRoth).toBeCloseTo(100_000 * 1.08, 4);
    expect(part.rows[0].endRoth).toBeCloseTo(100_000 * (1 + g), 4);
    expect(part.rows[0].endRoth).toBeLessThan(full.rows[0].endRoth);
  });

  it('later years are unchanged in rate: year 2 grows by the full return', () => {
    const part = runProjection(workingPlan(), { asOf });
    const y1 = part.rows[0], y2 = part.rows[1];
    // Roth has no contributions or withdrawals here.
    expect(y2.endRoth / y1.endRoth).toBeCloseTo(1.08, 10);
  });

  it('defaults year-1 contribution to the annual amount prorated, and honours an explicit amount', () => {
    const dflt = runProjection(workingPlan(), { asOf });
    expect(dflt.rows[0].contribA).toBeCloseTo(60_000 * f, 6);

    const p = workingPlan(); p.portfolio.personA.year1Contribution = 12_345;
    const set = runProjection(p, { asOf });
    expect(set.rows[0].contribA).toBe(12_345);
    // Year 2 goes back to the full annual contribution, grown by contribGrowth (CPI here).
    expect(set.rows[1].contribA).toBeGreaterThan(60_000);
  });

  it('year 1 can carry its own mix across accounts; year 2 goes back to the annual mix', () => {
    const p = workingPlan();
    p.portfolio.personA.year1Contribution = 10_000;
    p.portfolio.personA.year1Split = { taxable: 0.5, traditional: 0.25, roth: 0.25 };
    const plain = runProjection(workingPlan(), { asOf: new Date(2026, 0, 1, 12) });
    const r = runProjection(p, { asOf: new Date(2026, 0, 1, 12) });
    // Plain plan: 100% pre-tax, so Roth only grows. With the year-1 mix, Roth also gets 25% of $10,000.
    expect(r.rows[0].endRoth - plain.rows[0].endRoth).toBeCloseTo(2_500, 4);
    expect(r.rows[0].endTaxable - plain.rows[0].endTaxable).toBeCloseTo(5_000, 4);
    expect(r.rows[0].contribA).toBe(10_000);
    // Year 2 ignores year1Split: all $60k+ of the annual contribution goes pre-tax again.
    expect(r.rows[1].contribA).toBeCloseTo(plain.rows[1].contribA, 6);
    const dRoth2 = (r.rows[1].endRoth / r.rows[0].endRoth) - (plain.rows[1].endRoth / plain.rows[0].endRoth);
    expect(Math.abs(dRoth2)).toBeLessThan(1e-9);
  });

  it('a full year 1 (Jan 1) is exactly the old behaviour', () => {
    const r = runProjection(workingPlan(), { asOf: new Date(2026, 0, 1, 12) });
    expect(r.rows[0].contribA).toBe(60_000);
    expect(r.rows[0].endTraditional).toBeCloseTo(100_000 * 1.08 + 60_000, 4);
  });
});
