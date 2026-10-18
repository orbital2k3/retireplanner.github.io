import type { Plan } from '../schemas/plan';
import { runProjection, type ProjectionRow } from './projection';
import { resolveStrategy } from './strategy/resultSettings';
import { rmdCashOf } from './qcd';
import { fmtFull } from '../lib/format';

/** "Tax saved by QCD": the same plan (same withdrawal policy, same giving) projected twice, once with
 *  gifts paid as QCDs and once with the same gifts paid in cash (`disableQCD`), and diffed.
 *  Every figure is in today's dollars. Memoize on the caller's side, like `comparison.ts`. */
export interface QcdBenefit {
  /** Lifetime QCDs paid, today's $. */
  totalQcd: number;
  firstQcdAge: number;
  /** First year's QCD, today's $. */
  firstQcd: number;
  /** Lifetime federal + state + IRMAA + NIIT + ACA premium saved (positive = QCD pays less). */
  taxSaved: number;
  parts: { fed: number; state: number; irmaa: number; niit: number; aca: number };
  /** Share of the required withdrawals, in the years a QCD was paid, that the QCD satisfied (0..1). */
  rmdCoveredShare: number;
  /** True when taxable Social Security is lower over the plan with QCDs. */
  lowersTaxableSS: boolean;
  /** Years with an IRMAA surcharge without QCDs but none with them. */
  irmaaYearsAvoided: number;
}

const real = (n: number, r: ProjectionRow) => n / r.inflationFactor;
const sum = (rows: ProjectionRow[], f: (r: ProjectionRow) => number) => rows.reduce((s, r) => s + real(f(r), r), 0);

/** Taxable Social Security backed out of ordIncome (the row doesn't carry it on its own). */
const taxableSsOf = (r: ProjectionRow) =>
  Math.max(0, r.ordIncome - (r.otherIncomeTaxable + r.wdTrd + rmdCashOf(r) + r.rothConv + r.lumpSumOrdinaryIncome + r.ordinaryDiv));

/** Compare QCDs with paying the same gifts in cash. Returns null when the plan pays no QCDs. */
export function compareWithWithoutQCD(livePlan: Plan): QcdBenefit | null {
  const plan = resolveStrategy(livePlan);
  const on = runProjection(plan);
  const qcdRows = on.rows.filter((r) => r.qcd > 0);
  if (qcdRows.length === 0) return null;
  const off = runProjection(plan, { disableQCD: true });

  const n = Math.min(on.rows.length, off.rows.length);
  const a = on.rows.slice(0, n), b = off.rows.slice(0, n);
  const part = (f: (r: ProjectionRow) => number) => sum(b, f) - sum(a, f);
  const parts = {
    fed: part((r) => r.fedTax),
    state: part((r) => r.stateTaxAmt),
    irmaa: part((r) => r.irmaa),
    niit: part((r) => r.niit),
    aca: part((r) => r.acaPremium),
  };

  const rmdInQcdYears = sum(qcdRows, (r) => r.rmd);
  const rmdSatisfied = sum(qcdRows, (r) => r.qcd - r.qcdBeyondRmd);
  let irmaaYearsAvoided = 0;
  for (let i = 0; i < n; i++) if (b[i].irmaa > 0 && a[i].irmaa <= 0) irmaaYearsAvoided++;

  return {
    totalQcd: sum(on.rows, (r) => r.qcd),
    firstQcdAge: qcdRows[0].ageA,
    firstQcd: real(qcdRows[0].qcd, qcdRows[0]),
    taxSaved: parts.fed + parts.state + parts.irmaa + parts.niit + parts.aca,
    parts,
    rmdCoveredShare: rmdInQcdYears > 0 ? Math.min(1, rmdSatisfied / rmdInQcdYears) : 0,
    lowersTaxableSS: sum(b, taxableSsOf) - sum(a, taxableSsOf) > 1,
    irmaaYearsAvoided,
  };
}

const round100 = (n: number) => Math.round(n / 100) * 100;

/** Title and body for the Taxes-page card. */
export function qcdBenefitCopy(b: QcdBenefit): { title: string; body: string } {
  const saved = b.taxSaved >= 100;
  const title = saved
    ? `QCDs save you ${fmtFull(round100(b.taxSaved))} in lifetime taxes (today's $)`
    : "QCDs don't change your lifetime taxes much (today's $)";
  const bits: string[] = [];
  if (b.rmdCoveredShare > 0.005) bits.push(`That covers ${Math.round(b.rmdCoveredShare * 100)}% of your required withdrawals`);
  if (b.lowersTaxableSS) bits.push('lowers taxable Social Security');
  if (b.irmaaYearsAvoided > 0) bits.push(`keeps you out of IRMAA surcharges in ${b.irmaaYearsAvoided} ${b.irmaaYearsAvoided === 1 ? 'year' : 'years'}`);
  const lead = `From age ${b.firstQcdAge}, ${fmtFull(round100(b.firstQcd))} a year of your giving goes straight from your IRA to charity.`;
  const effects = bits.length === 0 ? '' : ' ' + (bits.length === 1 ? bits[0] : `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}`) + '.';
  return { title, body: `${lead}${effects} Same withdrawal plan, compared with paying the same gifts in cash.` };
}
