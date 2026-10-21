import { afterAll, describe, it, expect } from 'vitest';
import { runAndCompare, runAndCompareHsa, runAndCompareTips } from './harness';
import { runProjection } from '../projection';
import { pinDate, unpinDate } from '../__regression__/snapshotUtil';
import {
  planA_simple, planB_largeTradSingle, planC_bracketFillConv,
  planD_singleFIRE, planE_allRothCouple, planF_allTradCouple,
  planG_californiaCouple, planH_survivorMidPlan,
  planI_multiStreamIncome, planJ_personBZeroBalance,
  planK_wideAgeGap, planL_survivorARMD, planM_survivorBRMD, planQ_qcdGiver, planR_hsaEarlyRetiree, planS_tipsLadder,
} from './plans';

/**
 * Golden snapshot tests — capture the engine's current per-year output for the reference plans,
 * stored as CSV in this folder. Future changes that drift the output by >$2 in any column flag here.
 * Each plan also runs Layer 1's projection invariants via the harness.
 *
 * To regenerate intentionally: `UPDATE_GOLDENS=1 pnpm vitest run __golden`.
 *
 * NOTE: When real Excel-validated CSVs are available, replace the .csv files in this folder
 * to convert these from regression checks into Excel-parity checks.
 *
 * The projection starts in the current calendar year (ages, RMD/QCD eligibility, OBBBA years, ladder
 * maturities), so the clock is pinned to the year the CSVs were captured; otherwise every golden would
 * fail on January 1.
 */
pinDate(); // at load, so fixtures built while collecting describe blocks see the pinned year too
afterAll(unpinDate);

