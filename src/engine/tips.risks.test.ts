import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runProjection } from './projection';
import { rmdDivisor } from './rmd';
import { planL_survivorARMD } from './__golden/plans';
import type { Plan, IncomeStream } from '../schemas/plan';
import { pinDate, unpinDate } from './__regression__/snapshotUtil';
import { ladderRungs, rung, thisYear, tipsIdlePlan, tipsRetireePlan, withTips } from './__testutil__/tipsPlans';

beforeAll(pinDate);
afterAll(unpinDate);

const Y = thisYear();
const g = 0.065, pi = 0.025;

/** T-5, risk R10: TIPS double count, return leakage, state exemption, survivor RMD, deflation floor. */
describe('R10a: year-0 endTotal has no double count', () => {
  it('equals the entered totals grown, with each sleeve growing at CPI plus its coupon instead of the return', () => {
    // Idle plan: no spending and tiny taxable income, so nothing is taxed or withdrawn.
    const idle = tipsIdlePlan({ taxable: 100_000, trad: 150_000, roth: 120_000 });
    const rungs = [
      rung({ maturityYear: Y + 5, adjustedPrincipal: 20_000, couponRate: 0.01, account: 'taxable' }),
      rung({ maturityYear: Y + 5, adjustedPrincipal: 50_000, couponRate: 0.02, account: 'traditional', whose: 'A' }),
      rung({ maturityYear: Y + 5, adjustedPrincipal: 30_000, couponRate: 0.015, account: 'roth' }),
    ];
    const r = runProjection(withTips(idle, rungs)).rows[0];
    expect(r.fedTax).toBe(0);
    const entered = 100_000 + 150_000 + 120_000;
    const sleeveEffect = (P: number, c: number) => P * ((1 + pi) - (1 + g) + c * (1 + pi));
    const expected = entered * (1 + g) + sleeveEffect(20_000, 0.01) + sleeveEffect(50_000, 0.02) + sleeveEffect(30_000, 0.015);
    expect(r.endTotal).toBeCloseTo(expected, 4);
    // and the three buckets plus the sleeve make up that total exactly
    expect(r.endTaxable + r.endTraditional + r.endRoth + r.endTipsTaxable + r.endTipsTrad + r.endTipsRoth).toBeCloseTo(r.endTotal, 6);
  });

  it('the same bonds listed in the balances and carved out do not change the total beyond what they earn', () => {
    // With the carve-out, entered totals T hold the bonds. Without it (balancesIncludeLadder false) the
    // bonds are on top, so the opening total is larger by exactly the ladder.
    const idle = tipsIdlePlan({ taxable: 100_000 });
    const rungs = [rung({ maturityYear: Y + 5, adjustedPrincipal: 20_000, couponRate: 0.01 })];
    const carved = runProjection(withTips(idle, rungs)).rows[0];
    const onTop = runProjection(withTips(idle, rungs, false)).rows[0];
    expect(carved.begTaxable + carved.begTips).toBeCloseTo(100_000, 6);
    expect(onTop.begTaxable + onTop.begTips).toBeCloseTo(120_000, 6);
  });
});

describe('R10b: the sleeve ignores returns and follows CPI only', () => {
  const plan = (): Plan => withTips(tipsRetireePlan(), [
    ...ladderRungs({ firstYear: Y + 1, years: 4, principal: 30_000, couponRate: 0.015, account: 'taxable' }),
    ...ladderRungs({ firstYear: Y + 2, years: 3, principal: 25_000, couponRate: 0.01, account: 'traditional', whose: 'A' }),
    ...ladderRungs({ firstYear: Y + 3, years: 2, principal: 20_000, couponRate: 0.0125, account: 'roth' }),
  ]);
  const n = 40;
  const flows = (r: ReturnType<typeof runProjection>['rows'][number]) => [
    r.begTips, r.endTipsTaxable, r.endTipsTrad, r.endTipsRoth, r.tipsCoupon, r.tipsAccrual, r.tipsMaturity,
    r.tipsFloorBonus, r.tipsCash, r.tipsToTrad, r.tipsToRoth, r.tipsOrdInc,
  ];

  it('ladder cash flows are identical across return paths when CPI is fixed', () => {
    const calm = runProjection(plan(), { returnOverrides: Array(n).fill(0.065), inflationOverrides: Array(n).fill(0.025) });
    const crash = runProjection(plan(), { returnOverrides: Array.from({ length: n }, (_, i) => (i < 2 ? -0.35 : i % 3 === 0 ? 0.2 : -0.05)), inflationOverrides: Array(n).fill(0.025) });
    const boom = runProjection(plan(), { returnOverrides: Array(n).fill(0.18), inflationOverrides: Array(n).fill(0.025) });
    for (let i = 0; i < 8; i++) {
      expect(flows(crash.rows[i])).toEqual(flows(calm.rows[i]));
      expect(flows(boom.rows[i])).toEqual(flows(calm.rows[i]));
    }
    // the market paths themselves differ a lot
    expect(Math.abs(crash.rows[5].endTaxable - calm.rows[5].endTaxable)).toBeGreaterThan(1_000);
    expect(Math.abs(boom.rows[5].endTraditional - calm.rows[5].endTraditional)).toBeGreaterThan(1_000);
  });

  it('follows the CPI path: opening sleeve value compounds the actual inflation', () => {
    const infl = [0.01, 0.06, -0.02, 0.04, 0.03, 0.02, 0.02, 0.02, ...Array(n - 8).fill(0.02)];
    const single = withTips(tipsIdlePlan({ roth: 200_000 }), [rung({ maturityYear: Y + 6, adjustedPrincipal: 100_000, couponRate: 0, account: 'roth' })]);
    const rows = runProjection(single, { returnOverrides: Array(n).fill(0.05), inflationOverrides: infl }).rows;
    let idx = 1;
    for (let i = 0; i <= 6; i++) {
      expect(rows[i].begTips).toBeCloseTo(100_000 * idx, 6);
      idx *= 1 + infl[i];
    }
    // maturity pays the year-end indexed principal
    expect(rows[6].tipsMaturity).toBeCloseTo(100_000 * idx, 6);
  });

  it('without the CPI override, the plan inflation drives the sleeve (deterministic projection)', () => {
    const rows = runProjection(plan()).rows;
    expect(rows[3].begTips).toBeGreaterThan(0);
    const again = runProjection(plan(), { returnOverrides: Array(n).fill(0.01) }).rows;
    for (let i = 0; i < 6; i++) expect(flows(again[i])).toEqual(flows(rows[i]));
  });
});

