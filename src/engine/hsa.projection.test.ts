import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runProjection } from './projection';
import * as golden from './__golden/plans';
import { pinDate, unpinDate } from './__regression__/snapshotUtil';
import { withHsa } from './__testutil__/hsaPlans';

beforeAll(pinDate);
afterAll(unpinDate);

// planA (pinned to 2026): A is 53 (retires 65, claims 67), B is 51 (retires 63, claims 67).
const base = golden.planA_simple;

describe('HSA core: balance, growth and contributions (H-3)', () => {
  it('reports zero HSA fields on a plan without one', () => {
    for (const r of runProjection(base()).rows) {
      expect(r.begHSA).toBe(0); expect(r.endHSA).toBe(0); expect(r.hsaContrib).toBe(0);
    }
  });

  it('grows the balance at hsaReturn and adds the working contribution on top', () => {
    const rows = runProjection(withHsa(base(), { a: { hsa: 10_000, hsaContribution: 3_000 }, hsaReturn: 0.08 })).rows;
    expect(rows[0].begHSA).toBe(10_000);
    expect(rows[0].hsaContrib).toBe(3_000);
    expect(rows[0].endHSA).toBeCloseTo(10_000 * 1.08 + 3_000, 6);
    expect(rows[1].begHSA).toBeCloseTo(rows[0].endHSA, 6);
    // contribution indexes with inflation (row 1 factor = 1.025)
    expect(rows[1].hsaContrib).toBeCloseTo(3_000 * rows[1].inflationFactor, 6);
  });

  it('uses tradReturn when hsaReturn is absent', () => {
    const p = withHsa(base(), { a: { hsa: 10_000 } });
    const rows = runProjection(p).rows;
    expect(rows[0].endHSA).toBeCloseTo(10_000 * (1 + p.assumptions.tradReturn), 6);
  });

  it('caps the contribution at the legal limit and adds the catch-up at 55', () => {
    const rows = runProjection(withHsa(base(), { a: { hsa: 0, hsaContribution: 50_000, hsaCoverage: 'family' } })).rows;
    expect(rows[0].hsaContrib).toBe(8_750);                      // age 53, family
    const r2 = rows[2];                                           // age 55: indexed base + unindexed 1,000
    expect(r2.hsaContrib).toBeCloseTo(8_750 * r2.inflationFactor + 1_000, 6);
  });

  it('contributions are external: taxable, pre-tax and Roth balances do not move', () => {
    const without = runProjection(base()).rows;
    const withH = runProjection(withHsa(base(), { a: { hsa: 20_000, hsaContribution: 4_000 }, b: { hsa: 5_000, hsaContribution: 4_000 } })).rows;
    // B retires at 63 (year 12); compare the accumulation years before any spending exists
    for (let i = 0; i < 11; i++) {
      expect(withH[i].endTaxable).toBe(without[i].endTaxable);
      expect(withH[i].endTraditional).toBe(without[i].endTraditional);
      expect(withH[i].endRoth).toBe(without[i].endRoth);
      expect(withH[i].fedTax).toBe(without[i].fedTax);
    }
  });

  it('endTotal includes the HSA', () => {
    const rows = runProjection(withHsa(base(), { a: { hsa: 40_000, hsaContribution: 3_000 } })).rows;
    for (const r of rows) {
      expect(r.endTotal).toBeCloseTo(r.endTaxable + r.endTraditional + r.endRoth + r.endHSA, 6);
    }
  });

  it('stops contributing at retirement unless the retirement election is on (that part is H-8)', () => {
    const rows = runProjection(withHsa(base(), { b: { hsa: 0, hsaContribution: 4_000 } })).rows;
    const b = rows.filter((r) => r.hsaContrib > 0);
    // B is 51 now and retires at 63: contributes in years 1..12 (ages 51..62)
    expect(b.length).toBe(12);
    expect(rows[12].hsaContrib).toBe(0);
  });

  it('a delayed Social Security claim lets a worker contribute past 65', () => {
    const p = withHsa(base(), { a: { hsa: 0, hsaContribution: 4_000 } });
    // A works to 80 here, claims at 69: contributes until the year before the claim
    const later = { ...p, personA: { ...p.personA, retirementAge: 80, ssClaimAge: 69 } };
    const rows = runProjection(later).rows;
    const last = [...rows].reverse().find((r) => r.hsaContrib > 0)!;
    expect(last.ageA).toBe(68);
  });

  it('merges the HSA into the surviving spouse when one dies', () => {
    const p = withHsa(base(), { a: { hsa: 50_000 }, b: { hsa: 10_000 }, hsaReturn: 0.05 });
    const short = { ...p, personA: { ...p.personA, planThroughAge: 60 } };
    const rows = runProjection(short).rows;
    const dying = rows.findIndex((r) => r.ageA === 61);
    // after the merge the pooled balance keeps compounding as one account
    expect(rows[dying].begHSA).toBeCloseTo(rows[dying - 1].endHSA, 6);
    expect(rows[dying].endHSA).toBeCloseTo(rows[dying].begHSA * 1.05, 6);
  });

  it('follows the per-year return override (Monte Carlo paths)', () => {
    const p = withHsa(base(), { a: { hsa: 100_000 } });
    const n = 40;
    const overrides = Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 0.20 : -0.10));
    const rows = runProjection(p, { returnOverrides: overrides }).rows;
    expect(rows[0].endHSA).toBeCloseTo(120_000, 6);
    expect(rows[1].endHSA).toBeCloseTo(108_000, 6);
  });
});

