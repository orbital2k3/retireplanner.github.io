import type { Insight, InsightContext } from '../index';
import { fmtUSD } from '../../../lib/format';
import { hsaTaxableBalance } from '../../taxAdjusted';

const hsaTaxFree = (hsa: number, receipts: number): number => hsa - hsaTaxableBalance(hsa, receipts);

/** Surfaces end-of-plan balances, separating Roth (tax-free legacy) from other buckets. */
export function legacyRule(ctx: InsightContext): Insight | null {
  const { proj } = ctx;
  if (proj.rows.length === 0 || proj.ranOut) return null;
  const last = proj.rows[proj.rows.length - 1];
  const endRothReal = last.endRoth / last.inflationFactor;
  const endTotalReal = proj.endTotalReal;
  if (endTotalReal < 100_000) return null;
  // HSA money backed by receipts can be reimbursed tax-free, so it counts with the Roth money.
  const hsaFreeReal = hsaTaxFree(last.endHSA, last.hsaReceiptsBal) / last.inflationFactor;
  const taxFreeReal = endRothReal + hsaFreeReal;

  if (hsaFreeReal > 0) {
    const pct = endTotalReal > 0 ? Math.round((taxFreeReal / endTotalReal) * 100) : 0;
    return {
      id: 'legacyRoth',
      surfaces: ['dashboard', 'strategy'],
      severity: 'info',
      priority: 40,
      title: `Tax-free legacy: ${fmtUSD(taxFreeReal)}`,
      body: `Plan ends with ${fmtUSD(endTotalReal)} total (today's $). ${fmtUSD(endRothReal)} is Roth, and ${fmtUSD(hsaFreeReal)} of your HSA is backed by medical receipts you can claim tax-free. That's ${pct}% of the ending balance.`,
    };
  }

  const rothPct = endTotalReal > 0 ? Math.round((endRothReal / endTotalReal) * 100) : 0;
  return {
    id: 'legacyRoth',
    surfaces: ['dashboard', 'strategy'],
    severity: 'info',
    priority: 40,
    title: `Tax-free legacy: ${fmtUSD(endRothReal)}`,
    body: `Plan ends with ${fmtUSD(endTotalReal)} total (today's $), of which ${fmtUSD(endRothReal)} is Roth — passed tax-free to heirs. That's ${rothPct}% of the ending balance.`,
  };
}
