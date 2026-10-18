import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runProjection } from './projection';
import * as golden from './__golden/plans';
import { type Plan } from '../schemas/plan';
import { assertProjectionInvariants } from './__invariants__/assertions';
import { pinDate, unpinDate } from './__regression__/snapshotUtil';
import { ladderRungs, rung, thisYear, tipsIdlePlan, tipsRetireePlan, tipsRmdPlan, withTips } from './__testutil__/tipsPlans';

beforeAll(pinDate);
afterAll(unpinDate);

/** T-4: the dollar-flow invariants (sleeve mass balance, cash split, IRA/Roth availability including
 *  coupons, endTotal identity, spending coverage with taxable ladder cash, portfolio conservation with
 *  the sleeve) hold on plans that use the ladder in each way. */
const Y = thisYear();
const mixed = (): Plan => withTips(tipsRetireePlan(), [
  ...ladderRungs({ firstYear: Y + 1, years: 5, principal: 25_000, couponRate: 0.012, account: 'taxable' }),
  ...ladderRungs({ firstYear: Y + 3, years: 4, principal: 30_000, couponRate: 0.01, account: 'traditional', whose: 'A' }),
  ...ladderRungs({ firstYear: Y + 6, years: 3, principal: 20_000, couponRate: 0.015, account: 'traditional', whose: 'B' }),
  ...ladderRungs({ firstYear: Y + 2, years: 3, principal: 15_000, couponRate: 0.0125, account: 'roth' }),
]);

const cases: Array<[string, () => Plan]> = [
  ['taxable, IRA (both owners) and Roth rungs on a retired couple', mixed],
  ['balances exclude the ladder (rungs on top)', () => withTips(tipsRetireePlan(), ladderRungs({ firstYear: Y, years: 8, principal: 40_000, couponRate: 0.01 }), false)],
  ['phantom income heavy: large taxable ladder in a high-tax plan', () => withTips(golden.planG_californiaCouple(), ladderRungs({ firstYear: Y + 12, years: 6, principal: 60_000, couponRate: 0.02, account: 'taxable' }))],
  ['all-trad couple with IRA rungs and RMDs', () => withTips(golden.planF_allTradCouple(), ladderRungs({ firstYear: Y + 10, years: 8, principal: 70_000, couponRate: 0.015, account: 'traditional', whose: 'A' }))],
  ['survivor: A dies mid plan with a rung of their own', () => withTips(golden.planH_survivorMidPlan(), [
    ...ladderRungs({ firstYear: Y + 20, years: 6, principal: 40_000, couponRate: 0.015, account: 'traditional', whose: 'A' }),
    ...ladderRungs({ firstYear: Y + 20, years: 4, principal: 20_000, couponRate: 0.015, account: 'taxable' }),
  ])],
  ['IRA entirely in rungs: RMD clamped, unmet recorded', () => withTips(tipsRmdPlan({ trad: 1_000_000 }), [
    rung({ maturityYear: Y + 8, adjustedPrincipal: 1_000_000, couponRate: 0.01, account: 'traditional', whose: 'A' }),
  ])],
  ['rungs maturing in year 0', () => withTips(tipsRetireePlan(), ladderRungs({ firstYear: Y, years: 2, principal: 30_000, couponRate: 0.02, account: 'taxable' }))],
  ['over-subscribed account (capped carve-out)', () => withTips(tipsIdlePlan({ roth: 30_000 }), [rung({ maturityYear: Y + 4, adjustedPrincipal: 500_000, account: 'roth' })])],
  ['QCD giver with an IRA ladder', () => withTips(golden.planQ_qcdGiver(), ladderRungs({ firstYear: Y + 1, years: 6, principal: 80_000, couponRate: 0.02, account: 'traditional', whose: 'A' }))],
  ['HSA plan with a taxable ladder', () => withTips(golden.planR_hsaEarlyRetiree(), ladderRungs({ firstYear: Y + 2, years: 6, principal: 30_000, couponRate: 0.015, account: 'taxable' }))],
];

describe('TIPS invariants (T-4)', () => {
  for (const [name, make] of cases) {
    it(name, () => {
      const plan = make();
      const proj = runProjection(plan);
      expect(proj.rows.some((r) => r.begTips > 0)).toBe(true);
      assertProjectionInvariants(proj, plan);
    });
  }

  it('a plan without a ladder reports no ladder flow in any row', () => {
    for (const r of runProjection(golden.planF_allTradCouple()).rows) {
      expect(r.begTips + r.endTipsTaxable + r.endTipsTrad + r.endTipsRoth + r.tipsCoupon + r.tipsAccrual
        + r.tipsMaturity + r.tipsCash + r.tipsToTrad + r.tipsToRoth + r.tipsOrdInc + r.rmdUnmet).toBe(0);
    }
  });

  it('the checks can fail: tampered sleeve, cash split, ordinary income or endTotal is caught', () => {
    const plan = mixed();
    const proj = runProjection(plan);
    const i = proj.rows.findIndex((r) => r.tipsMaturity > 0 && r.tipsCash > 0 && r.tipsToTrad > 0);
    expect(i).toBeGreaterThanOrEqual(0);
    const tamper = (fn: (r: (typeof proj.rows)[number]) => void) => {
      const rows = proj.rows.map((r) => ({ ...r }));
      fn(rows[i]);
      return { ...proj, rows };
    };
    expect(() => assertProjectionInvariants(tamper((r) => { r.endTipsTaxable += 500; }), plan)).toThrow(/TIPS sleeve MASS BALANCE|endTotal MISMATCH/);
    expect(() => assertProjectionInvariants(tamper((r) => { r.tipsCash += 500; }), plan)).toThrow(/TIPS cash split/);
    expect(() => assertProjectionInvariants(tamper((r) => { r.tipsOrdInc = r.tipsCoupon + Math.max(0, r.tipsAccrual) + r.tipsFloorBonus + 5_000; }), plan)).toThrow(/ordinary income/);
    expect(() => assertProjectionInvariants(tamper((r) => { r.endTotal += 800; }), plan)).toThrow(/endTotal MISMATCH/);
    expect(() => assertProjectionInvariants(tamper((r) => { r.tipsCoupon += 400; r.tipsCash += 400; }), plan)).toThrow(/Portfolio conservation failed/);
  });

  it('sleeve discontinuity between years is caught', () => {
    const plan = mixed();
    const proj = runProjection(plan);
    const rows = proj.rows.map((r) => ({ ...r }));
    rows[4].begTips += 900;
    rows[4].endTipsTaxable += 900;     // keep the year itself balanced so only the cross-row check fires
    rows[4].endTotal += 900;
    expect(() => assertProjectionInvariants({ ...proj, rows }, plan)).toThrow(/TIPS sleeve discontinuity/);
  });
});
