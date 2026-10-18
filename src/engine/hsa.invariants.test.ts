import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runProjection } from './projection';
import * as golden from './__golden/plans';
import { samplePlan, type Plan } from '../schemas/plan';
import { assertProjectionInvariants } from './__invariants__/assertions';
import { pinDate, unpinDate } from './__regression__/snapshotUtil';
import { hsaOnlyPlan, medicalPlan, medicalRow, withExpenses, withHsa } from './__testutil__/hsaPlans';

beforeAll(pinDate);
afterAll(unpinDate);

/** H-7: the engine's dollar-flow invariants (HSA mass balance, no overdraw, endTotal identity,
 *  portfolio conservation including HSA growth, contributions and the penalty) hold on plans that
 *  actually use the HSA in each way. */
const hsaOn = (p: Plan, over: Parameters<typeof withHsa>[1]) => withHsa(p, over);
const giveMedical = (p: Plan): Plan => withExpenses(p, [
  ...p.expenseStreams,
  medicalRow({ id: 'med2', startAge: p.personA.retirementAge, annualAmount: 18_000, inflationPct: { mode: 'fixed', rate: 0.04 } }),
]);

const cases: Array<[string, () => Plan]> = [
  ['working contributions only (planA)', () => hsaOn(golden.planA_simple(), { a: { hsa: 20_000, hsaContribution: 4_000 }, b: { hsa: 5_000, hsaContribution: 4_000 } })],
  ['family pool, both spouses', () => hsaOn(golden.planA_simple(), { a: { hsa: 0, hsaContribution: 9_000, hsaCoverage: 'family' }, b: { hsa: 0, hsaContribution: 9_000, hsaCoverage: 'family' } })],
  ['HSA pays medical + IRMAA from 65 (default policy)', () => hsaOn(medicalPlan({ a: { hsa: 250_000, hsaReceipts: 12_000 } }), {})],
  ['always-pay policy, two HSAs', () => medicalPlan({ a: { hsa: 90_000 }, b: { hsa: 160_000 }, policyAge: 0 })],
  ['small HSA that runs dry', () => medicalPlan({ a: { hsa: 25_000 }, policyAge: 0 })],
  ['hsaReturn differs from tradReturn', () => medicalPlan({ a: { hsa: 200_000 }, hsaReturn: 0.03, policyAge: 0 })],
  ['HSA only: last-resort draws with penalty then none', () => hsaOnlyPlan(30_000)],
  ['HSA only, no receipts, little medical', () => hsaOnlyPlan(0, 2_000)],
  ['CA couple with medical + HSA', () => giveMedical(hsaOn(golden.planG_californiaCouple(), { a: { hsa: 120_000, hsaContribution: 4_000 }, policyAge: 65 }))],
  ['survivor mid plan', () => giveMedical(hsaOn(golden.planH_survivorMidPlan(), { a: { hsa: 90_000 }, b: { hsa: 40_000 }, policyAge: 0 }))],
  ['all-trad couple with RMD and IRMAA', () => giveMedical(hsaOn(golden.planF_allTradCouple(), { a: { hsa: 300_000 }, policyAge: 0 }))],
  ['samplePlan with an HSA', () => giveMedical(hsaOn(samplePlan(), { a: { hsa: 60_000, hsaContribution: 5_000, hsaCoverage: 'family' }, hsaReturn: 0.06 }))],
];

describe('HSA invariants (H-7)', () => {
  for (const [name, make] of cases) {
    it(name, () => {
      const plan = make();
      const proj = runProjection(plan);
      expect(proj.rows.some((r) => r.begHSA > 0 || r.endHSA > 0 || r.hsaContrib > 0)).toBe(true);
      assertProjectionInvariants(proj, plan);
    });
  }

  it('a plan without an HSA reports no HSA flow in any row', () => {
    for (const r of runProjection(golden.planF_allTradCouple()).rows) {
      expect(r.begHSA + r.endHSA + r.hsaContrib + r.hsaQualifiedWD + r.hsaReimbursed + r.hsaNonQualWD + r.hsaPenalty + r.hsaReceiptsBal).toBe(0);
    }
  });

  it('the checks can fail: a tampered penalty, overdraw or endTotal is caught', () => {
    const plan = hsaOnlyPlan(30_000);
    const proj = runProjection(plan);
    const i = proj.rows.findIndex((r) => r.hsaPenalty > 0);
    expect(i).toBeGreaterThanOrEqual(0);
    const tamper = (fn: (r: (typeof proj.rows)[number]) => void) => {
      const rows = proj.rows.map((r) => ({ ...r }));
      fn(rows[i]);
      return { ...proj, rows };
    };
    expect(() => assertProjectionInvariants(tamper((r) => { r.hsaPenalty = 0; }), plan)).toThrow(/conservation/);
    expect(() => assertProjectionInvariants(tamper((r) => { r.hsaNonQualWD += r.begHSA * 2; }), plan)).toThrow(/HSA OVERDRAW/);
    expect(() => assertProjectionInvariants(tamper((r) => { r.endHSA += 500; }), plan)).toThrow(/HSA MASS BALANCE/);
    expect(() => assertProjectionInvariants(tamper((r) => { r.hsaReimbursed = 1e9; }), plan)).toThrow(/receipts on file|HSA OVERDRAW/);
  });
});
