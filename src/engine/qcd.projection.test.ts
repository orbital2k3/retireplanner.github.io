import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runProjection, type ProjectionRow } from './projection';
import type { ExpenseStream, IncomeStream, Plan } from '../schemas/plan';
import * as golden from './__golden/plans';
import { assertProjectionInvariants } from './__invariants__/assertions';
import { digestProjection, enc, pinDate, rowWhitelist, unpinDate } from './__regression__/snapshotUtil';
import { QCD_LIMIT_2026 } from './taxConstants';
import type { BlendPolicy } from './blendPolicy';

/** QCD in the projection (Q-2, Q-3, Q-5): income treatment, RMD satisfaction, the QCD-beyond-RMD
 *  window (70½ to the RMD start age), per-person allocation, state-tax effects, the OBBBA
 *  non-itemizer deduction, and the cases that must NOT change a plan.
 *  Dates are pinned (2026-06-15), so a person born 1950-01-01 is 76 in the first plan year. */

beforeAll(pinDate);
afterAll(unpinDate);

const flat = { mode: 'fixed' as const, rate: 0 };
const expense = (id: string, annualAmount: number, extra: Partial<ExpenseStream> = {}): ExpenseStream => ({
  id, description: id, whose: 'Household', startAge: 60, end: { mode: 'lastSurvivor' }, survivorPct: 1, annualAmount, inflationPct: flat, ...extra,
});
const charity = (annualAmount: number, extra: Partial<ExpenseStream> = {}) => expense('charity', annualAmount, { category: 'charitable', ...extra });
const pension = (annualAmount: number): IncomeStream => ({
  id: 'pen', description: 'Pension', whose: 'A', type: 'Pension', startAge: 55, end: { mode: 'lastSurvivor' }, survivorPct: 0,
  annualAmount, growthPct: flat, taxablePct: 1, stateTaxablePct: 1,
});

/** One retiree born 1950-01-01 (76 in the first year, RMD divisor 23.7), IRA only. */
function soloIra(trad: number, extra: Partial<Plan> = {}): Plan {
  const base = golden.planB_largeTradSingle();
  return {
    ...base,
    personA: { ...base.personA, dob: '1950-01-01', retirementAge: 65, planThroughAge: 90, ssPIA: 0 },
    portfolio: { personA: { ...base.portfolio.personA, taxable: 0, taxableBasis: 0, traditional: trad, roth: 0, annualContribution: 0 }, personB: undefined },
    incomeStreams: [pension(20_000)],
    expenseStreams: [expense('core', 20_000), charity(20_000)],
    conversion: { ...base.conversion, mode: 'off', optimize: false },
    ...extra,
  };
}
const rowsAt = (p: Plan, off = false) => runProjection(p, off ? { disableQCD: true } : undefined).rows;
const sum = (rows: ProjectionRow[], f: (r: ProjectionRow) => number) => rows.reduce((s, r) => s + f(r), 0);

describe('QCD vs the RMD', () => {
  it('RMD 30k with 20k of giving: 10k of the RMD is income, the IRA is still debited the full 30k', () => {
    const plan = soloIra(711_000);
    const on = rowsAt(plan)[0], off = rowsAt(plan, true)[0];
    expect(on.rmd).toBeCloseTo(30_000, 4);
    expect(on.qcd).toBeCloseTo(20_000, 4);
    expect(on.qcdBeyondRmd).toBe(0);
    expect(off.qcd).toBe(0);
    // ordinary income falls by exactly the QCD; gross RMD is unchanged
    expect(off.ordIncome - on.ordIncome).toBeCloseTo(20_000, 4);
    expect(on.rmd).toBe(off.rmd);
    // same cash-equivalent leaves the IRA either way, so the end balance matches
    expect(on.endTraditional).toBeCloseTo(off.endTraditional, 4);
    assertProjectionInvariants(runProjection(plan), plan);
  });

  it('giving above the RMD is paid as a QCD beyond it, never more than the giving', () => {
    const on = rowsAt(soloIra(711_000, { expenseStreams: [expense('core', 20_000), charity(50_000)] }))[0];
    expect(on.qcd).toBeCloseTo(50_000, 4); // 30k satisfies the RMD, 20k goes beyond it
    expect(on.qcdBeyondRmd).toBeCloseTo(20_000, 4);
    expect(on.qcd).toBeLessThanOrEqual(on.charitableSpend + 1e-6);
  });

  it('federal tax, income and the IRMAA lookback MAGI two years later all fall', () => {
    const plan = soloIra(1_400_000, { expenseStreams: [expense('core', 60_000), charity(25_000)] });
    const on = rowsAt(plan), off = rowsAt(plan, true);
    expect(sum(on, (r) => r.fedTax)).toBeLessThan(sum(off, (r) => r.fedTax));
    for (let i = 0; i + 2 < 6; i++) {
      expect(on[i].qcd).toBeGreaterThan(0);
      expect(on[i + 2].irmaaMagi).toBeLessThan(off[i + 2].irmaaMagi);
    }
  });

  it('CA state tax falls with a QCD; IL (which exempts IRA income) is unchanged', () => {
    const ca = soloIra(711_000, { state: 'CA' });
    const il = soloIra(711_000, { state: 'IL' });
    expect(rowsAt(ca)[0].stateTaxAmt).toBeLessThan(rowsAt(ca, true)[0].stateTaxAmt);
    expect(rowsAt(il)[0].stateTaxAmt).toBe(rowsAt(il, true)[0].stateTaxAmt);
  });
});

