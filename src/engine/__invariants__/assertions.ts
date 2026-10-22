import type { Plan } from '../../schemas/plan';
import type { ProjectionRow, ProjectionResult } from '../projection';
import { runProjection } from '../projection';
import { rmdStartAgeForDob } from '../rmd';
import { qcdLimit } from '../qcd';
import { OBBBA_NONITEMIZER_CHARITY } from '../taxConstants';
import { taxAdjustedRates } from '../taxAdjusted';

/**
 * Per-row dollar-flow invariants. Each row's bucket motion is independently checked
 * so a violation points at the exact year + bucket where the math diverged.
 *
 * Returns a list of human-readable violations (empty if the row is clean).
 */
function checkRow(r: ProjectionRow, plan: Plan, tol: number, opts: { skipSpendingCoverage?: boolean } = {}): string[] {
  const out: string[] = [];

  // Derive retirement flags the same way projection.ts does.
  // Single-person: retiredB mirrors retiredA (no second earner) — matches projection.ts.
  const retiredA = r.ageA >= plan.personA.retirementAge;
  const retiredB = r.ageB !== undefined && plan.personB
    ? r.ageB >= plan.personB.retirementAge
    : retiredA;
  const semiRetired = retiredA || retiredB;

  // Per-bucket growth rates (no retirement-phase switching; each bucket has its own rate).
  const gRateTax = plan.assumptions.taxableReturn;
  const gRateTrad = plan.assumptions.tradReturn;
  const gRateRoth = plan.assumptions.rothReturn;
  const gRateHsa = plan.assumptions.hsaReturn ?? plan.assumptions.tradReturn;

  // Derive contributions per bucket from the plan's contribSplit and the row's contribA/contribB.
  // Spousal IRA contributions (the spousalA/spousalB portion of contribA/contribB) bypass
  // contribSplit and land wholly in the elected IRA type, so they are netted out first and
  // routed separately — mirroring bucketize() in projection.ts.
  const pfA = plan.portfolio.personA;
  const pfB = plan.portfolio.personB;
  const spA = r.spousalA ?? 0, spB = r.spousalB ?? 0;
  const ownA = r.contribA - spA, ownB = r.contribB - spB;
  const spTradA = pfA.spousalTarget === 'roth' ? 0 : spA;
  const spTradB = pfB?.spousalTarget === 'roth' ? 0 : spB;
  // TIPS coupons and maturities from IRA and Roth rungs return to those accounts like a contribution.
  const tipsToTrad = r.tipsToTrad ?? 0, tipsToRoth = r.tipsToRoth ?? 0;
  const contribToTax = ownA * pfA.contribSplit.taxable + ownB * (pfB?.contribSplit.taxable ?? 0);
  const contribToTrad = ownA * pfA.contribSplit.traditional + ownB * (pfB?.contribSplit.traditional ?? 0) + spTradA + spTradB + tipsToTrad;
  const contribToRoth = ownA * pfA.contribSplit.roth + ownB * (pfB?.contribSplit.roth ?? 0) + (spA - spTradA) + (spB - spTradB) + tipsToRoth;

  // 1. NO-OVERDRAW: total outflow per bucket must not exceed what's available (growth + contrib).
  //    Catches phantom withdrawals — bucket-A drained while withdrawal still claimed cash.
  //    An inherited IRA injected this year can fund its own forced distribution in the same year, so it
  //    counts toward what is available for the total outflow (not for the strategy draws alone).
  const tradAvail = r.begTraditional * (1 + gRateTrad) + contribToTrad;
  const tradDraws = r.wdTrd + r.rmd + (r.qcdBeyondRmd ?? 0) + r.rothConv;
  const tradOutflow = tradDraws + (r.lumpSumForcedTradDist ?? 0);
  if (tradDraws > tradAvail + tol || tradOutflow > tradAvail + (r.lumpSumInjectTrad ?? 0) + tol) {
    out.push(`Trad OVERDRAW: outflow $${tradOutflow.toFixed(2)} > available $${tradAvail.toFixed(2)} (wdTrd=${r.wdTrd.toFixed(2)} + rmd=${r.rmd.toFixed(2)} + qcdBeyondRmd=${(r.qcdBeyondRmd ?? 0).toFixed(2)} + conv=${r.rothConv.toFixed(2)} + forcedTrad=${(r.lumpSumForcedTradDist ?? 0).toFixed(2)} vs begTrad*(1+g)+contribTrad)`);
  }
  const rothAvail = r.begRoth * (1 + gRateRoth) + contribToRoth + r.rothConv;
  const rothOutflow = r.wdRth + (r.lumpSumForcedRothDist ?? 0);
  if (r.wdRth > rothAvail + tol || rothOutflow > rothAvail + (r.lumpSumInjectRoth ?? 0) + tol) {
    out.push(`Roth OVERDRAW: outflow $${rothOutflow.toFixed(2)} > available $${rothAvail.toFixed(2)} (wdRth=${r.wdRth.toFixed(2)} + forcedRoth=${(r.lumpSumForcedRothDist ?? 0).toFixed(2)})`);
  }
  const taxAvail = r.begTaxable * (1 + gRateTax) + contribToTax;
  if (r.wdTax > taxAvail + tol) {
    out.push(`Taxable OVERDRAW: wdTax $${r.wdTax.toFixed(2)} > available $${taxAvail.toFixed(2)}`);
  }

  // 2. MASS BALANCE: end-of-year balance must match the bucket-update arithmetic
  //    when no clamping occurred. Pinpoints both subtle update bugs and validates
  //    that the conversion symmetry (trad - conv = -delta, roth + conv = +delta) holds.
  const expectedEndTrad = Math.max(0, r.begTraditional * (1 + gRateTrad) + contribToTrad - r.wdTrd - r.rmd - (r.qcdBeyondRmd ?? 0) - r.rothConv) + (r.lumpSumInjectTrad ?? 0) - (r.lumpSumForcedTradDist ?? 0);
  if (Math.abs(r.endTraditional - expectedEndTrad) > tol) {
    out.push(`Trad MASS BALANCE: endTraditional $${r.endTraditional.toFixed(2)} != expected $${expectedEndTrad.toFixed(2)} (delta $${(r.endTraditional - expectedEndTrad).toFixed(2)})`);
  }
  const expectedEndRoth = Math.max(0, r.begRoth * (1 + gRateRoth) + contribToRoth - r.wdRth + r.rothConv) + (r.lumpSumInjectRoth ?? 0) - (r.lumpSumForcedRothDist ?? 0);
  if (Math.abs(r.endRoth - expectedEndRoth) > tol) {
    out.push(`Roth MASS BALANCE: endRoth $${r.endRoth.toFixed(2)} != expected $${expectedEndRoth.toFixed(2)}`);
  }
  const inhTrd = (r.inheritedBal ?? 0) - (r.inheritedRothBal ?? 0);
  if (inhTrd > r.endTraditional + tol) out.push(`Inherited pre-tax $${inhTrd.toFixed(2)} > endTraditional $${r.endTraditional.toFixed(2)}`);
  if ((r.inheritedRothBal ?? 0) > r.endRoth + tol) out.push(`Inherited Roth $${(r.inheritedRothBal ?? 0).toFixed(2)} > endRoth $${r.endRoth.toFixed(2)}`);
  const expectedEndTax = Math.max(0, r.begTaxable * (1 + gRateTax) + contribToTax - r.wdTax - (r.distributedCash ?? 0)) + (r.lumpSumInjectTaxable ?? 0) + (r.cashSurplus ?? 0);
  if (Math.abs(r.endTaxable - expectedEndTax) > tol) {
    out.push(`Taxable MASS BALANCE: endTaxable $${r.endTaxable.toFixed(2)} != expected $${expectedEndTax.toFixed(2)}`);
  }

  // 2b. HSA: no overdraw and mass balance. Every draw (qualified, reimbursed, non-qualified) comes out of
  //     the owners' accounts, which grow at hsaReturn and take this year's contribution.
  const hsaBeg = r.begHSA ?? 0, hsaEnd = r.endHSA ?? 0, hsaIn = r.hsaContrib ?? 0;
  const hsaQual = r.hsaQualifiedWD ?? 0, hsaReimb = r.hsaReimbursed ?? 0, hsaNonQual = r.hsaNonQualWD ?? 0;
  const hsaDraws = hsaQual + hsaReimb + hsaNonQual;
  const hsaAvail = hsaBeg * (1 + gRateHsa) + hsaIn;
  if (hsaDraws > hsaAvail + tol) {
    out.push(`HSA OVERDRAW: draws $${hsaDraws.toFixed(2)} > available $${hsaAvail.toFixed(2)} (qualified=${hsaQual.toFixed(2)}, reimbursed=${hsaReimb.toFixed(2)}, nonQual=${hsaNonQual.toFixed(2)})`);
  }
  const expectedEndHsa = Math.max(0, hsaAvail - hsaDraws);
  if (Math.abs(hsaEnd - expectedEndHsa) > tol) {
    out.push(`HSA MASS BALANCE: endHSA $${hsaEnd.toFixed(2)} != expected $${expectedEndHsa.toFixed(2)}`);
  }
  if (hsaEnd < -tol || hsaQual < -tol || hsaReimb < -tol || hsaNonQual < -tol || (r.hsaPenalty ?? 0) < -tol || (r.hsaReceiptsBal ?? 0) < -tol) {
    out.push(`HSA negative field: end=${hsaEnd}, qualified=${hsaQual}, reimbursed=${hsaReimb}, nonQual=${hsaNonQual}, penalty=${r.hsaPenalty}, receipts=${r.hsaReceiptsBal}`);
  }
  // Qualified spending is bounded by what was qualified to pay: the year's medical bills plus IRMAA.
  if (hsaQual > r.medicalSpend + r.irmaa + tol) {
    out.push(`HSA paid more than the qualified need: qualified=${hsaQual}, medical=${r.medicalSpend}, irmaa=${r.irmaa}`);
  }
  // The 20% penalty applies to non-qualified draws by owners under 65 only.
  const hsaPenalty = r.hsaPenalty ?? 0;
  if (hsaPenalty > 0.2 * hsaNonQual + tol) {
    out.push(`HSA penalty $${hsaPenalty.toFixed(2)} exceeds 20% of non-qualified draws $${hsaNonQual.toFixed(2)}`);
  }
  if (r.ageA >= 65 && (r.ageB === undefined || r.ageB >= 65) && hsaPenalty > tol) {
    out.push(`HSA penalty charged when every owner is 65+: ${hsaPenalty}`);
  }

  // 2c. A retiree's contribution is part of the total, only before Medicare, and never negative.
  const hsaRet = r.hsaContribRet ?? 0;
  if (hsaRet < -tol || hsaRet > hsaIn + tol) {
    out.push(`HSA retiree contribution out of range: ret=${hsaRet}, total=${hsaIn}`);
  }
  if (hsaRet > tol && r.ageA >= 65 && (r.ageB === undefined || r.ageB >= 65)) {
    out.push(`HSA retiree contribution after Medicare: ${hsaRet} at ageA=${r.ageA}`);
  }

  // 2d. TIPS sleeve. Principal only moves by indexation (and the deflation floor at maturity) and leaves
  //     the sleeve only as a maturity payout; coupons and maturities go to taxable cash, an IRA or the
  //     Roth, so every dollar paid is accounted for exactly once.
  const tBeg = r.begTips ?? 0, tCoupon = r.tipsCoupon ?? 0, tAccrual = r.tipsAccrual ?? 0;
  const tMat = r.tipsMaturity ?? 0, tFloor = r.tipsFloorBonus ?? 0, tCash = r.tipsCash ?? 0;
  const tEnd = (r.endTipsTaxable ?? 0) + (r.endTipsTrad ?? 0) + (r.endTipsRoth ?? 0);
  if (Math.abs(tBeg + tAccrual + tFloor - (tEnd + tMat)) > tol) {
    out.push(`TIPS sleeve MASS BALANCE: beg $${tBeg.toFixed(2)} + accrual $${tAccrual.toFixed(2)} + floor $${tFloor.toFixed(2)} != end $${tEnd.toFixed(2)} + maturity $${tMat.toFixed(2)}`);
  }
  if (Math.abs(tCash + tipsToTrad + tipsToRoth - (tCoupon + tMat)) > tol) {
    out.push(`TIPS cash split: taxable $${tCash.toFixed(2)} + IRA $${tipsToTrad.toFixed(2)} + Roth $${tipsToRoth.toFixed(2)} != coupons $${tCoupon.toFixed(2)} + maturities $${tMat.toFixed(2)}`);
  }
  if (tBeg < -tol || tEnd < -tol || tCoupon < -tol || tMat < -tol || tFloor < -tol || tCash < -tol || tipsToTrad < -tol || tipsToRoth < -tol
    || (r.tipsOrdInc ?? 0) < -tol || (r.rmdUnmet ?? 0) < -tol) {
    out.push(`TIPS negative field: beg=${tBeg}, end=${tEnd}, coupon=${tCoupon}, maturity=${tMat}, cash=${tCash}, ordInc=${r.tipsOrdInc}, rmdUnmet=${r.rmdUnmet}`);
  }
  if (tFloor > tMat + tol) out.push(`TIPS floor bonus $${tFloor.toFixed(2)} exceeds the maturity payout $${tMat.toFixed(2)}`);
  // Taxable ladder income is coupons plus positive indexation plus the floor bonus; it can never be more,
  // and it is zero when no cash or sleeve sits in taxable.
  if ((r.tipsOrdInc ?? 0) > tCoupon + Math.max(0, tAccrual) + tFloor + tol) {
    out.push(`TIPS ordinary income $${(r.tipsOrdInc ?? 0).toFixed(2)} exceeds coupons + indexation + floor`);
  }
  if ((r.tipsOrdInc ?? 0) > tol && tCash <= tol && (r.endTipsTaxable ?? 0) <= tol) {
    out.push(`TIPS ordinary income $${(r.tipsOrdInc ?? 0).toFixed(2)} with no taxable rung`);
  }
  // An RMD is clamped to the liquid IRA money; when the clamp bound, the RMD paid cannot exceed it.
  if ((r.rmdUnmet ?? 0) > tol && r.rmd > r.begTraditional * (1 + gRateTrad) + contribToTrad + tol) {
    out.push(`RMD above the liquid IRA money while unmet is recorded: rmd=${r.rmd}, unmet=${r.rmdUnmet}`);
  }

  // 3. endTotal consistency
  const expectedEndTotal = r.endTaxable + r.endTraditional + r.endRoth + hsaEnd + tEnd;
  if (Math.abs(r.endTotal - expectedEndTotal) > tol) {
    out.push(`endTotal MISMATCH: $${r.endTotal.toFixed(2)} != sum-of-buckets $${expectedEndTotal.toFixed(2)}`);
  }

  // 3b. endTaxableBasis non-negative (basis can exceed balance but not go negative)
  if (r.endTaxableBasis < -tol) out.push(`endTaxableBasis negative: ${r.endTaxableBasis}`);

  // 4. TAX SANITY
  if (r.fedTax < -tol) out.push(`fedTax negative: ${r.fedTax}`);
  if (r.stateTaxAmt < -tol) out.push(`stateTax negative: ${r.stateTaxAmt}`);
  if (r.irmaa < -tol) out.push(`irmaa negative: ${r.irmaa}`);
  if (r.effRate < -0.001 || r.effRate > 0.50) out.push(`effRate out of range: ${r.effRate}`);

  // 5. WITHDRAWAL / RMD non-negativity
  if (r.wdTax < -tol) out.push(`wdTax negative: ${r.wdTax}`);
  if (r.wdTrd < -tol) out.push(`wdTrd negative: ${r.wdTrd}`);
  if (r.wdRth < -tol) out.push(`wdRth negative: ${r.wdRth}`);
  if (r.rmd < -tol) out.push(`rmd negative: ${r.rmd}`);
  if (r.rothConv < -tol) out.push(`rothConv negative: ${r.rothConv}`);

  // 6. RMD must be 0 before any alive person has reached their own SECURE 2.0 start age.
  const rmdStartAgeA = rmdStartAgeForDob(plan.personA.dob);
  const rmdStartAgeB = plan.personB ? rmdStartAgeForDob(plan.personB.dob) : rmdStartAgeA;
  const ageB = r.ageB;
  const aliveA = r.ageA <= plan.personA.planThroughAge;
  const aliveB = ageB !== undefined && plan.personB !== undefined && ageB <= plan.personB.planThroughAge;
  const aCanRMD = aliveA && r.ageA >= rmdStartAgeA;
  const bCanRMD = aliveB && ageB !== undefined && ageB >= rmdStartAgeB;
  if (!aCanRMD && !bCanRMD && r.rmd > tol) {
    out.push(`RMD before any person's rmdStartAge: ageA=${r.ageA} (start ${rmdStartAgeA}), ageB=${ageB ?? 'N/A'} (start ${rmdStartAgeB}), rmd=${r.rmd}`);
  }

  // 7. SPENDING COVERAGE (when either person is retired and portfolio not depleted).
  //    In SemiRetire, working person's contributions offset expense draws, so the coverage
  //    check still holds. Allow 5% slack for gross-up convergence drift.
  if (semiRetired && r.endTotal > 1 && !opts.skipSpendingCoverage) {
    const cashIn = r.wdTax + r.wdTrd + r.wdRth + r.totalSS + r.otherIncome + (r.distributedCash ?? 0) + r.rmd + (r.qcdBeyondRmd ?? 0) + (r.lumpSumOrdinaryIncome ?? 0) + (r.lumpSumForcedRothDist ?? 0) + hsaDraws + tCash;
    // A retiree's HSA contribution is paid from the portfolio like spending.
    const cashOut = r.netSpend + r.fedTax + r.stateTaxAmt + r.irmaa + hsaPenalty + (r.hsaContribRet ?? 0);
    // 5% slack: pathological first-retirement-year scenarios (high marginal-bracket
    // crossings combined with low starting balance) can have gross-up convergence
    // drift up to a few percent of cashOut. A missing tax category (e.g., forgetting
    // state tax in CA) would be >5%, so this slack still catches that class. Disable
    // via opts.skipSpendingCoverage in fuzz mode where pathological cases are common.
    const coverageSlack = Math.max(500, cashOut * 0.05);
    if (cashIn + coverageSlack < cashOut) {
      out.push(`SPENDING NOT COVERED: cash-in $${cashIn.toFixed(2)} < cash-out $${cashOut.toFixed(2)} (gap $${(cashOut - cashIn).toFixed(2)})`);
    }
  }

  // 7a. QCD: a qcd is charitable giving paid from an IRA, so it cannot exceed that year's charitable
  //     spend, is split into an RMD part and a beyond-RMD part, and is capped per person.
  const qcd = r.qcd ?? 0, qcdBeyond = r.qcdBeyondRmd ?? 0;
  if (qcd < -tol || qcdBeyond < -tol || qcdBeyond > qcd + tol) {
    out.push(`QCD fields inconsistent: qcd=${qcd}, qcdBeyondRmd=${qcdBeyond}`);
  }
  if (qcd > r.charitableSpend + tol) {
    out.push(`QCD exceeds charitable spend: qcd=${qcd}, charitable=${r.charitableSpend}`);
  }
  const qcdOwners = (aliveA ? 1 : 0) + (aliveB ? 1 : 0);
  if (qcd > qcdOwners * qcdLimit(r.inflationFactor) + tol) {
    out.push(`QCD above the annual limit: qcd=${qcd}, owners=${qcdOwners}, limit each=${qcdLimit(r.inflationFactor)}`);
  }

  const cd = r.charityDeduction ?? 0;
  if (cd < -tol || cd > (r.filingStatus === 'MFJ' ? OBBBA_NONITEMIZER_CHARITY.mfj : OBBBA_NONITEMIZER_CHARITY.single) + tol || cd > r.charitableSpend - qcd + tol) {
    out.push(`Charity deduction out of range: ${cd} (filing ${r.filingStatus}, charitable=${r.charitableSpend}, qcd=${qcd})`);
  }

  // 7b. Category split: tagged spending is a subset of total spending.
  if (r.medicalSpend < -tol || r.charitableSpend < -tol || r.medicalSpend + r.charitableSpend > r.netSpend + tol) {
    out.push(`Category spend exceeds netSpend: medical=${r.medicalSpend}, charitable=${r.charitableSpend}, netSpend=${r.netSpend}`);
  }

  // 8. Accum.-phase guard: when neither person is retired, no spend/withdrawals/conversions.
  //    SemiRetire (one retired) legitimately has netSpend, so gate on semiRetired.
  if (!semiRetired && (r.netSpend > tol || r.totalWD > tol || r.rothConv > tol)) {
    out.push(`Pre-retirement year has withdrawals/spend/conv: netSpend=${r.netSpend}, totalWD=${r.totalWD}, conv=${r.rothConv}`);
  }

  // 9. MAGI / IRMAA threshold sanity. IRMAA must be zero when nobody is 65+.
  const ageBOver65 = r.ageB !== undefined && r.ageB >= 65;
  const ageAOver65 = r.ageA >= 65;
  if (!ageAOver65 && !ageBOver65 && r.irmaa > tol) {
    out.push(`IRMAA nonzero when nobody is 65+: ageA=${r.ageA}, ageB=${r.ageB}, irmaa=${r.irmaa}`);
  }

  return out;
}

