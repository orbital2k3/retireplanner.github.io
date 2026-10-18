import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as golden from './__golden/plans';
import type { Plan } from '../schemas/plan';
import { optimizeStrategy } from './optimizer';
import { optimizeCached } from './__testutil__/optimizeCached';
import { assertProjectionInvariants } from './__invariants__/assertions';
import { enc, pinDate, unpinDate } from './__regression__/snapshotUtil';
import { medicalRow, withExpenses, withHsa } from './__testutil__/hsaPlans';
import { taxAdjustedValue, taxAdjustedRates, hsaTaxableBalance } from './taxAdjusted';
import { REC_GOALS } from './recommender';

/** Opt tier: the optimizer with an owned HSA. The HSA follows a rule (it is not a search dimension), so
 *  the blend windows keep their three-bucket shape, but the objective sees the HSA at its haircut value.
 *  planF (all-trad couple, ~2.5s per max-end run) and planP (~4s max-spending) are the cheap fixtures. */

beforeAll(pinDate);
afterAll(unpinDate);

/** planF with an HSA, a tagged medical bill and a few hundred thousand of receipts' worth of history. */
const hsaPlanF = (): Plan => {
  const p = golden.planF_allTradCouple();
  return withExpenses(
    withHsa(p, { a: { hsa: 220_000, hsaReceipts: 40_000 }, b: { hsa: 60_000 }, policyAge: 65 }),
    [...p.expenseStreams, medicalRow({ id: 'med', startAge: p.personA.retirementAge, annualAmount: 12_000, inflationPct: { mode: 'fixed', rate: 0.04 } })],
  );
};

const windowKeys = (r: ReturnType<typeof optimizeStrategy>) => [...new Set(r.perYearPolicy.windows.flatMap((w) => Object.keys(w)))].sort();

describe('optimizer with an HSA', () => {
  it('is deterministic (two independent runs agree exactly)', () => {
    const a = optimizeStrategy(structuredClone(hsaPlanF()), 'max-end-balance', { thorough: false });
    const b = optimizeStrategy(structuredClone(hsaPlanF()), 'max-end-balance', { thorough: false });
    expect(enc(a.perYearPolicy)).toBe(enc(b.perYearPolicy));
    expect(enc(a.metric)).toBe(enc(b.metric));
    expect(a.projection.rows.some((r) => r.hsaQualifiedWD > 0)).toBe(true);
  }, 300_000);

  it('keeps the three-bucket window shape: no HSA share is searched or emitted', () => {
    const plan = hsaPlanF();
    const withH = optimizeCached(plan, 'max-end-balance', { thorough: false });
    const noH = optimizeCached(golden.planF_allTradCouple(), 'max-end-balance', { thorough: false });
    expect(windowKeys(withH)).toEqual(windowKeys(noH));
    expect(windowKeys(withH).some((k) => /hsa/i.test(k))).toBe(false);
    expect(withH.perYearPolicy.windows.length).toBe(noH.perYearPolicy.windows.length);
    for (const w of withH.perYearPolicy.windows) {
      expect(w.pctTaxable + w.pctTraditional + w.pctRoth).toBeCloseTo(1, 9);
    }
    assertProjectionInvariants(withH.projection, plan);
  }, 300_000);

  it('scores the ending HSA at its haircut value: above receipts at the ordinary rate, receipts untaxed', () => {
    const plan = hsaPlanF();
    const res = optimizeCached(plan, 'max-end-balance', { thorough: false });
    const last = res.projection.rows[res.projection.rows.length - 1];
    expect(last.endHSA).toBeGreaterThan(0);
    // the objective the search maximized is the projection's tax-adjusted end value (today's $)
    expect(res.metric).toBeCloseTo(REC_GOALS['max-end'].score(res.projection), 6);
    // and that value contains the HSA term on top of the three-bucket value
    const { ordRate, ltcgRate } = taxAdjustedRates(plan.assumptions);
    const threeBucket = taxAdjustedValue(last.endTaxable, last.endTaxableBasis, last.endTraditional, last.endRoth, ordRate, ltcgRate);
    const hsaTerm = hsaTaxableBalance(last.endHSA, last.hsaReceiptsBal) * (1 - ordRate) + Math.min(last.endHSA, last.hsaReceiptsBal);
    expect(last.endTaxAdjusted).toBeCloseTo(threeBucket + hsaTerm, 4);
    expect(hsaTerm).toBeGreaterThan(0);
    expect(hsaTerm).toBeLessThan(last.endHSA);                      // a real haircut, not Roth-like for all of it
    // an HSA is extra money here, so the plan scores better than the same plan without one
    const noH = optimizeCached(golden.planF_allTradCouple(), 'max-end-balance', { thorough: false });
    expect(res.metric).toBeGreaterThan(noH.metric);
  }, 300_000);

  it('the max-spending search accounts for the HSA in its after-tax legacy seed and result', () => {
    const base = golden.planP_tightPlan();
    const plan = withHsa({ ...base, assumptions: { ...base.assumptions, legacyTargetTaxAdjReal: 100_000 } }, { a: { hsa: 150_000, hsaReceipts: 20_000 } });
    const res = optimizeCached(plan, 'max-sustainable-spending', { thorough: false });
    expect(res.solvedSpendingMultiplier).toBeGreaterThan(0);
    expect(res.projection.ranOut).toBe(false);
    // the after-tax legacy the policy delivers meets the target (the HSA counts at its haircut value)
    expect(res.achievedLegacyTaxAdjReal ?? res.projection.endTaxAdjustedReal).toBeGreaterThanOrEqual(100_000 * 0.95);
    assertProjectionInvariants(res.projection, plan, { skipSpendingCoverage: true });
  }, 300_000);
});
