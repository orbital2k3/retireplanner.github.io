import type { Insight, InsightContext } from '../index';
import { fmtUSD } from '../../../lib/format';

/** Reports that QCDs are paying part of the required withdrawals. Fires only when the projection
 *  pays QCDs that satisfy RMD dollars, so it never claims a benefit the plan doesn't get.
 *
 *  "Fewer conversions overall" is the effect the optimizer tests measure (qcd.optimizer.test.ts), so it is
 *  said only when the optimizer sizes the conversions: under bracket-fill a QCD frees bracket room and the
 *  plan converts more. The copy deliberately does not say "fewer conversions before 70½". */
export function qcdRule(ctx: InsightContext): Insight | null {
  const { plan, proj } = ctx;
  const qcdRows = proj.rows.filter((r) => r.qcd > 0);
  if (qcdRows.length === 0) return null;

  const rmdInQcdYears = qcdRows.reduce((s, r) => s + r.rmd, 0);
  const satisfied = qcdRows.reduce((s, r) => s + (r.qcd - r.qcdBeyondRmd), 0);
  if (satisfied <= 0 || rmdInQcdYears <= 0) return null;

  const share = Math.min(1, satisfied / rmdInQcdYears);
  const first = qcdRows[0];
  const firstReal = first.qcd / first.inflationFactor;
  const byB = first.qcdB > first.qcd / 2 && first.ageB !== undefined;
  const from = plan.personB
    ? `once ${byB ? plan.personB.name || 'Person B' : plan.personA.name || 'Person A'} is ${byB ? first.ageB : first.ageA}`
    : `from age ${first.ageA}`;
  const optimizerConverts = (plan.conversion.optimize ?? true) && (plan.customPolicy?.windows ?? []).some((w) => w.convAmt != null);
  return {
    id: 'qcdRmd',
    surfaces: ['taxes', 'strategy'],
    severity: 'info',
    priority: 60,
    title: 'QCDs cut your required-withdrawal tax',
    body: `Paying ${fmtUSD(firstReal)} a year of your giving straight from an IRA (${from}) covers ${Math.round(share * 100)}% of your required withdrawals in those years without adding to taxable income.`
      + (optimizerConverts ? ' That also leaves less pre-tax money to convert, so the optimizer usually schedules fewer Roth conversions overall.' : ''),
    evidence: `${qcdRows.length} year${qcdRows.length === 1 ? '' : 's'} with a QCD.`,
  };
}