/**
 * Whole-portfolio cash conservation for retired years with no contributions, including years
 * where an account empties and depletion years (unfunded spending is added back as `shortfall`).
 * Forced inherited distributions are internal transfers that cancel; only external cash
 * (HSA = lumpSumOrdinaryIncome − lumpSumForcedTradDist) enters alongside SS/other income.
 */
export function assertPortfolioConservation(
  proj: ProjectionResult,
  plan: Plan,
  tol = 5,
): void {
  const a = plan.assumptions;
  for (const r of proj.rows) {
    if (r.ageA < plan.personA.retirementAge) continue;
    if (r.contribA !== 0 || r.contribB !== 0) continue;
    const grown = r.begTaxable * (1 + a.taxableReturn)
      + r.begTraditional * (1 + a.tradReturn)
      + r.begRoth * (1 + a.rothReturn)
      + (r.begHSA ?? 0) * (1 + (a.hsaReturn ?? a.tradReturn))
      // The TIPS sleeve does not earn the account return: it carries its own start value and gains only
      // by coupons, indexation and (at maturity) the deflation floor, which are new money.
      + (r.begTips ?? 0) + (r.tipsCoupon ?? 0) + (r.tipsAccrual ?? 0) + (r.tipsFloorBonus ?? 0);
    const acctInjects = (r.lumpSumInjectTaxable ?? 0) + (r.lumpSumInjectTrad ?? 0) + (r.lumpSumInjectRoth ?? 0);
    // Inherited-HSA lump sum (an event, not an owned account): external cash entering the household.
    const inheritedHsaCash = (r.lumpSumOrdinaryIncome ?? 0) - (r.lumpSumForcedTradDist ?? 0);
    // Contributions made while still working come from outside the portfolio (payroll); a contribution
    // paid by a retiree comes out of the portfolio and nets to zero, so only the external part enters.
    const hsaContribExt = (r.hsaContrib ?? 0) - (r.hsaContribRet ?? 0);
    const inflows = r.totalSS + r.otherIncome + acctInjects + inheritedHsaCash + hsaContribExt;
    // The 20% penalty leaves the household like a tax.
    const outflows = r.netSpend + r.fedTax + r.stateTaxAmt + r.irmaa + r.niit + (r.acaPremium ?? 0) + (r.hsaPenalty ?? 0);
    const expected = grown + inflows - outflows + (r.shortfall ?? 0);
    const leak = r.endTotal - expected;
    if (Math.abs(leak) > tol) {
      throw new Error(
        `Portfolio conservation failed at year ${r.year} (ageA=${r.ageA}): ` +
        `endTotal=$${r.endTotal.toFixed(0)} expected=$${expected.toFixed(0)} leak=$${leak.toFixed(0)}`
      );
    }
  }
}

