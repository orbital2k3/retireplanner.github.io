import type { Insight, InsightContext } from '../index';
import { fmtUSD } from '../../../lib/format';

/** Reports that the HSA is paying medical bills and Medicare surcharges. Fires only when the projection has
 *  qualified HSA payments, so it never claims a benefit the plan doesn't get. */
export function hsaRule(ctx: InsightContext): Insight | null {
  const { proj } = ctx;
  const rows = proj.rows.filter((r) => r.hsaQualifiedWD > 0);
  if (rows.length === 0) return null;
  const total = rows.reduce((s, r) => s + r.hsaQualifiedWD / r.inflationFactor, 0);
  const irmaa = rows.reduce((s, r) => s + Math.max(0, r.hsaQualifiedWD - r.medicalSpend) / r.inflationFactor, 0);
  const first = rows[0];
  return {
    id: 'hsaQualified',
    surfaces: ['taxes', 'strategy'],
    severity: 'info',
    priority: 55,
    title: `Your HSA covers ${irmaa >= 1 ? 'Medicare surcharges and ' : ''}medical bills from ${first.ageA}`,
    body: `${fmtUSD(total)} (today's $) of medical costs is paid tax-free from your HSA, so it never counts as income. The HSA is used before your other accounts for those bills.`,
    evidence: `${rows.length} year${rows.length === 1 ? '' : 's'} with HSA payments.`,
  };
}
