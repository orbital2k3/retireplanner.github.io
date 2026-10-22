import { describe, it, expect } from 'vitest';
import { legacyRule } from './legacy';
import { runProjection } from '../../projection';
import { planE_allRothCouple, planA_simple, planR_hsaEarlyRetiree } from '../../__golden/plans';

describe('legacyRule', () => {
  it('fires for an all-Roth couple with substantial ending balance', () => {
    const plan = planE_allRothCouple();
    const proj = runProjection(plan);
    const insight = legacyRule({ plan, proj });
    expect(insight).not.toBeNull();
    expect(insight!.title).toMatch(/Tax-free legacy/);
    // All-Roth couple: end Roth should be the dominant share.
    expect(insight!.body).toMatch(/Roth/);
  });

  it('returns a non-null insight as long as plan funds through with material end balance', () => {
    const plan = planA_simple();
    const proj = runProjection(plan);
    const insight = legacyRule({ plan, proj });
    if (!proj.ranOut && proj.endTotalReal >= 100_000) {
      expect(insight).not.toBeNull();
    }
  });

  it('counts receipt-backed HSA money as tax-free and tells the user to claim the receipts before death', () => {
    const plan = planR_hsaEarlyRetiree();
    const proj = runProjection(plan);
    const last = proj.rows[proj.rows.length - 1];
    expect(Math.min(last.endHSA, last.hsaReceiptsBal)).toBeGreaterThan(0);
    const insight = legacyRule({ plan, proj });
    expect(insight!.body).toMatch(/backed by medical receipts/);
    expect(insight!.body).toMatch(/Claim those receipts before you die/);
  });

  it('has no receipts note without an HSA', () => {
    const plan = planE_allRothCouple();
    expect(legacyRule({ plan, proj: runProjection(plan) })!.body).not.toMatch(/receipts/);
  });
});
