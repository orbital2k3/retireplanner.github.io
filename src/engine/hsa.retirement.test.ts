import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runProjection } from './projection';
import { acaNetPremium, federalPovertyLevel } from './aca';
import { assertProjectionInvariants } from './__invariants__/assertions';
import { pinDate, unpinDate } from './__regression__/snapshotUtil';
import { acaRetireePlan } from './__testutil__/hsaPlans';
import { hsaAcaFloorWarning } from './hsaWarnings';

beforeAll(pinDate);
afterAll(unpinDate);

/** H-8: a retiree who keeps contributing to an HSA before 65 (D6). The contribution is a cash need paid
 *  from the portfolio and an above-the-line deduction that lowers ACA / IRMAA / SS-taxability income. */
describe('HSA contributions in retirement (H-8)', () => {
  const on = runProjection(acaRetireePlan({ contribute: true }));
  const off = runProjection(acaRetireePlan({ contribute: false }));

  it('contributes only before 65, and not at all without the election', () => {
    const rows = on.rows.filter((r) => r.hsaContribRet > 0);
    expect(rows[0].ageA).toBe(55);
    expect(rows[rows.length - 1].ageA).toBe(64);
    expect(rows.length).toBe(10);
    expect(off.rows.every((r) => r.hsaContrib === 0 && r.hsaContribRet === 0)).toBe(true);
  });

  it('pays the contribution from the portfolio: the HSA grows by it and the Roth draw rises by it', () => {
    const a = on.rows[0], b = off.rows[0];
    expect(a.hsaContrib).toBe(a.hsaContribRet);                  // all of it is a retiree contribution
    expect(a.endHSA - b.endHSA).toBeCloseTo(a.hsaContribRet, 4);
    // Roth funds the whole difference: the contribution itself, less the tax and premium it saved
    const saved = (b.fedTax - a.fedTax) + (b.stateTaxAmt - a.stateTaxAmt) + (b.acaPremium - a.acaPremium) + (b.irmaa - a.irmaa) + (b.niit - a.niit);
    expect(a.wdRth - b.wdRth).toBeCloseTo(a.hsaContribRet - saved, 0);
    expect(saved).toBeGreaterThan(0);
    expect(a.shortfall).toBe(0);
  });

  it('lowers ACA MAGI by the contribution and the premium by the matching subsidy change', () => {
    for (const i of [0, 3, 8]) {
      const a = on.rows[i], b = off.rows[i];
      expect(b.acaMagi - a.acaMagi).toBeCloseTo(a.hsaContribRet, 4);
      const expected = acaNetPremium({ magi: a.acaMagi, householdSize: 1, annualBenchmarkPremium: 9_000 * a.inflationFactor, inflationFactor: a.inflationFactor });
      expect(a.acaPremium).toBeCloseTo(expected, 4);
      expect(a.acaPremium).toBeLessThan(b.acaPremium);          // lower income, bigger subsidy
    }
  });

  it('also lowers federal tax and the MAGI used for IRMAA history', () => {
    expect(on.rows[0].fedTax).toBeLessThanOrEqual(off.rows[0].fedTax);
    expect(on.rows[0].magi).toBeLessThan(off.rows[0].magi);
  });

  it('leaves state tax alone: the deduction is federal only, in IL and in CA', () => {
    for (const state of ['IL', 'CA'] as const) {
      const a = runProjection(acaRetireePlan({ state, contribute: true })).rows;
      const b = runProjection(acaRetireePlan({ state, contribute: false })).rows;
      // spending is funded from Roth in both, so the only state-relevant income is the pension
      for (let i = 0; i < 10; i++) expect(a[i].stateTaxAmt).toBeCloseTo(b[i].stateTaxAmt, 4);
    }
  });

  it('keeps taxable ordinary income at zero or above when the deduction exceeds income', () => {
    const rows = runProjection(acaRetireePlan({ contribute: true, pension: 2_000 })).rows;
    for (const r of rows) { expect(r.ordIncome).toBeGreaterThanOrEqual(0); expect(r.fedTax).toBeGreaterThanOrEqual(0); }
    expect(rows[0].ordIncome).toBe(0);
  });

  it('passes every invariant, including conservation with the internal transfer', () => {
    for (const state of ['IL', 'CA'] as const) {
      const plan = acaRetireePlan({ state });
      assertProjectionInvariants(runProjection(plan), plan);
    }
  });

  it('a couple: only the retired spouse contributes from the portfolio, the worker contributes externally', () => {
    const solo = acaRetireePlan();
    const p = { ...solo, personB: { ...solo.personA, name: 'B', dob: '1974-01-01', retirementAge: 62, planThroughAge: 90 },
      portfolio: { personA: solo.portfolio.personA,
        personB: { ...solo.portfolio.personA, roth: 0, hsa: 0, hsaContribution: 3_000, hsaContribInRetirement: false } } };
    const r = runProjection(p).rows[0];            // A retired (55), B (52) still working until 62
    expect(r.hsaContribRet).toBeCloseTo(4_400, 4);
    expect(r.hsaContrib).toBeCloseTo(4_400 + 3_000, 4);
  });
});

describe('ACA-floor warning (H-8)', () => {
  it('fires when the contribution is what pushes ACA income under 100% of the poverty level', () => {
    // 2026 FPL for one person is ~15.6k; a 17k pension is above it, 17k - 4.4k is below
    const plan = acaRetireePlan({ pension: 17_000, contribute: true });
    const w = hsaAcaFloorWarning(plan, runProjection(plan).rows);
    expect(w?.id).toBe('hsa-aca-below-fpl');
    expect(w?.severity).toBe('warn');
    expect(w?.message).toMatch(/100% of the poverty level/);
  });

  it('stays quiet without the election, with comfortable income, or without ACA modeling', () => {
    const off = acaRetireePlan({ pension: 17_000, contribute: false });
    expect(hsaAcaFloorWarning(off, runProjection(off).rows)).toBeNull();
    const rich = acaRetireePlan({ pension: 40_000, contribute: true });
    expect(hsaAcaFloorWarning(rich, runProjection(rich).rows)).toBeNull();
    const noAca = acaRetireePlan({ pension: 17_000, contribute: true });
    noAca.assumptions = { ...noAca.assumptions, modelACA: false };
    expect(hsaAcaFloorWarning(noAca, runProjection(noAca).rows)).toBeNull();
  });

  it('uses the plan household size for the threshold', () => {
    expect(federalPovertyLevel(1)).toBeLessThan(federalPovertyLevel(2));
  });
});