describe('Golden projection snapshots', () => {
  it('Plan A — Simple couple, taxfirst, IL', () => {
    const r = runAndCompare('planA_simple', planA_simple());
    expect(r.ok, r.message).toBe(true);
  });

  it('Plan B — Single, large Trad, RMDs dominate', () => {
    const r = runAndCompare('planB_largeTradSingle', planB_largeTradSingle());
    expect(r.ok, r.message).toBe(true);
  });

  it('Plan C — Couple, bracket-fill conversions through age 73', () => {
    const r = runAndCompare('planC_bracketFillConv', planC_bracketFillConv());
    expect(r.ok, r.message).toBe(true);
  });

  it('Plan D — Single FIRE, retire at 45, taxable bridge to SS at 70', () => {
    const r = runAndCompare('planD_singleFIRE', planD_singleFIRE());
    expect(r.ok, r.message).toBe(true);
  });

  it('Plan E — All-Roth couple, no RMD, rothfirst', () => {
    const r = runAndCompare('planE_allRothCouple', planE_allRothCouple());
    expect(r.ok, r.message).toBe(true);
  });

  it('Plan F — All-Trad couple, severe RMD, bracket-fill conversions', () => {
    const r = runAndCompare('planF_allTradCouple', planF_allTradCouple());
    expect(r.ok, r.message).toBe(true);
  });

  it('Plan G — California couple, state taxes retirement + conversions', () => {
    const r = runAndCompare('planG_californiaCouple', planG_californiaCouple());
    expect(r.ok, r.message).toBe(true);
  });

  it('Plan H — Survivor mid-plan, personB dies at 75 (MFJ→Single)', () => {
    const r = runAndCompare('planH_survivorMidPlan', planH_survivorMidPlan());
    expect(r.ok, r.message).toBe(true);
  });

  it('Plan I — Multi-stream income (SS + pension + rental)', () => {
    const r = runAndCompare('planI_multiStreamIncome', planI_multiStreamIncome());
    expect(r.ok, r.message).toBe(true);
  });

  it('Plan J — Person B with zero balances (real-world user shape)', () => {
    const r = runAndCompare('planJ_personBZeroBalance', planJ_personBZeroBalance());
    expect(r.ok, r.message).toBe(true);
  });

  it('Plan K — Wide age gap (A born 1968, B born 1957): B starts RMD before A', () => {
    const r = runAndCompare('planK_wideAgeGap', planK_wideAgeGap());
    expect(r.ok, r.message).toBe(true);
  });

  it('Plan L — Survivor: A dies at 80, B continues RMDs on merged balance', () => {
    const r = runAndCompare('planL_survivorARMD', planL_survivorARMD());
    expect(r.ok, r.message).toBe(true);
  });

  it('Plan M — Survivor: B dies at 78, A continues RMDs on merged balance', () => {
    const r = runAndCompare('planM_survivorBRMD', planM_survivorBRMD());
    expect(r.ok, r.message).toBe(true);
  });

  it('Plan Q — QCD giver: 72+ NY couple gives $30k/yr straight from their IRAs', () => {
    const r = runAndCompare('planQ_qcdGiver', planQ_qcdGiver());
    expect(r.ok, r.message).toBe(true);
  });

  it('Plan Q really exercises QCDs and the Single-filer deduction path', () => {
    const rows = runProjection(planQ_qcdGiver()).rows;
    expect(rows.some((r) => r.qcd > 0)).toBe(true);
    expect(rows.some((r) => r.filingStatus === 'Single')).toBe(true);
    expect(rows.filter((r) => r.qcd > 0).every((r) => r.qcd <= r.charitableSpend + 1e-6)).toBe(true);
  });

  it('Plan R — HSA early retiree: ACA bronze, $150k HSA, contributions in retirement, receipts', () => {
    const r = runAndCompare('planR_hsaEarlyRetiree', planR_hsaEarlyRetiree());
    expect(r.ok, r.message).toBe(true);
    const h = runAndCompareHsa('planR_hsaEarlyRetiree', planR_hsaEarlyRetiree());
    expect(h.ok, h.message).toBe(true);
  });

  it('Plan R really exercises the HSA: retiree contributions, receipts, qualified payments and the survivor merge', () => {
    const rows = runProjection(planR_hsaEarlyRetiree()).rows;
    expect(rows.filter((r) => r.hsaContribRet > 0).map((r) => r.ageA)).toEqual([55, 56, 57, 58, 59, 60, 61, 62, 63, 64]);
    expect(rows.some((r) => r.hsaReceiptsBal > 22_000)).toBe(true);           // bills paid elsewhere before 65
    expect(rows.find((r) => r.ageA === 64)!.hsaQualifiedWD).toBe(0);
    expect(rows.find((r) => r.ageA === 65)!.hsaQualifiedWD).toBeGreaterThan(0);
    expect(rows.some((r) => r.acaPremium > 0)).toBe(true);
    expect(rows.some((r) => r.phase === 'Survivor' && r.endHSA > 0)).toBe(true);
    expect(rows.every((r) => r.hsaNonQualWD === 0 && r.hsaPenalty === 0)).toBe(true);
  });

  it('Plan S — TIPS ladder: taxable bridge rungs, IRA and Roth rungs, ACA, survivor rung', () => {
    const r = runAndCompare('planS_tipsLadder', planS_tipsLadder());
    expect(r.ok, r.message).toBe(true);
    const t = runAndCompareTips('planS_tipsLadder', planS_tipsLadder());
    expect(t.ok, t.message).toBe(true);
  });

  it('Plan S really exercises the ladder: phantom income, IRA and Roth cash, the RMD base and the survivor rung', () => {
    const rows = runProjection(planS_tipsLadder()).rows;
    const byYear = (y: number) => rows[y - 2026];
    // taxable rungs: indexation and coupons are taxed (federal only), and the ACA income carries them
    expect(rows.filter((r) => r.tipsOrdInc > 0 && r.tipsCash > 0).length).toBeGreaterThanOrEqual(6);
    expect(rows.some((r) => r.acaPremium > 0 && r.tipsOrdInc > 0)).toBe(true);
    // the 2027 rung pays out at maturity: 40,000 x (1.025)^2 above its 36,500 par, so no floor bonus
    expect(byYear(2027).tipsMaturity).toBeGreaterThan(40_000);
    expect(byYear(2027).tipsFloorBonus).toBe(0);
    // IRA and Roth rungs pay back into their accounts
    expect(byYear(2033).tipsToTrad).toBeGreaterThan(50_000);
    expect(byYear(2030).tipsToRoth).toBeGreaterThan(25_000);
    // A dies at 85 (2051); the 2055 rung is then held in B's IRA and counts in B's RMD base
    const survivor = rows.filter((r) => r.phase === 'Survivor' && r.year + 2025 < 2055);
    expect(survivor.length).toBeGreaterThan(0);
    expect(survivor.every((r) => r.endTipsTrad > 0)).toBe(true);
    expect(rows.some((r) => r.rmd > 0)).toBe(true);
    expect(rows.every((r) => r.rmdUnmet === 0)).toBe(true);
    expect(rows[rows.length - 1].begTips).toBe(0);                     // everything has matured by the end
  });
});