describe('R10c: a taxable rung is federally taxed but exempt from state tax', () => {
  // Idle plan with a big taxable ladder: ~$68k of coupon + indexation, covered by the coupon cash, so no
  // withdrawals and no gains are realized. Nothing else is taxable.
  const bigLadder = (state: Plan['state']): Plan => ({
    ...withTips(tipsIdlePlan({ taxable: 2_000_000 }), [
      rung({ maturityYear: Y + 12, adjustedPrincipal: 1_500_000, couponRate: 0.02, account: 'taxable' }),
    ]),
    state,
  });

  it.each(['IL', 'CA', 'NY'] as const)('%s: federal tax rises, state tax stays zero', (state) => {
    const r = runProjection(bigLadder(state)).rows[0];
    expect(r.tipsOrdInc).toBeGreaterThan(60_000);
    expect(r.ordIncome).toBeCloseTo(r.tipsOrdInc, 4);
    expect(r.fedTax).toBeGreaterThan(1_000);
    expect(r.stateTaxAmt).toBe(0);
    expect(r.niit).toBe(0);       // magi below the NIIT threshold
  });

  it('control: the same income as a taxable "Other" stream IS state-taxed in CA and NY', () => {
    const income: IncomeStream = {
      id: 'o', description: 'Other', whose: 'Household', type: 'Other', startAge: 0, end: { mode: 'life' }, survivorPct: 1,
      annualAmount: 68_000, growthPct: { mode: 'cpi' }, taxablePct: 1, stateTaxablePct: 1,
    };
    for (const state of ['CA', 'NY'] as const) {
      const p: Plan = { ...tipsIdlePlan({ taxable: 2_000_000 }), state, incomeStreams: [income] };
      expect(runProjection(p).rows[0].stateTaxAmt).toBeGreaterThan(500);
    }
  });

  it('phantom income raises the NIIT base once income passes the threshold', () => {
    const p: Plan = { ...bigLadder('IL'), incomeStreams: [{
      id: 'p', description: 'Pension', whose: 'Household', type: 'Pension', startAge: 0, end: { mode: 'life' }, survivorPct: 1,
      annualAmount: 220_000, growthPct: { mode: 'cpi' }, taxablePct: 1, stateTaxablePct: 0,
    }] };
    const r = runProjection(p).rows[0];
    expect(r.niit).toBeGreaterThan(0);                         // MAGI over $250k: ladder interest is NII
    const noLadder = runProjection({ ...p, portfolio: { ...p.portfolio, tipsLadder: undefined } }).rows[0];
    expect(r.niit).toBeGreaterThan(noLadder.niit);
  });

  it('an IRA-held rung owes nothing until money is drawn: same taxes as without the rung in year 0', () => {
    const idle = tipsIdlePlan({ trad: 800_000 });
    const none = runProjection(idle).rows[0];
    const ira = runProjection(withTips(idle, [rung({ maturityYear: Y + 9, adjustedPrincipal: 300_000, couponRate: 0.02, account: 'traditional', whose: 'A' })])).rows[0];
    expect(ira.tipsOrdInc).toBe(0);
    expect(ira.fedTax).toBe(none.fedTax);
    expect(ira.ordIncome).toBe(none.ordIncome);
  });
});

