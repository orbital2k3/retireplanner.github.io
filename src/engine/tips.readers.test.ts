import { describe, expect, it } from 'vitest';
import { runProjection } from './projection';
import { REC_GOALS } from './recommender';
import { taxRule } from './explain/rules/tax';
import { planA_simple } from './__golden/plans';
import { rung, thisYear, tipsIdlePlan, withTips } from './__testutil__/tipsPlans';

/** Part 3 item 7: account-value readers that must see the TIPS sleeve. */
describe('readers of account values with a ladder', () => {
  it("max-roth counts a Roth rung still held at the horizon; unchanged without a ladder", () => {
    const base = tipsIdlePlan({ roth: 300_000 });
    const horizon = runProjection(base).rows.length;
    const late = withTips(base, [rung({ maturityYear: thisYear() + horizon + 5, adjustedPrincipal: 100_000, account: 'roth' })]);
    const proj = runProjection(late);
    const last = proj.rows[proj.rows.length - 1];
    expect(last.endTipsRoth).toBeGreaterThan(0);
    expect(REC_GOALS['max-roth'].score(proj)).toBe((last.endRoth + last.endTipsRoth) / last.inflationFactor);
    const plain = runProjection(base), pl = plain.rows[plain.rows.length - 1];
    expect(REC_GOALS['max-roth'].score(plain)).toBe(pl.endRoth / pl.inflationFactor);
  });

  it('the lifetime-tax insight counts an on-top ladder in starting wealth, not a carved-out one', () => {
    const p = planA_simple();
    const rungs = [rung({ maturityYear: thisYear() + 3, adjustedPrincipal: 2_000_000, account: 'taxable' })];
    const pct = (plan: typeof p, proj: ReturnType<typeof runProjection>) => Number(taxRule({ plan, proj })!.title.match(/(\d+)%/)![1]);
    // Same projection, so only the starting-wealth denominator differs.
    const projOnTop = runProjection(withTips(p, rungs, false));
    expect(pct(withTips(p, rungs, false), projOnTop)).toBeLessThan(pct(p, projOnTop));
    const carved = withTips(p, rungs.map((r) => ({ ...r, adjustedPrincipal: 100_000 })));
    const projCarved = runProjection(carved);
    expect(pct(carved, projCarved)).toBe(pct(p, projCarved));
  });
});