// ---------------------------------------------------------------------------------------------
// H-4: qualified spending, policy age and receipts
// ---------------------------------------------------------------------------------------------
import type { Plan } from '../schemas/plan';
import { medicalRow, withExpenses } from './__testutil__/hsaPlans';

/** planA retiring at 58 with 40k of medical spending starting then. A is 53 in 2026. */
function medicalPlan(over: Parameters<typeof withHsa>[1], medical = 40_000): Plan {
  const p = base();
  const retired = { ...p, personA: { ...p.personA, retirementAge: 58 }, personB: { ...p.personB!, retirementAge: 55 } };
  return withExpenses(
    withHsa(retired, over),
    [
      { ...p.expenseStreams[0], startAge: 58 },
      medicalRow({ id: 'med', startAge: 58, annualAmount: medical, inflationPct: { mode: 'fixed', rate: 0.03 } }),
    ],
  );
}

describe('HSA qualified spending (H-4)', () => {
  it('pays medical from the HSA once the owner reaches the policy age (always = 0)', () => {
    const rows = runProjection(medicalPlan({ a: { hsa: 400_000 }, policyAge: 0 })).rows;
    const first = rows.find((r) => r.medicalSpend > 0)!;
    expect(first.hsaQualifiedWD).toBeCloseTo(first.medicalSpend + first.irmaa, 6);
    expect(first.endHSA).toBeCloseTo(first.begHSA * 1.065 - first.hsaQualifiedWD, 4);
    expect(first.hsaReceiptsBal).toBe(0);
  });

  it('reduces the portfolio draw by the amount the HSA pays', () => {
    const noHsa = runProjection(medicalPlan({}, 40_000)).rows;
    const withH = runProjection(medicalPlan({ a: { hsa: 400_000 }, policyAge: 0 })).rows;
    const k = noHsa.findIndex((r) => r.medicalSpend > 0);
    // first year spending exists: the draw (before taxes feedback) is lower by about the medical bill
    expect(noHsa[k].totalWD - withH[k].totalWD).toBeGreaterThan(0.8 * noHsa[k].medicalSpend);
    expect(withH[k].shortfall).toBe(0);
  });

  it('pays nothing before the policy age and logs the bills as receipts instead', () => {
    const rows = runProjection(medicalPlan({ a: { hsa: 200_000, hsaReceipts: 5_000 } })).rows; // default policy 65
    const pre = rows.filter((r) => r.medicalSpend > 0 && r.ageA < 65);
    expect(pre.length).toBeGreaterThan(3);
    for (const r of pre) expect(r.hsaQualifiedWD).toBe(0);
    // receipts = seed + every bill paid elsewhere so far
    let expected = 5_000;
    for (const r of rows) {
      if (r.ageA < 65) expected += r.medicalSpend;
      if (r.ageA >= 65) break;
      expect(r.hsaReceiptsBal).toBeCloseTo(expected, 6);
    }
    const at65 = rows.find((r) => r.ageA === 65)!;
    expect(at65.hsaQualifiedWD).toBeGreaterThan(0);
    // paying from the HSA at 65 leaves the pool alone
    expect(at65.hsaReceiptsBal).toBeCloseTo(rows.find((r) => r.ageA === 64)!.hsaReceiptsBal, 6);
  });

  it('lets the HSA pay the IRMAA surcharge at 65 and later', () => {
    // large pre-tax balances make IRMAA likely; any year with a surcharge is checked
    const p = medicalPlan({ a: { hsa: 900_000, traditional: 3_000_000 }, b: { traditional: 2_000_000 }, policyAge: 0 });
    const rows = runProjection(p).rows;
    const withIrmaa = rows.filter((r) => r.irmaa > 0 && r.begHSA > 200_000);
    expect(withIrmaa.length).toBeGreaterThan(0);
    for (const r of withIrmaa) expect(r.hsaQualifiedWD).toBeCloseTo(r.medicalSpend + r.irmaa, 4);
  });

  it('never pays more than it holds and never goes negative', () => {
    const rows = runProjection(medicalPlan({ a: { hsa: 30_000 }, policyAge: 0 })).rows;
    for (const r of rows) {
      expect(r.endHSA).toBeGreaterThanOrEqual(0);
      expect(r.hsaQualifiedWD).toBeLessThanOrEqual(r.begHSA * 1.065 + r.hsaContrib + 1e-6);
    }
    // the small HSA runs dry and the rest of the bill falls back on the portfolio
    expect(rows.some((r) => r.endHSA === 0 && r.medicalSpend > r.hsaQualifiedWD)).toBe(true);
  });

  it('pays from both spouses accounts in proportion to their balances', () => {
    const rows = runProjection(medicalPlan({ a: { hsa: 100_000 }, b: { hsa: 300_000 }, policyAge: 0 })).rows;
    const r = rows.find((x) => x.medicalSpend > 0)!;
    const grown = r.begHSA * 1.065;
    expect(r.endHSA).toBeCloseTo(grown - r.hsaQualifiedWD, 4);
  });
});

