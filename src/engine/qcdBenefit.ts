import type { Plan } from '../schemas/plan';
import { runProjection, type ProjectionRow } from './projection';
import { resolveStrategy } from './strategy/resultSettings';
import { fmtFull } from '../lib/format';

/** "Tax saved by QCD": the same plan (same withdrawal policy, same giving) projected twice, once with
 *  gifts paid as QCDs and once with the same gifts paid in cash (`disableQCD`), and diffed. The cash run
 *  keeps the QCD run's Roth conversions (`conversionOverrides`): a bracket-fill or optimizer mode would
 *  otherwise re-size them, and the difference would net out conversions instead of measuring the QCD.
 *  Every figure is in today's dollars. Memoize on the caller's side, like `comparison.ts`. */
export interface QcdBenefit {
  /** Lifetime QCDs paid, today's $. */
  totalQcd: number;
  /** Age of the spouse who pays the first QCD, and that spouse's name in a couple (undefined when single). */
  firstQcdAge: number;
  firstQcdName?: string;
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

/** Taxable Social Security (the row doesn't carry it on its own), from acaMagi = magi + exempt interest
 *  + the untaxed part of SS. Exact whatever else is in ordinary income (TIPS, HSA draws). */
const taxableSsOf = (r: ProjectionRow) => Math.max(0, r.totalSS + r.magi + r.exemptInterest - r.acaMagi);

/** Compare QCDs with paying the same gifts in cash. Returns null when the plan pays no QCDs. */
export function compareWithWithoutQCD(livePlan: Plan): QcdBenefit | null {
  const plan = resolveStrategy(livePlan);
  const on = runProjection(plan);
  const qcdRows = on.rows.filter((r) => r.qcd > 0);
  if (qcdRows.length === 0) return null;
  const off = runProjection(plan, { disableQCD: true, conversionOverrides: on.rows.map((r) => r.rothConv) });

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

  const first = qcdRows[0];
  const byB = first.qcdB > first.qcd / 2 && first.ageB !== undefined;
  return {
    totalQcd: sum(on.rows, (r) => r.qcd),
    firstQcdAge: byB ? first.ageB! : first.ageA,
    firstQcdName: plan.personB ? (byB ? plan.personB.name || 'Person B' : plan.personA.name || 'Person A') : undefined,
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
  const from = b.firstQcdName ? `Once ${b.firstQcdName} is ${b.firstQcdAge}` : `From age ${b.firstQcdAge}`;
  const lead = `${from}, ${fmtFull(round100(b.firstQcd))} a year of your giving goes straight from an IRA to charity.`;
  const effects = bits.length === 0 ? '' : ' ' + (bits.length === 1 ? bits[0] : `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}`) + '.';
  return { title, body: `${lead}${effects} Compared with paying the same gifts in cash, with the same withdrawal plan and Roth conversions.` };
}
