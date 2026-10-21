import { afterAll, describe, expect, it } from 'vitest';
import { runProjection } from './projection';
import { acaNetPremium, federalPovertyLevel } from './aca';
import { assertProjectionInvariants } from './__invariants__/assertions';
import { pinDate, unpinDate } from './__regression__/snapshotUtil';
import { acaRetireePlan, hsaOnlyPlan, withHsa } from './__testutil__/hsaPlans';
import * as golden from './__golden/plans';
import type { Plan } from '../schemas/plan';
import { hsaAcaFloorWarning } from './hsaWarnings';

pinDate(); // at load, so fixtures built while collecting describe blocks see the pinned year too
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

  it('leaves state tax alone in this fixture: its only state income is a pension IL exempts, and CA ignores the deduction', () => {
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

/** The same early retiree living off a brokerage account instead of Roth: almost no ordinary income, so
 *  the deduction is mostly larger than ordinary income and has to come off capital gains. */
function brokerageRetiree(state: Plan['state'], contribute: boolean): Plan {
  const p = acaRetireePlan({ state, contribute, pension: 0 });
  return {
    ...p,
    withdrawalStrategy: 'taxfirst',
    portfolio: { personA: { ...p.portfolio.personA, roth: 0, taxable: 900_000, taxableBasis: 450_000, hsaContribution: 5_400 } },
  };
}

describe('retiree HSA deduction beyond ordinary income (audit 2026-10-20)', () => {
  const on = runProjection(brokerageRetiree('IL', true)).rows[0];
  const off = runProjection(brokerageRetiree('IL', false)).rows[0];
  const c = on.hsaContribRet;
  // Year 0 starts from the same balance and basis, so the gain share of a brokerage dollar is the same.
  const gf = (off.ltcg - off.qualifiedDiv) / off.wdTax;
  const extraGains = (on.wdTax - off.wdTax) * gf;

  it('exercises the case: ordinary income is below the contribution', () => {
    expect(c).toBeCloseTo(5_400, 6);
    expect(off.ordIncome).toBeLessThan(c);
    expect(on.ordIncome).toBe(0);
  });

  it('takes the rest of the deduction off capital gains, so AGI falls by the contribution less the gains that fund it', () => {
    expect(on.magi).toBeCloseTo(off.magi - c + extraGains, 4);
    expect(on.acaMagi).toBeCloseTo(off.acaMagi - c + extraGains, 4);
    expect(on.acaMagi).toBeLessThan(off.acaMagi);
    expect(on.acaPremium).toBeLessThan(off.acaPremium);
  });

  it('lowers state tax by the deduction in a conforming state (IL), not in California', () => {
    // IL: flat 4.95% on non-exempt income (gains included), less the deduction
    expect(off.stateTaxAmt - on.stateTaxAmt).toBeCloseTo(0.0495 * (c - extraGains), 4);
    const caOn = runProjection(brokerageRetiree('CA', true)).rows[0];
    const caOff = runProjection(brokerageRetiree('CA', false)).rows[0];
    expect(caOn.stateTaxAmt).toBeGreaterThanOrEqual(caOff.stateTaxAmt);
  });

  it('holds every invariant', () => {
    for (const state of ['IL', 'CA', 'NY'] as const) {
      const plan = brokerageRetiree(state, true);
      assertProjectionInvariants(runProjection(plan), plan);
    }
  });
});

describe('a retiree contribution the HSA itself would have to fund is not made (audit 2026-10-20)', () => {
  const contrib = (election: boolean) => {
    const p = hsaOnlyPlan();
    return { ...p, portfolio: { ...p.portfolio, personA: { ...p.portfolio.personA, hsaContribution: 4_400, hsaContribInRetirement: election } } };
  };
  const on = runProjection(contrib(true));
  const off = runProjection(contrib(false));

  it('cancels the contribution in years when every other account is empty', () => {
    const retiredPre65 = on.rows.filter((r) => r.ageA >= 55 && r.ageA < 65);
    expect(retiredPre65.length).toBe(10);
    for (const r of retiredPre65) expect(r.hsaContribRet).toBe(0);
  });

  it('leaves the HSA, the penalty and the tax exactly as with no election', () => {
    for (let i = 0; i < on.rows.length; i++) {
      const a = on.rows[i], b = off.rows[i];
      expect(a.endHSA, `age ${a.ageA}`).toBeCloseTo(b.endHSA, 4);
      expect(a.hsaNonQualWD).toBeCloseTo(b.hsaNonQualWD, 4);
      expect(a.hsaPenalty).toBeCloseTo(b.hsaPenalty, 4);
      expect(a.fedTax).toBeCloseTo(b.fedTax, 4);
    }
    assertProjectionInvariants(on, contrib(true));
  });
});

describe('the HSA pays IRMAA only from an owner 65 or over (Pub 969, audit 2026-10-20)', () => {
  // A (66) has a large pension and pays IRMAA; B (60) holds the HSA, policy "always", no medical rows.
  const plan = (): Plan => {
    const p = golden.planA_simple();
    const q: Plan = {
      ...p,
      personA: { ...p.personA, dob: '1960-01-01', retirementAge: 60 },
      personB: { ...p.personB!, dob: '1966-01-01', retirementAge: 55 },
      incomeStreams: [{ id: 'pension', description: 'Pension', whose: 'A', type: 'Pension', startAge: 60, end: { mode: 'life' }, survivorPct: 1,
        annualAmount: 300_000, growthPct: { mode: 'fixed', rate: 0.025 }, taxablePct: 1, stateTaxablePct: 1 }],
    } as Plan;
    return withHsa(q, { b: { hsa: 200_000 }, policyAge: 0 });
  };
  const rows = runProjection(plan()).rows;

  it('pays none of A\'s IRMAA while B is under 65', () => {
    const young = rows.filter((r) => r.ageB !== undefined && r.ageB < 65 && r.irmaa > 0);
    expect(young.length).toBeGreaterThan(3);
    for (const r of young) expect(r.hsaQualifiedWD, `B ${r.ageB}`).toBe(0);
  });

  it('pays it from B\'s 65th year on', () => {
    const r = rows.find((x) => x.ageB === 65)!;
    expect(r.irmaa).toBeGreaterThan(0);
    expect(r.hsaQualifiedWD).toBeCloseTo(r.irmaa, 4);
    assertProjectionInvariants(runProjection(plan()), plan());
  });
});
