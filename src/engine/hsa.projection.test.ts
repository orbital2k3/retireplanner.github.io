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