/**
 * Top-level invariant check for a finished projection. Throws on first failing row
 * with a message that names the bucket/value and the year — so a single failure
 * is enough to root-cause.
 *
 * Note: assumes default returns (no returnOverrides). Caller in Monte Carlo paths
 * should validate per-row with caller-supplied gRates instead.
 */
export function assertProjectionInvariants(
  proj: ProjectionResult,
  plan: Plan,
  opts?: { tolerance?: number; skipSpendingCoverage?: boolean },
): void {
  const tol = opts?.tolerance ?? 1;
  if (proj.rows.length === 0) throw new Error('Projection produced zero rows');

  // Per-row checks.
  for (const r of proj.rows) {
    const violations = checkRow(r, plan, tol, { skipSpendingCoverage: opts?.skipSpendingCoverage });
    if (violations.length > 0) {
      throw new Error(
        `Projection invariant(s) failed at year ${r.year} (ageA=${r.ageA}${r.ageB !== undefined ? `, ageB=${r.ageB}` : ''}, phase=${r.phase}):\n` +
        violations.map((v) => `  • ${v}`).join('\n')
      );
    }
  }

  // Cross-row: ages monotonic.
  for (let i = 1; i < proj.rows.length; i++) {
    if (proj.rows[i].ageA !== proj.rows[i - 1].ageA + 1) {
      throw new Error(`ageA not monotonic at row ${i}: ${proj.rows[i - 1].ageA} → ${proj.rows[i].ageA}`);
    }
    if (proj.rows[i].ageB !== undefined && proj.rows[i - 1].ageB !== undefined) {
      if (proj.rows[i].ageB !== proj.rows[i - 1].ageB! + 1) {
        throw new Error(`ageB not monotonic at row ${i}: ${proj.rows[i - 1].ageB} → ${proj.rows[i].ageB}`);
      }
    }
  }

  // Cross-row: receipts are only reimbursed up to what was on file at the start of the year.
  const seedReceipts = (plan.portfolio.personA.hsaReceipts ?? 0) + (plan.portfolio.personB?.hsaReceipts ?? 0);
  for (let i = 0; i < proj.rows.length; i++) {
    const onFile = i === 0 ? seedReceipts : (proj.rows[i - 1].hsaReceiptsBal ?? 0);
    if ((proj.rows[i].hsaReimbursed ?? 0) > onFile + tol) {
      throw new Error(`HSA reimbursed $${proj.rows[i].hsaReimbursed} more than the receipts on file $${onFile} at year ${proj.rows[i].year}`);
    }
  }

  // Cross-row: the sleeve carries over, so each year opens with what the last one closed with.
  for (let i = 1; i < proj.rows.length; i++) {
    const prev = proj.rows[i - 1], cur = proj.rows[i];
    const prevEnd = (prev.endTipsTaxable ?? 0) + (prev.endTipsTrad ?? 0) + (prev.endTipsRoth ?? 0);
    if (Math.abs((cur.begTips ?? 0) - prevEnd) > tol) {
      throw new Error(`TIPS sleeve discontinuity at year ${cur.year}: begTips $${cur.begTips} != previous endTips $${prevEnd}`);
    }
  }

  // Cross-row: lifetimeFedTax = sum of fedTax across rows.
  const sumFedTax = proj.rows.reduce((s, r) => s + r.fedTax, 0);
  if (Math.abs(proj.lifetimeFedTax - sumFedTax) > Math.max(tol, proj.rows.length * tol)) {
    throw new Error(`lifetimeFedTax aggregate inconsistent: ${proj.lifetimeFedTax} vs row-sum ${sumFedTax}`);
  }
  const sumRMD = proj.rows.reduce((s, r) => s + r.rmd, 0);
  if (Math.abs(proj.lifetimeRMD - sumRMD) > Math.max(tol, proj.rows.length * tol)) {
    throw new Error(`lifetimeRMD aggregate inconsistent: ${proj.lifetimeRMD} vs row-sum ${sumRMD}`);
  }
  const sumConv = proj.rows.reduce((s, r) => s + r.rothConv, 0);
  if (Math.abs(proj.lifetimeConversion - sumConv) > Math.max(tol, proj.rows.length * tol)) {
    throw new Error(`lifetimeConversion aggregate inconsistent: ${proj.lifetimeConversion} vs row-sum ${sumConv}`);
  }

  // Tax-adjusted two-sided bound.
  // Upper: endTaxAdjustedReal <= endTotalReal (tax-adjusted can't exceed gross)
  if (proj.endTaxAdjustedReal > proj.endTotalReal + tol) {
    throw new Error(`endTaxAdjustedReal (${proj.endTaxAdjustedReal.toFixed(2)}) exceeds endTotalReal (${proj.endTotalReal.toFixed(2)})`);
  }
  // Lower: endTaxAdjustedReal >= endTotalReal * (1 - max(ordRate, ltcgRate)) approximately.
  //   Allow a 10% margin because the bucket mix is unknown at aggregate level.
  const { ordRate, ltcgRate } = taxAdjustedRates(plan.assumptions);
  const lowerFloor = proj.endTotalReal * (1 - Math.max(ordRate, ltcgRate)) - tol;
  if (proj.endTaxAdjustedReal < lowerFloor - proj.endTotalReal * 0.10) {
    throw new Error(`endTaxAdjustedReal (${proj.endTaxAdjustedReal.toFixed(2)}) below floor ${lowerFloor.toFixed(2)} (endTotalReal=${proj.endTotalReal.toFixed(2)}, maxRate=${Math.max(ordRate, ltcgRate)})`);
  }

  assertPortfolioConservation(proj, plan, Math.max(tol, 5));
}

