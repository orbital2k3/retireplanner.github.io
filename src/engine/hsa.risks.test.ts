import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runProjection, type ProjectionRow } from './projection';
import { assertProjectionInvariants } from './__invariants__/assertions';
import { pinDate, unpinDate } from './__regression__/snapshotUtil';
import { hsaOnlyPlan, medicalPlan, medicalRow, withExpenses, withHsa } from './__testutil__/hsaPlans';
import * as golden from './__golden/plans';
import type { Plan } from '../schemas/plan';

beforeAll(pinDate);
afterAll(unpinDate);

/** H-9. R7: the HSA paying IRMAA must not break gross-up convergence. R9: last-resort draw order and
 *  the under-65 penalty. Plus: receipts make part of the ending HSA Roth-like in endTaxAdjusted. */

/** Couple 66/64 on a big pension (IRMAA range) that spends more than it earns, so every year draws from
 *  taxable and the cash residual measures convergence directly (no RMD surplus to blur it). */
function irmaaPlan(): Plan {
  const p = golden.planA_simple();
  return withExpenses(withHsa({
    ...p,
    personA: { ...p.personA, dob: '1960-03-01', retirementAge: 62, planThroughAge: 95, ssPIA: 20_000, ssClaimAge: 70 },
    personB: { ...p.personB!, dob: '1962-03-01', retirementAge: 62, planThroughAge: 95, ssPIA: 10_000, ssClaimAge: 70 },
    portfolio: {
      personA: { ...p.portfolio.personA, taxable: 4_000_000, taxableBasis: 2_000_000, traditional: 0, roth: 0, annualContribution: 0 },
      personB: { ...p.portfolio.personB!, taxable: 0, taxableBasis: 0, traditional: 0, roth: 0, annualContribution: 0 },
    },
    incomeStreams: [
      { id: 'pen', description: 'Pension', whose: 'A', type: 'Pension', startAge: 62, end: { mode: 'life' }, survivorPct: 0,
        annualAmount: 240_000, growthPct: { mode: 'cpi' }, taxablePct: 1, stateTaxablePct: 1 },
    ],
    withdrawalStrategy: 'taxfirst',
  }, { a: { hsa: 800_000 }, policyAge: 0 }), [
    { id: 'core', description: 'Core', whose: 'Household', startAge: 62, end: { mode: 'life' }, survivorPct: 1, annualAmount: 270_000, inflationPct: { mode: 'cpi' } },
    medicalRow({ id: 'med', startAge: 62, annualAmount: 25_000, inflationPct: { mode: 'cpi' } }),
  ]);
}

describe('R7: HSA paying IRMAA converges as well as the baseline', () => {
  const hsaPlan = irmaaPlan();
  // Baseline: same plan, HSA present but never paying (policy age 120).
  const baseline = withHsa(hsaPlan, { policyAge: 120 });
  const statsOn = { grossUpIters: [] as number[] };
  const statsOff = { grossUpIters: [] as number[] };
  const on = runProjection(hsaPlan, { stats: statsOn });
  const off = runProjection(baseline, { stats: statsOff });

  it('leaves under $1 of cash residual in every year', () => {
    // Years that draw from the portfolio: any residual there is solver drift. (Very late survivor years
    // have more income than spending and sweep a genuine surplus, so they are excluded.)
    const drawYears = on.rows.filter((r) => r.totalWD > 0);
    expect(drawYears.length).toBeGreaterThan(20);
    for (const r of drawYears) {
      expect(r.cashSurplus).toBeLessThan(1);
      expect(r.shortfall).toBeLessThan(1);
    }
  });

  it('uses at most two more gross-up iterations than the baseline in any year', () => {
    expect(statsOn.grossUpIters.length).toBe(on.rows.length);
    for (let i = 0; i < on.rows.length; i++) {
      expect(statsOn.grossUpIters[i]).toBeLessThanOrEqual(statsOff.grossUpIters[i] + 2);
    }
  });

  it('really exercises the case: IRMAA is paid from the HSA in several years', () => {
    expect(on.rows.filter((r) => r.irmaa > 0 && r.hsaQualifiedWD > r.medicalSpend + 1).length).toBeGreaterThanOrEqual(3);
    expect(off.rows.some((r) => r.irmaa > 0)).toBe(true);
    // the surcharge is covered: with the HSA paying it, the portfolio draw is smaller than without
    const k = on.rows.findIndex((r) => r.irmaa > 0);
    expect(on.rows[k].totalWD).toBeLessThan(off.rows[k].totalWD);
  });

  it('passes the invariants', () => assertProjectionInvariants(on, hsaPlan));
});

/** One person, `age` now, living on a taxable account that runs out, with an HSA behind it. */
function depletionPlan(age: number): Plan {
  const p = hsaOnlyPlan(15_000, 8_000);
  const born = `${2026 - age}-01-01`;
  return withExpenses({
    ...p,
    personA: { ...p.personA, dob: born, retirementAge: age, ssClaimAge: 70, planThroughAge: 95 },
    personB: undefined,
    portfolio: { personA: { ...p.portfolio.personA, taxable: 120_000, taxableBasis: 120_000, hsa: 260_000, hsaReceipts: 15_000 } },
  }, [
    { ...p.expenseStreams[0], whose: 'A', startAge: age, annualAmount: 45_000 },
    medicalRow({ id: 'med', whose: 'A', startAge: age, annualAmount: 8_000, inflationPct: { mode: 'fixed', rate: 0.025 } }),
  ]);
}