describe('QCD beyond the RMD (age 70½ up to the RMD start age)', () => {
  /** Born 1956-01-01: 70 in 2026. RMDs start at 75, so every QCD dollar in the first years is beyond the RMD. */
  const young70 = (extra: Partial<Plan> = {}) => soloIra(900_000, { personA: { ...soloIra(0).personA, dob: '1956-01-01' }, ...extra });

  it('pays giving from the IRA with no RMD, debits the IRA and keeps invariants (R4)', () => {
    const plan = young70();
    const rows = rowsAt(plan);
    expect(rows[0].rmd).toBe(0);
    expect(rows[0].qcd).toBeCloseTo(20_000, 4);
    expect(rows[0].qcdBeyondRmd).toBeCloseTo(20_000, 4);
    assertProjectionInvariants(runProjection(plan), plan);
  });

  it('the Roth-conversion cap shrinks by the QCD', () => {
    const plan = young70({ conversion: { mode: 'auto-window', startAge: 60, endAge: 90, autoAmount: 10_000_000, bracketCeiling: 10_000_000, manualSchedule: {}, optimize: false } });
    const on = rowsAt(plan)[0], off = rowsAt(plan, true)[0];
    expect(off.rothConv).toBeGreaterThan(0);
    expect(off.rothConv - on.rothConv).toBeCloseTo(on.qcd, 2);
  });

  it('an oversized convAmt policy never overdraws the IRA (R4)', () => {
    const plan = young70();
    const policy: BlendPolicy = { windows: [{ fromAge: 60, toAge: 100, pctTaxable: 0, pctTraditional: 1, pctRoth: 0, convAmt: 1e9 }] };
    const res = runProjection(plan, { policy });
    assertProjectionInvariants(res, plan);
    expect(res.rows[0].qcd).toBeGreaterThan(0);
  });

  it('the annual limit caps the QCD and the rest is paid as ordinary spending', () => {
    const plan = young70({ expenseStreams: [expense('core', 20_000), charity(150_000)] });
    const r = rowsAt(plan)[0];
    expect(r.qcd).toBeCloseTo(QCD_LIMIT_2026, 4);
    expect(r.charitableSpend).toBeCloseTo(150_000, 4);
    assertProjectionInvariants(runProjection(plan), plan);
  });
});

describe('who gets the QCD (couples, survivors, eligibility)', () => {
  /** A is 76 with an IRA; B (born 1961, 65) is younger and not QCD-eligible. */
  const couple = (tradA: number, tradB: number, extra: Partial<Plan> = {}): Plan => {
    const base = golden.planA_simple();
    return {
      ...base,
      personA: { ...base.personA, dob: '1950-01-01', retirementAge: 65, planThroughAge: 95, ssPIA: 0 },
      personB: { ...base.personB!, dob: '1961-01-01', retirementAge: 62, planThroughAge: 95, ssPIA: 0 },
      portfolio: {
        personA: { ...base.portfolio.personA, taxable: 0, taxableBasis: 0, traditional: tradA, roth: 0, annualContribution: 0 },
        personB: { ...base.portfolio.personB!, taxable: 0, taxableBasis: 0, traditional: tradB, roth: 0, annualContribution: 0 },
      },
      incomeStreams: [pension(30_000)],
      expenseStreams: [expense('core', 30_000), charity(20_000)],
      conversion: { ...base.conversion, mode: 'off', optimize: false },
      ...extra,
    };
  };

  it('only A eligible and A\'s IRA empty: B\'s rows are identical with QCD on and off until B turns 70 (R5)', () => {
    const plan = couple(0, 600_000);
    const on = runProjection(plan).rows.filter((r) => (r.ageB ?? 0) < 70);
    const off = runProjection(plan, { disableQCD: true }).rows.filter((r) => (r.ageB ?? 0) < 70);
    expect(on.length).toBeGreaterThan(3);
    on.forEach((r, i) => {
      expect(r.qcd).toBe(0);
      expect(enc(rowWhitelist(r))).toBe(enc(rowWhitelist(off[i])));
    });
  });

  it('only A eligible: the QCD comes from A and B\'s IRA is untouched by it', () => {
    const withA = couple(500_000, 600_000);
    const r = rowsAt(withA)[0];
    expect(r.qcd).toBeCloseTo(20_000, 4);
    // B (65) has no RMD and is not eligible, so the whole IRA outflow beyond growth is A's RMD side
    assertProjectionInvariants(runProjection(withA), withA);
  });

  it('MFJ lets each spouse use their own limit', () => {
    const base = couple(2_000_000, 2_000_000, {
      personB: { ...couple(0, 0).personB!, dob: '1951-01-01' },
      expenseStreams: [expense('core', 30_000), charity(180_000)],
    });
    const r = rowsAt(base)[0];
    expect(r.qcd).toBeGreaterThan(QCD_LIMIT_2026);
    expect(r.qcd).toBeLessThanOrEqual(2 * QCD_LIMIT_2026 + 1e-6);
    assertProjectionInvariants(runProjection(base), base);
  });

  it('a donor-advised-fund gift (qcd:false) is never paid as a QCD', () => {
    const plan = soloIra(711_000, { expenseStreams: [expense('core', 20_000), charity(20_000, { qcd: false })] });
    const on = rowsAt(plan)[0];
    expect(on.qcd).toBe(0);
    expect(enc(digestProjection(runProjection(plan)))).toBe(enc(digestProjection(runProjection(plan, { disableQCD: true }))));
  });
});

