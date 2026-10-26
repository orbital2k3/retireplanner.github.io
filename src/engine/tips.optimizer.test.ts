import { afterAll, describe, expect, it } from 'vitest';
import * as golden from './__golden/plans';
import type { Plan } from '../schemas/plan';
import { optimizeStrategy } from './optimizer';
import { optimizeCached } from './__testutil__/optimizeCached';
import { assertProjectionInvariants } from './__invariants__/assertions';
import { enc, pinDate, unpinDate } from './__regression__/snapshotUtil';
import { ladderRungs, thisYear, withTips } from './__testutil__/tipsPlans';
import { taxAdjustedValue, taxAdjustedRates } from './taxAdjusted';
import { REC_GOALS } from './recommender';

/** Opt tier: the optimizer with a TIPS ladder. The ladder follows a rule (its rungs are inputs, not a
 *  search dimension), so the blend windows keep their three-bucket shape, but the objective sees the sleeve
 *  at its after-tax value and the max-spending seed knows the ladder exists. planF (all-trad couple,
 *  ~2.5s per max-end run) and planP (~4s max-spending) are the cheap fixtures. */

pinDate(); // at load, so fixtures built while collecting describe blocks see the pinned year too
afterAll(unpinDate);

const Y = thisYear();

/** planF (A 53, retires at 65 in 2038) with an IRA ladder bridging the first retirement years. */
const ladderPlanF = (): Plan => withTips(golden.planF_allTradCouple(), [
  ...ladderRungs({ firstYear: Y + 12, years: 6, principal: 60_000, couponRate: 0.015, account: 'traditional', whose: 'A' }),
  ...ladderRungs({ firstYear: Y + 14, years: 3, principal: 40_000, couponRate: 0.01, account: 'traditional', whose: 'B' }),
]);

/** planP (retires 2030/2029) with a taxable bridge, IRA rungs and two Roth rungs. */
const ladderPlanP = (): Plan => withTips(golden.planP_tightPlan(), [
  ...ladderRungs({ firstYear: Y + 4, years: 6, principal: 30_000, couponRate: 0.0125, account: 'taxable' }),
  ...ladderRungs({ firstYear: Y + 10, years: 3, principal: 40_000, couponRate: 0.015, account: 'traditional', whose: 'A' }),
  ...ladderRungs({ firstYear: Y + 5, years: 2, principal: 20_000, couponRate: 0.02, account: 'roth' }),
]);

const windowKeys = (r: ReturnType<typeof optimizeStrategy>) => [...new Set(r.perYearPolicy.windows.flatMap((w) => Object.keys(w)))].sort();

describe('optimizer with a TIPS ladder', () => {
  it('is deterministic (two independent runs agree exactly)', () => {
    const a = optimizeStrategy(structuredClone(ladderPlanF()), 'max-end-balance', { thorough: false });
    const b = optimizeStrategy(structuredClone(ladderPlanF()), 'max-end-balance', { thorough: false });
    expect(enc(a.perYearPolicy)).toBe(enc(b.perYearPolicy));
    expect(enc(a.metric)).toBe(enc(b.metric));
    expect(a.projection.rows.some((r) => r.tipsToTrad > 0)).toBe(true);
  }, 300_000);

  it('keeps the three-bucket window shape: no ladder share is searched or emitted', () => {
    const plan = ladderPlanF();
    const withL = optimizeCached(plan, 'max-end-balance', { thorough: false });
    const noL = optimizeCached(golden.planF_allTradCouple(), 'max-end-balance', { thorough: false });
    expect(windowKeys(withL)).toEqual(windowKeys(noL));
    expect(windowKeys(withL).some((k) => /tips|ladder/i.test(k))).toBe(false);
    for (const w of withL.perYearPolicy.windows) {
      expect(w.pctTaxable + w.pctTraditional + w.pctRoth).toBeCloseTo(1, 9);
    }
    assertProjectionInvariants(withL.projection, plan, { skipSpendingCoverage: true });
  }, 300_000);

  it('scores the ending sleeve at its after-tax value: pre-tax rungs at the ordinary rate, the rest untaxed', () => {
    const plan = withTips(ladderPlanF(), [
      ...ladderRungs({ firstYear: Y + 12, years: 2, principal: 60_000, couponRate: 0.015, account: 'traditional', whose: 'A' }),
      // outlives the plan horizon, so a sleeve is still held at the end
      ...ladderRungs({ firstYear: Y + 70, years: 1, principal: 90_000, couponRate: 0.015, account: 'traditional', whose: 'A' }),
    ]);
    const res = optimizeCached(plan, 'max-end-balance', { thorough: false });
    const last = res.projection.rows[res.projection.rows.length - 1];
    expect(last.endTipsTrad).toBeGreaterThan(0);
    // the objective the search maximized is the projection's tax-adjusted end value (today's $)
    expect(res.metric).toBeCloseTo(REC_GOALS['max-end'].score(res.projection), 6);
    const { ordRate, ltcgRate } = taxAdjustedRates(plan.assumptions);
    const threeBucket = taxAdjustedValue(last.endTaxable, last.endTaxableBasis, last.endTraditional, last.endRoth, ordRate, ltcgRate);
    const sleeveTerm = last.endTipsTrad * (1 - ordRate) + last.endTipsTaxable + last.endTipsRoth;
    expect(last.endTaxAdjusted).toBeCloseTo(threeBucket + sleeveTerm, 4);
    expect(sleeveTerm).toBeLessThan(last.endTipsTrad + last.endTipsTaxable + last.endTipsRoth);   // a real haircut on the IRA part
    expect(sleeveTerm).toBeGreaterThan(0);
  }, 300_000);

  it('the max-spending search sees the ladder: seed and result are consistent with the projection', () => {
    const base = ladderPlanP();
    const plan: Plan = { ...base, assumptions: { ...base.assumptions, legacyTargetTaxAdjReal: 100_000 } };
    const res = optimizeCached(plan, 'max-sustainable-spending', { thorough: false });
    expect(res.solvedSpendingMultiplier).toBeGreaterThan(0);
    expect(res.projection.ranOut).toBe(false);
    expect(res.achievedLegacyTaxAdjReal ?? res.projection.endTaxAdjustedReal).toBeGreaterThanOrEqual(100_000 * 0.95);
    assertProjectionInvariants(res.projection, plan, { skipSpendingCoverage: true });
    // the same plan without the ladder (rungs put back as ordinary balances) supports about the same spending:
    // the carve-out moves money into a CPI-linked sleeve, it does not create or destroy any
    const flat = optimizeCached({ ...plan, portfolio: { ...plan.portfolio, tipsLadder: undefined } }, 'max-sustainable-spending', { thorough: false });
    const ratio = res.solvedSpendingMultiplier! / flat.solvedSpendingMultiplier!;
    expect(ratio).toBeGreaterThan(0.85);
    expect(ratio).toBeLessThan(1.15);
  }, 300_000);

  it('rungs on top of the balances raise the sustainable spending (extra money, nothing carved out)', () => {
    const base = golden.planP_tightPlan();
    const rungs = ladderRungs({ firstYear: Y + 4, years: 6, principal: 30_000, couponRate: 0.0125, account: 'taxable' });
    const on = optimizeCached(withTips(base, rungs, false), 'max-sustainable-spending', { thorough: false });
    const off = optimizeCached(base, 'max-sustainable-spending', { thorough: false });
    expect(on.solvedSpendingMultiplier!).toBeGreaterThan(off.solvedSpendingMultiplier!);
  }, 300_000);
});