/**
 * Determinism check: running the same plan twice produces byte-identical projection rows.
 * Catches any non-deterministic behavior introduced (Date.now(), Math.random(), iteration
 * order over Sets/Maps, etc.).
 */
export function assertDeterministic(plan: Plan, opts?: Parameters<typeof runProjection>[1]): void {
  const a = runProjection(plan, opts);
  const b = runProjection(plan, opts);
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) {
    // Find the first diverging row to point at the issue.
    for (let i = 0; i < a.rows.length; i++) {
      if (JSON.stringify(a.rows[i]) !== JSON.stringify(b.rows[i])) {
        throw new Error(`Projection nondeterministic at row ${i} (year ${a.rows[i].year}):\n  A: ${JSON.stringify(a.rows[i])}\n  B: ${JSON.stringify(b.rows[i])}`);
      }
    }
    throw new Error('Projection nondeterministic in aggregates (rows identical)');
  }
}

/** No fully round-tripped conversion: converting $X into an empty Roth and withdrawing the full
 *  amount back out in the same year repositions nothing while still taxing the conversion.
 *
 *  Deliberately separate from assertProjectionInvariants, which asserts conservation and
 *  arithmetic over *any* plan. A round trip is a strategy-quality defect, not a dollar-flow one:
 *  a plan configured with bracket-fill conversions plus a Roth-draining withdrawal order produces
 *  one legitimately, and the engine is modelling it faithfully. That configuration is surfaced to
 *  the user by the conv-roth-first-incoherent plan warning instead. What we do assert is that the
 *  *optimizer* never authors one, which is the regression this guards.
 *
 *  begRoth < 1 gates to an empty starting Roth: with existing principal the withdrawal may be
 *  drawing on that rather than the newly converted funds, which is legitimate. The $1k floor keeps
 *  degenerate sub-dollar conversions from tripping it.
 */
