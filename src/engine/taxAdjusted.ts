import type { Assumptions } from '../schemas/plan';

/**
 * Extract the two flat effective haircut rates from plan assumptions.
 * Uses Partial<> because PlanSchema.parse is never called at runtime —
 * Zod .default() is documentation here, not a runtime guarantee.
 */
export function taxAdjustedRates(
  a: Partial<Pick<Assumptions, 'taxAdjOrdRate' | 'taxAdjLtcgRate'>> | undefined,
): { ordRate: number; ltcgRate: number } {
  return {
    ordRate:  a?.taxAdjOrdRate  ?? 0.22,
    ltcgRate: a?.taxAdjLtcgRate ?? 0.15,
  };
}

/**
 * After-tax liquidation value of the portfolio.
 *
 * Formula:
 *   endRoth                                      — already clean; untouched
 *   + basis                                      — basis = min(endTaxableBasis, endTaxable); already-taxed money
 *   + (endTaxable − basis) × (1 − ltcgRate)      — unrealized gain net of cap-gains tax
 *   + endTraditional × (1 − ordRate)             — full pre-tax balance net of ordinary tax
 *
 * Rates are blended effective rates on whole balances — not brackets.
 * No state tax, IRMAA, or NIIT is included; the breakdown modal discloses this.
 *
 * Extras (optional 7th argument, appended after the sum above so an absent argument is bit-identical):
 *   HSA: the part covered by receipts is reimbursable tax-free (Roth-like, D4); the rest is haircut at
 *        ordRate (D5: a non-spouse heir owes ordinary tax on it).
 *   preTax / clean: ladder money held in an IRA (haircut at ordRate) or in Roth/taxable-after-tax form
 *        (TIPS, Phase 3).
 *
 * Clamp: basis accretes unconditionally (dividends, exempt interest) while the
 * taxable balance can be zero or negative on low-return / bad Monte Carlo paths.
 * Without the clamp endTaxAdjusted can exceed endTotal, breaking invariants.
 */
export interface TaxAdjustedExtras {
  /** Combined ending HSA balance. */
  hsa?: number;
  /** Unreimbursed receipts on file; min(hsa, hsaReceipts) is treated as tax-free. */
  hsaReceipts?: number;
  /** Ending value of TIPS held in pre-tax accounts. */
  preTax?: number;
  /** Ending value of TIPS held in Roth or with taxes already paid. */
  clean?: number;
}

/** The part of an HSA balance the heir would owe ordinary tax on: everything above the receipts. */
export const hsaTaxableBalance = (hsa: number, receipts: number): number => hsa - Math.min(hsa, receipts);

export function taxAdjustedValue(
  endTaxable: number,
  endTaxableBasis: number,
  endTraditional: number,
  endRoth: number,
  ordRate: number,
  ltcgRate: number,
  extras?: TaxAdjustedExtras,
): number {
  const basis = Math.min(endTaxableBasis, endTaxable);
  const unrealizedGain = Math.max(0, endTaxable - basis);
  const core = (
    endRoth +
    basis +
    unrealizedGain * (1 - ltcgRate) +
    endTraditional * (1 - ordRate)
  );
  if (extras === undefined) return core;
  const hsa = extras.hsa ?? 0;
  const hsaExempt = Math.min(hsa, extras.hsaReceipts ?? 0);
  return core + (hsa - hsaExempt) * (1 - ordRate) + hsaExempt
    + (extras.preTax ?? 0) * (1 - ordRate) + (extras.clean ?? 0);
}
