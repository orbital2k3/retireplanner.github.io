import { appendFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import fc from 'fast-check';
import { runProjection, type ProjectionRow } from '../projection';
import * as G from '../__golden/plans';
import { samplePlan, type Plan } from '../../schemas/plan';
import { arbTipsPlan } from '../__fuzz__/generators';
import { buildTipsLadder, builderFundingAvailable, type BuilderFunding } from '../tipsBuilder';
import { planWithoutLadder, resolveTipsLadder } from '../tipsLadder';
import { CPI_INFLATION, N_YEARS, START_YEAR } from '../marketHistory';
import { pinDate } from '../__regression__/snapshotUtil';
import { withTips, ladderRungs } from '../__testutil__/tipsPlans';

/** Part 3 open items of hsa-tips-qcd-plan.md (TIPS, after Phase 4). Research output (console tables), not a
 *  regression check. Run: HEAVY=1 pnpm vitest run --project opt src/engine/__study__/tipsOpenItems.study.test.ts */

pinDate();
/** Console output is not shown under the opt project, so findings go to STUDY_OUT (default: stderr). */
const log = (t: string) => { if (process.env.STUDY_OUT) appendFileSync(process.env.STUDY_OUT, t + '\n'); else process.stderr.write(t + '\n'); };
const Y = new Date().getFullYear();
const real = (rows: ProjectionRow[], f: (r: ProjectionRow) => number) => rows.reduce((s, r) => s + f(r) / r.inflationFactor, 0);
const stranded = (rows: ProjectionRow[]) => rows.filter((r) => r.shortfall > 1 && r.begTips > 0);
const goldens: Array<[string, () => Plan]> = [
  ['sample', samplePlan],
  ...Object.entries(G).filter(([k]) => k.startsWith('plan')).map(([k, f]) => [k, f as () => Plan] as [string, () => Plan]),
];

/** A plausible bridge ladder: 8 years from retirement (or now), from the largest liquid account, sized to
 *  40% of the first retired year's spending but never more than half that account. */
function withBridge(p: Plan): Plan | null {
  if (p.portfolio.tipsLadder) return null;
  const ageA = Y - Number(p.personA.dob.slice(0, 4));
  const from = Y + Math.max(0, p.personA.retirementAge - ageA);
  const opts: Array<[BuilderFunding, number]> = ([
    { account: 'taxable' }, { account: 'roth' }, { account: 'traditional', whose: 'A' }, { account: 'traditional', whose: 'B' },
  ] as BuilderFunding[]).map((f) => [f, builderFundingAvailable(p.portfolio, f, Y)]);
  const [funding, avail] = opts.sort((a, b) => b[1] - a[1])[0];
  if (avail <= 10_000) return null;
  const spend = runProjection(p).rows.find((r) => r.ageA >= p.personA.retirementAge)?.netSpend ?? 0;
  const row = runProjection(p).rows.find((r) => r.ageA >= p.personA.retirementAge);
  const spendReal = row ? spend / row.inflationFactor : 0;
  let income = Math.max(1000, 0.4 * spendReal);
  const unit = buildTipsLadder({ incomeReal: 1, fromYear: from, throughYear: from + 7, realYield: 0.019, funding, startYear: Y }).rows
    .reduce((s, r) => s + r.principal, 0) || 8 / 1.019;
  income = Math.min(income, (0.5 * avail) / Math.max(unit, 1e-9));
  const built = buildTipsLadder({ incomeReal: Math.round(income), fromYear: from, throughYear: from + 7, realYield: 0.019, funding, startYear: Y });
  return built.rungs.length ? withTips(p, built.rungs) : null;
}

describe('Part 3 TIPS open items', () => {
  it('item 1: stranded ladder (shortfall while bonds are held)', () => {
    const lines: string[] = [];
    let n = 0, strandedN = 0, causedN = 0;
    for (const [name, make] of goldens) {
      const p = make();
      const plans: Array<[string, Plan]> = [];
      if (p.portfolio.tipsLadder) plans.push([name, p]);
      const b = withBridge(p);
      if (b) plans.push([`${name}+bridge`, b]);
      for (const [label, q] of plans) {
        n++;
        const rows = runProjection(q).rows;
        const s = stranded(rows);
        const wo = planWithoutLadder(q, Y);
        const sfWith = runProjection(q).lifetimeShortfallReal;
        const sfWo = wo ? runProjection(wo).lifetimeShortfallReal : NaN;
        if (s.length) strandedN++;
        if (s.length && sfWith > sfWo + 1) causedN++;
        lines.push(`${label.padEnd(34)} strandedYears=${s.length} heldReal=${s.length ? Math.round(s[0].begTips / s[0].inflationFactor) : 0} shortfallWith=${Math.round(sfWith)} withoutLadder=${Math.round(sfWo)} rmdUnmetYears=${rows.filter((r) => r.rmdUnmet > 1).length}`);
      }
    }
    log(['ITEM 1 goldens', ...lines, `plans=${n} stranded=${strandedN} ladderCausedExtraShortfall=${causedN}`].join('\n'));

    // Fuzz: arbTipsPlan, all, and a "plausible" subset (every rung fits its account, ladder <= 50% of the
    // liquid total, and the same plan without the ladder is fully funded).
    const sample = fc.sample(arbTipsPlan(), { numRuns: 3000, seed: 20261020 });
    const stats = { all: 0, allStr: 0, plaus: 0, plausStr: 0, plausCaused: 0, caused: 0, extraReal: 0, plausExtraReal: 0 };
    for (const p of sample) {
      const lad = resolveTipsLadder(p.portfolio, Y);
      if (!lad) continue;
      const rows = runProjection(p).rows;
      const isStr = stranded(rows).length > 0;
      const wo = planWithoutLadder(p, Y);
      const sfWith = runProjection(p).lifetimeShortfallReal;
      const sfWo = wo ? runProjection(wo).lifetimeShortfallReal : sfWith;
      const caused = isStr && sfWith > sfWo + 1;
      const pf = p.portfolio;
      const liquid = pf.personA.taxable + pf.personA.traditional + pf.personA.roth + (pf.personB ? pf.personB.taxable + pf.personB.traditional + pf.personB.roth : 0);
      const total = lad.rungs.reduce((s, r) => s + r.adjustedPrincipal, 0);
      const entered = pf.tipsLadder!.rungs.filter((r) => r.maturityYear >= Y).reduce((s, r) => s + r.adjustedPrincipal, 0);
      const plausible = wo !== null && Math.abs(entered - total) < 1 && total <= 0.5 * liquid && sfWo < 1;
      stats.all++; if (isStr) stats.allStr++; if (caused) { stats.caused++; stats.extraReal += sfWith - sfWo; }
      if (plausible) { stats.plaus++; if (isStr) stats.plausStr++; if (caused) { stats.plausCaused++; stats.plausExtraReal += sfWith - sfWo; } }
    }
    log(`ITEM 1 fuzz ${JSON.stringify(stats)}`);
  });

  it('item 2: working-year phantom income is untaxed', () => {
    // How the engine treats other working-year taxable income: an Other stream while working.
    const a = G.planA_simple();
    const ageA = Y - Number(a.personA.dob.slice(0, 4));
    const work = { ...a, personA: { ...a.personA, retirementAge: ageA + 15 }, personB: a.personB && { ...a.personB, retirementAge: ageA + 15 } };
    const withOther: Plan = { ...work, incomeStreams: [...work.incomeStreams, { id: 'oth', description: 'Side income', whose: 'A', type: 'Other', startAge: ageA, end: { mode: 'age', age: ageA + 10 }, survivorPct: 0, annualAmount: 30_000, growthPct: { mode: 'cpi' }, taxablePct: 1, stateTaxablePct: 1 }] };
    const r0 = runProjection(work).rows[0], r1 = runProjection(withOther).rows[0];
    log(`ITEM 2 control: working year 0, phase=${r0.phase} fedTax ${Math.round(r0.fedTax)} -> ${Math.round(r1.fedTax)} with a $30k Other stream; ordIncome ${Math.round(r0.ordIncome)} -> ${Math.round(r1.ordIncome)}`);
    // A large taxable ladder held through 15 working years.
    const rungs = ladderRungs({ firstYear: Y + 16, years: 10, principal: 50_000, couponRate: 0.019, account: 'taxable' });
    const big: Plan = withTips({ ...work, portfolio: { ...work.portfolio, personA: { ...work.portfolio.personA, taxable: work.portfolio.personA.taxable + 500_000, taxableBasis: work.portfolio.personA.taxableBasis + 500_000 } } }, rungs);
    const rows = runProjection(big).rows;
    const pre = rows.filter((r) => r.phase === 'Accum.');
    const phantomReal = real(pre, (r) => Math.max(0, r.tipsCoupon + r.tipsAccrual));
    const taxedReal = real(pre, (r) => r.tipsOrdInc);
    log(`ITEM 2 ladder: working years=${pre.length}, untaxed ladder income (coupon + accrual, today's $)=${Math.round(phantomReal)}, of which taxed=${Math.round(taxedReal)}; at 22-24% that is ~${Math.round(phantomReal * 0.22)}-${Math.round(phantomReal * 0.24)} of federal tax; coupon cash ${Math.round(real(pre, (r) => r.tipsCoupon))}`);
  });

  it('item 3: year-end index convention vs start-of-year expense index', () => {
    const s = G.planS_tipsLadder();
    const rows = runProjection(s).rows;
    const pi = s.assumptions.inflation;
    const paid = real(rows, (r) => r.tipsCash + r.tipsToTrad + r.tipsToRoth);
    log(`ITEM 3 planS: ladder payments in start-of-year real $=${Math.round(paid)}; at start-of-year index they would be ${Math.round(paid / (1 + pi))}; overstatement ${Math.round(paid - paid / (1 + pi))} (${(100 * pi / (1 + pi)).toFixed(2)}%)`);
    // End-value effect, isolated from the carve-out: the same ladder on top of the balances, at full size
    // and scaled by 1/(1+pi) (what a start-of-year payout would be on a fixed-inflation path).
    const onTop = (k: number) => withTips(s, s.portfolio.tipsLadder!.rungs.map((r) => ({ ...r, adjustedPrincipal: r.adjustedPrincipal * k, ...(r.faceValue ? { faceValue: r.faceValue * k } : {}) })), false);
    const full = runProjection(onTop(1)), scaled = runProjection(onTop(1 / (1 + pi)));
    const base = runProjection(s);
    log(`ITEM 3 planS on-top: endTaxAdjReal full=${Math.round(full.endTaxAdjustedReal)} startOfYear=${Math.round(scaled.endTaxAdjustedReal)} diff=${Math.round(full.endTaxAdjustedReal - scaled.endTaxAdjustedReal)}; endTotalReal diff=${Math.round(full.endTotalReal - scaled.endTotalReal)}; carve-out planS endTaxAdjReal=${Math.round(base.endTaxAdjustedReal)} (${(100 * (full.endTaxAdjustedReal - scaled.endTaxAdjustedReal) / base.endTaxAdjustedReal).toFixed(2)}% of it)`);
  });

  it('item 4: faceValue default (adjusted principal) vs a real par below it, on historical CPI paths', () => {
    const s = G.planS_tipsLadder();
    const ladder = s.portfolio.tipsLadder!.rungs;
    const parAt = (k: number) => withTips(s, ladder.map((r) => ({ ...r, faceValue: r.adjustedPrincipal / k })));
    const asIs = withTips(s, ladder.map((r) => { const { faceValue: _f, ...x } = r; void _f; return x; }));
    let cohorts = 0, withFloorDefault = 0, withFloorPar = 0, bonusDefault = 0, bonusPar = 0, maxEndDiff = 0, endDiffSum = 0;
    const len = runProjection(s).rows.length;
    for (let c = 0; c < N_YEARS; c++) {
      const cpi = Array.from({ length: len }, (_, i) => CPI_INFLATION[(c + i) % N_YEARS]);
      const d = runProjection(asIs, { inflationOverrides: cpi });
      const p = runProjection(parAt(1.15), { inflationOverrides: cpi });
      cohorts++;
      const bd = real(d.rows, (r) => r.tipsFloorBonus), bp = real(p.rows, (r) => r.tipsFloorBonus);
      if (bd > 1) withFloorDefault++; if (bp > 1) withFloorPar++;
      bonusDefault += bd; bonusPar += bp;
      const diff = d.endTaxAdjustedReal - p.endTaxAdjustedReal;
      endDiffSum += diff; maxEndDiff = Math.max(maxEndDiff, diff);
      if (bd > 1 && c < 20) log(`  cohort ${START_YEAR + c}: floor bonus default=${Math.round(bd)} par/1.15=${Math.round(bp)} endTaxAdj diff=${Math.round(diff)}`);
    }
    const total = ladder.reduce((s2, r) => s2 + r.adjustedPrincipal, 0);
    log(`ITEM 4 planS (ladder ${Math.round(total)}): cohorts=${cohorts} (wrap-around), cohorts with a floor bonus: default=${withFloorDefault}, par=principal/1.15: ${withFloorPar}; mean bonus default=${Math.round(bonusDefault / cohorts)} par=${Math.round(bonusPar / cohorts)}; endTaxAdj diff mean=${Math.round(endDiffSum / cohorts)} max=${Math.round(maxEndDiff)}`);
  });
});