describe('R10d: an A-owned pre-tax rung stays in the survivor\'s RMD base', () => {
  it('after A dies, B\'s RMD is figured on the IRA plus the rung', () => {
    const l = planL_survivorARMD();
    // A big IRA for B keeps liquid money in the survivor years, so the RMD is not clamped.
    const base: Plan = { ...l, portfolio: { ...l.portfolio, personB: { ...l.portfolio.personB!, traditional: 2_500_000 } } };
    const plan = withTips(base, [rung({ maturityYear: Y + 30, adjustedPrincipal: 150_000, couponRate: 0.015, account: 'traditional', whose: 'A' })]);
    const rows = runProjection(plan).rows;
    const survivor = rows.filter((r) => r.phase === 'Survivor' && r.rmd > 0 && r.rmdUnmet === 0);
    expect(survivor.length).toBeGreaterThan(3);
    for (const r of survivor.slice(0, 6)) {
      expect(r.begTips).toBeGreaterThan(0);                              // still held
      expect(r.endTipsTrad).toBeGreaterThan(0);
      expect(r.rmd * rmdDivisor(r.ageB!)).toBeCloseTo(r.begTraditional + r.begTips, 4);
    }
  });

  it('before A dies each person\'s own rung counts in their own base', () => {
    const plan = withTips(planL_survivorARMD(), [
      rung({ maturityYear: Y + 30, adjustedPrincipal: 150_000, couponRate: 0.015, account: 'traditional', whose: 'A' }),
      rung({ maturityYear: Y + 30, adjustedPrincipal: 100_000, couponRate: 0.015, account: 'traditional', whose: 'B' }),
    ]);
    const without = planL_survivorARMD();
    const rowsWith = runProjection(plan).rows;
    const rowsWithout = runProjection(without).rows;
    // B reaches RMD age first (born 1960); the rung enlarges B's RMD relative to the unladdered IRA total
    const i = rowsWith.findIndex((r) => r.rmd > 0);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(rowsWith[i].rmd).toBeGreaterThan(0);
    expect(rowsWith[i].begTips).toBeGreaterThan(0);
    // total balance conservation of the base: IRA + rungs (carved) is what the entered IRAs were
    expect(rowsWith[0].begTraditional + rowsWith[0].begTips).toBeCloseTo(rowsWithout[0].begTraditional, 6);
  });
});

describe('R10e: deflation floor at maturity (D12)', () => {
  const n = 40;
  const deflation = Array(n).fill(-0.03);
  const plan = (): Plan => withTips(tipsIdlePlan({ taxable: 200_000 }), [
    rung({ maturityYear: Y + 3, adjustedPrincipal: 50_000, couponRate: 0.01, account: 'taxable' }),
  ]);

  it('pays at least par at maturity, and only then', () => {
    const rows = runProjection(plan(), { returnOverrides: Array(n).fill(0.04), inflationOverrides: deflation }).rows;
    // before maturity the principal falls with the index and nothing is floored
    expect(rows[1].endTipsTaxable).toBeCloseTo(50_000 * Math.pow(0.97, 2), 6);
    expect(rows[1].tipsFloorBonus).toBe(0);
    const m = rows[3];
    const indexed = 50_000 * Math.pow(0.97, 4);
    expect(m.tipsMaturity).toBeCloseTo(50_000, 6);                    // par, not 44,262
    expect(m.tipsFloorBonus).toBeCloseTo(50_000 - indexed, 6);
    expect(m.endTipsTaxable).toBe(0);
  });

  it('a deflation adjustment offsets only that year\'s coupon; the floor bonus is taxed as interest', () => {
    const rows = runProjection(plan(), { returnOverrides: Array(n).fill(0.04), inflationOverrides: deflation }).rows;
    // coupon 1% of ~48k = ~480; accrual about -1,500: net negative -> taxed at zero, never a deduction
    expect(rows[0].tipsAccrual).toBeLessThan(0);
    expect(rows[0].tipsOrdInc).toBe(0);
    expect(rows[1].tipsOrdInc).toBe(0);
    const m = rows[3];
    expect(m.tipsOrdInc).toBeCloseTo(m.tipsFloorBonus + Math.max(0, m.tipsCoupon + m.tipsAccrual), 6);
    expect(m.tipsOrdInc).toBeGreaterThan(5_000);
  });

  it('uses par from faceValue when given, so a lower par means no floor bonus', () => {
    const p = withTips(tipsIdlePlan({ taxable: 200_000 }), [
      rung({ maturityYear: Y + 3, adjustedPrincipal: 50_000, faceValue: 40_000, couponRate: 0.01, account: 'taxable' }),
    ]);
    const m = runProjection(p, { returnOverrides: Array(n).fill(0.04), inflationOverrides: deflation }).rows[3];
    expect(m.tipsFloorBonus).toBe(0);
    expect(m.tipsMaturity).toBeCloseTo(50_000 * Math.pow(0.97, 4), 6);
  });
});