const firstRanOutAge = (rows: ProjectionRow[]) => rows.find((r) => r.ranOut)?.ageA ?? Infinity;

describe.each([60, 66])('R9: depletion at age %i', (age) => {
  // policy age 120 so the HSA is used only as the last resort, exactly what is under test
  const plan = withHsa(depletionPlan(age), { policyAge: 120 });
  const rows = runProjection(plan).rows;
  const noHsa = runProjection(withHsa({ ...plan, portfolio: { personA: { ...plan.portfolio.personA, hsa: 0, hsaContribution: 0, hsaReceipts: 0 } } }, {})).rows;
  const firstDraw = rows.findIndex((r) => r.hsaQualifiedWD + r.hsaReimbursed + r.hsaNonQualWD > 0);

  it('uses the HSA only after every other account is empty', () => {
    expect(firstDraw).toBeGreaterThan(0);
    for (let i = 0; i < firstDraw; i++) expect(rows[i].endTaxable).toBeGreaterThan(1);
    const r = rows[firstDraw];
    expect(r.endTaxable + r.endTraditional + r.endRoth).toBeLessThan(1);
  });

  it('draws in order: unpaid medical, then receipts, then non-qualified money', () => {
    for (let i = firstDraw; i < rows.length; i++) {
      const r = rows[i];
      if (r.hsaNonQualWD > 1) {
        const onFile = i === 0 ? 15_000 : rows[i - 1].hsaReceiptsBal;
        expect(r.hsaReimbursed).toBeCloseTo(onFile, 3);                      // receipts were used up first
        expect(r.hsaQualifiedWD).toBeGreaterThanOrEqual(r.medicalSpend + r.irmaa - 1);   // medical was paid first
      }
      if (r.hsaReimbursed > 1) expect(r.hsaQualifiedWD).toBeGreaterThanOrEqual(r.medicalSpend + r.irmaa - 1);
    }
    // all three kinds of draw show up over the run, and the first draw year starts with the medical bill
    expect(rows[firstDraw].hsaQualifiedWD).toBeGreaterThan(0);
    expect(rows.some((r) => r.hsaReimbursed > 0)).toBe(true);
    expect(rows.some((r) => r.hsaNonQualWD > 0)).toBe(true);
  });

  it('charges the 20% penalty only on non-qualified draws while the owner is under 65', () => {
    for (const r of rows) {
      if (r.ageA < 65) expect(r.hsaPenalty).toBeCloseTo(0.2 * r.hsaNonQualWD, 6);
      else expect(r.hsaPenalty).toBe(0);
    }
    expect(rows.some((r) => r.hsaNonQualWD > 0 && r.ageA >= 65)).toBe(true);
    if (age < 65) expect(rows.some((r) => r.hsaPenalty > 0)).toBe(true);
    else expect(rows.every((r) => r.hsaPenalty === 0)).toBe(true);
  });

  it('delays the first unfunded year compared with no HSA', () => {
    expect(firstRanOutAge(noHsa)).toBeLessThan(Infinity);
    expect(firstRanOutAge(rows)).toBeGreaterThan(firstRanOutAge(noHsa));
  });

  it('passes the invariants', () => assertProjectionInvariants({ ...runProjection(plan) }, plan, { skipSpendingCoverage: true }));
});

describe('receipts make the covered slice Roth-like in the ending value', () => {
  it('endTaxAdjusted rises by exactly ordRate x min(HSA, receipts) when receipts are added', () => {
    const mk = (receipts: number): Plan => withHsa(golden.planA_simple(), { a: { hsa: 100_000, hsaReceipts: receipts }, policyAge: 120 });
    const a = runProjection(mk(0)).rows;
    const b = runProjection(mk(40_000)).rows;
    const rate = mk(0).assumptions.taxAdjOrdRate;
    const i = a.length - 1;
    expect(a[i].endHSA).toBeGreaterThan(40_000);
    expect(b[i].endTaxAdjusted - a[i].endTaxAdjusted).toBeCloseTo(40_000 * rate, 4);
    // and the gross balance is identical
    expect(b[i].endTotal).toBeCloseTo(a[i].endTotal, 6);
  });

  it('receipts above the HSA balance add nothing beyond the balance', () => {
    const mk = (receipts: number): Plan => withHsa(golden.planA_simple(), { a: { hsa: 10_000, hsaReceipts: receipts }, policyAge: 120 });
    const big = runProjection(mk(5_000_000)).rows;
    const full = runProjection(mk(10_000_000)).rows;
    expect(big[big.length - 1].endTaxAdjusted).toBeCloseTo(full[full.length - 1].endTaxAdjusted, 6);
  });
});