// ---------------------------------------------------------------------------------------------
// H-5: last-resort draws
// ---------------------------------------------------------------------------------------------
/** Nothing but an HSA: the household has to live on it (plus Social Security later). */
function hsaOnlyPlan(receipts = 0, medical = 10_000): Plan {
  const p = base();
  const zero = { taxable: 0, taxableBasis: 0, traditional: 0, roth: 0, annualContribution: 0 };
  const hsa = withHsa({
    ...p,
    personA: { ...p.personA, retirementAge: 55, ssClaimAge: 70 },
    personB: { ...p.personB!, retirementAge: 55, ssClaimAge: 70 },
    portfolio: { personA: { ...p.portfolio.personA, ...zero }, personB: { ...p.portfolio.personB!, ...zero } },
  }, { a: { hsa: 700_000, hsaReceipts: receipts } });
  return withExpenses(hsa, [
    { ...p.expenseStreams[0], startAge: 55, annualAmount: 30_000, inflationPct: { mode: 'fixed', rate: 0.025 } },
    medicalRow({ id: 'med', startAge: 55, annualAmount: medical, inflationPct: { mode: 'fixed', rate: 0.025 } }),
  ]);
}

describe('HSA last resort (H-5)', () => {
  const rows = runProjection(hsaOnlyPlan(25_000)).rows;
  const at = (age: number) => rows.find((r) => r.ageA === age)!;

  it('pays the unpaid medical bill first, then receipts, then non-qualified money', () => {
    const r = rows[0];                       // A is 53; both retired by the plan (retire 55) -> first spending year is age 55
    expect(r.hsaNonQualWD).toBe(0);
    const y = at(55);
    expect(y.hsaQualifiedWD).toBeCloseTo(y.medicalSpend, 4);          // medical paid tax-free from the HSA
    expect(y.hsaReimbursed).toBeCloseTo(25_000, 4);                   // receipts drained in the first need
    expect(y.hsaNonQualWD).toBeGreaterThan(0);                        // the 30k of general spending is non-qualified
  });

  it('charges the 20% penalty only while the owner is under 65', () => {
    const y = at(60);
    expect(y.hsaNonQualWD).toBeGreaterThan(0);
    expect(y.hsaPenalty).toBeCloseTo(y.hsaNonQualWD * 0.2, 6);
    const old = at(66);
    expect(old.hsaNonQualWD).toBeGreaterThan(0);
    expect(old.hsaPenalty).toBe(0);
  });

  it('taxes the non-qualified draw as ordinary income', () => {
    const y = at(60);
    expect(y.ordIncome).toBeGreaterThanOrEqual(y.hsaNonQualWD - 1e-6);
    expect(y.fedTax).toBeGreaterThan(0);
  });

  it('covers spending without a shortfall while the HSA lasts and records the draw', () => {
    for (const r of rows.filter((x) => x.ageA >= 55 && x.endHSA > 1)) expect(r.shortfall).toBeLessThan(1);
    expect(at(55).endHSA).toBeLessThan(at(55).begHSA * 1.065 - at(55).hsaQualifiedWD);   // growth less every draw
  });

  it('pays the penalty out of the same pool, so the HSA drains faster than the spending alone', () => {
    const y = at(58);
    const spent = y.begHSA * 1.065 - y.endHSA;
    expect(spent).toBeGreaterThan(y.netSpend + y.hsaPenalty - 1);
  });
});

// ---------------------------------------------------------------------------------------------
// H-6: ending value
// ---------------------------------------------------------------------------------------------
describe('HSA in the tax-adjusted end value (H-6)', () => {
  it('haircuts the ending HSA above receipts and leaves the receipts-backed part whole', () => {
    const noH = runProjection(withHsa(base(), {}));
    // policy age 120: the HSA never pays (not even IRMAA), so only its own end value differs
    const p = withHsa(base(), { a: { hsa: 100_000, hsaReceipts: 20_000 }, policyAge: 120 });
    const res = runProjection(p);
    const last = res.rows[res.rows.length - 1];
    const lastNo = noH.rows[noH.rows.length - 1];
    expect(last.endHSA).toBeGreaterThan(100_000);
    // nothing else moves (no medical spending), so the difference is the HSA term only
    const rate = p.assumptions.taxAdjOrdRate;
    const exempt = Math.min(last.endHSA, last.hsaReceiptsBal);
    expect(last.endTaxAdjusted - lastNo.endTaxAdjusted).toBeCloseTo((last.endHSA - exempt) * (1 - rate) + exempt, 4);
    expect(last.endTaxAdjusted).toBeLessThan(last.endTotal);
  });
});