export function assertNoRoundTrippedConversions(proj: ProjectionResult): void {
  for (const r of proj.rows) {
    if (r.rothConv > 1000 && r.begRoth < 1 && r.wdRth >= r.rothConv) {
      throw new Error(
        `Fully round-tripped conversion at year ${r.year} (ageA=${r.ageA}): rothConv=${r.rothConv.toFixed(0)}, wdRth=${r.wdRth.toFixed(0)}, begRoth=0 — conversion was immediately withdrawn from an empty Roth, repositioning nothing.`
      );
    }
  }
}

/** No conversion year also draws from Roth. Once the optimizer's round-trip collapse has run, a
 *  year holds either a conversion or a Roth withdrawal, never both: where the conversion covered
 *  the draw the draw is moved to pre-tax, and where the draw exceeded the conversion the
 *  conversion is driven to zero.
 *
 *  Separate from the full-round-trip check above, which only fires when wdRth >= rothConv and so
 *  cannot see a small residue — a $2 draw beside a $57k conversion passes it while still being a
 *  round trip. That residue is exactly what a delta-based pctRoth adjustment leaves behind, since
 *  the split fractions apply to the spending gap rather than to total withdrawals.
 *
 *  The $1 floor on wdRth is deliberately tight; the point is to catch slivers, not just material
 *  amounts. Applies to optimizer output only, for the same reason as above.
 */
export function assertNoConcurrentConversionAndRothDraw(proj: ProjectionResult): void {
  for (const r of proj.rows) {
    if (r.rothConv > 1000 && r.wdRth > 1) {
      throw new Error(
        `Conversion and Roth withdrawal in the same year at year ${r.year} (ageA=${r.ageA}): rothConv=${r.rothConv.toFixed(0)}, wdRth=${r.wdRth.toFixed(2)} — the round-trip collapse left a residue; this year should hold one or the other, not both.`
      );
    }
  }
}