describe('OBBBA non-itemizer charitable deduction (Q-3)', () => {
  it('cash giving to a public charity gets $2,000 as MFJ, and the deduction sits in the standard deduction', () => {
    // Both spouses under 70, so no QCD is possible and the gift is cash.
    const base = golden.planA_simple();
    const plan: Plan = { ...base, expenseStreams: [expense('core', 60_000, { startAge: 60 }), charity(20_000, { startAge: 60 })] };
    const rows = rowsAt(plan).filter((r) => r.netSpend > 0 && r.qcd === 0);
    expect(rows.length).toBeGreaterThan(3);
    for (const r of rows) expect(r.charityDeduction).toBe(2_000);
    const plain: Plan = { ...plan, expenseStreams: [expense('core', 60_000, { startAge: 60 }), expense('charity', 20_000, { startAge: 60 })] };
    const without = rowsAt(plain);
    const r0 = rows[0];
    const w0 = without.find((x) => x.year === r0.year)!;
    expect(r0.stdDeduction - r0.seniorBonus).toBeCloseTo(w0.stdDeduction - w0.seniorBonus + 2_000, 6);
  });

  it('is capped at the giving when giving is below the cap', () => {
    const plan = soloIra(0, { expenseStreams: [expense('core', 20_000), charity(600)], portfolio: { personA: { ...soloIra(0).portfolio.personA, taxable: 800_000, taxableBasis: 800_000 }, personB: undefined } });
    const r = rowsAt(plan).find((x) => x.netSpend > 0)!;
    expect(r.charityDeduction).toBeCloseTo(600, 6);
  });

  it('is $1,000 for a Single filer', () => {
    const plan = soloIra(0, { portfolio: { personA: { ...soloIra(0).portfolio.personA, taxable: 800_000, taxableBasis: 800_000 }, personB: undefined } });
    // A is 76 so a QCD would apply, but the IRA is empty: the gift is cash.
    const r = rowsAt(plan)[0];
    expect(r.qcd).toBe(0);
    expect(r.charityDeduction).toBe(1_000);
  });

  it('halves to $1,000 once a spouse dies and the filer is Single (R6)', () => {
    const base = golden.planH_survivorMidPlan();
    // No IRA money at all (contributions go to taxable and Roth), so no QCD is ever possible.
    const noIra = { taxable: 0.5, traditional: 0, roth: 0.5 };
    const plan: Plan = {
      ...base,
      portfolio: {
        personA: { ...base.portfolio.personA, traditional: 0, contribSplit: noIra },
        personB: { ...base.portfolio.personB!, traditional: 0, contribSplit: noIra },
      },
      expenseStreams: [expense('core', 60_000, { startAge: 60 }), charity(20_000, { startAge: 60 })],
    };
    const rows = rowsAt(plan).filter((r) => r.netSpend > 0);
    const mfj = rows.filter((r) => r.filingStatus === 'MFJ');
    const single = rows.filter((r) => r.filingStatus === 'Single');
    expect(mfj.length).toBeGreaterThan(0);
    expect(single.length).toBeGreaterThan(0);
    for (const r of mfj) expect(r.charityDeduction).toBe(2_000);
    for (const r of single) expect(r.charityDeduction).toBe(1_000);
  });

  it('is zero when a QCD covers all the giving (R6)', () => {
    const r = rowsAt(soloIra(711_000))[0];
    expect(r.qcd).toBeCloseTo(20_000, 4);
    expect(r.charityDeduction).toBe(0);
  });

  it('is zero for a donor-advised-fund gift', () => {
    const plan = soloIra(0, { expenseStreams: [expense('core', 20_000), charity(20_000, { qcd: false })] });
    expect(rowsAt(plan)[0].charityDeduction).toBe(0);
  });

  it('the no-QCD counterfactual still gets the deduction it would have had', () => {
    const plan = soloIra(711_000);
    expect(rowsAt(plan, true)[0].charityDeduction).toBe(1_000);
  });

  it('does not change a plan with no charitable rows (bit-exact)', () => {
    const plan = soloIra(711_000, { expenseStreams: [expense('core', 40_000)] });
    expect(enc(digestProjection(runProjection(plan)))).toBe(enc(digestProjection(runProjection(plan, { disableQCD: true }))));
    expect(rowsAt(plan).every((r) => r.charityDeduction === 0 && r.qcd === 0)).toBe(true);
  });
});
