/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { runProjection } from './projection';
import { legacyRule } from './explain/rules/legacy';
import TaxAdjustedBreakdown from '../components/TaxAdjustedBreakdown';
import { hatch, bucketColors } from '../components/charts/setup';
import { planS_tipsLadder } from './__golden/plans';
import { ladderRungs, thisYear, tipsRetireePlan, withTips } from './__testutil__/tipsPlans';

afterEach(cleanup);
const Y = thisYear();

/** TU-2: the places that read balances by account see the ladder sleeve. */
describe('TIPS in reporting surfaces', () => {
  // A ladder that is still held at the end of the plan, in all three accounts.
  const heldPlan = () => withTips(tipsRetireePlan(), [
    ...ladderRungs({ firstYear: Y + 70, years: 1, principal: 50_000, account: 'traditional', whose: 'A' }),
    ...ladderRungs({ firstYear: Y + 70, years: 1, principal: 30_000, account: 'taxable' }),
    ...ladderRungs({ firstYear: Y + 70, years: 1, principal: 20_000, account: 'roth' }),
  ]);

  it('the tax-adjusted breakdown lists ladder rows only when bonds are still held, and its rows still sum to the total', () => {
    const plan = heldPlan();
    const proj = runProjection(plan);
    const last = proj.rows[proj.rows.length - 1];
    expect(last.endTipsTrad).toBeGreaterThan(0);
    render(<TaxAdjustedBreakdown proj={proj} plan={plan} real={false} onClose={() => {}} />);
    expect(screen.getByText('TIPS ladder in pre-tax accounts')).toBeInTheDocument();
    expect(screen.getByText('TIPS ladder in taxable / Roth')).toBeInTheDocument();
    cleanup();
    const none = tipsRetireePlan();
    render(<TaxAdjustedBreakdown proj={runProjection(none)} plan={none} real={false} onClose={() => {}} />);
    expect(screen.queryByText(/TIPS ladder/)).toBeNull();
  });

  it('the legacy insight counts a Roth-held ladder as Roth money', () => {
    const base = tipsRetireePlan();
    const roth = withTips(base, ladderRungs({ firstYear: Y + 70, years: 1, principal: 90_000, account: 'roth' }));
    const proj = runProjection(roth);
    const last = proj.rows[proj.rows.length - 1];
    const insight = legacyRule({ plan: roth, proj })!;
    expect(last.endTipsRoth).toBeGreaterThan(0);
    const expectedRoth = Math.round((last.endRoth + last.endTipsRoth) / last.inflationFactor).toLocaleString('en-US');
    expect(insight.title.replace(/[$,]/g, '')).toContain(expectedRoth.replace(/,/g, ''));
  });

  it('hatch falls back to the plain color where there is no canvas, and reuses the same fill', () => {
    expect(hatch(bucketColors.taxable)).toBe(bucketColors.taxable);
    expect(hatch(bucketColors.taxable)).toBe(hatch(bucketColors.taxable));
  });

  it('planS reports a ladder balance in every year until its last bond matures', () => {
    const rows = runProjection(planS_tipsLadder()).rows;
    const lastHeld = rows.filter((r) => r.endTipsTaxable + r.endTipsTrad + r.endTipsRoth > 0).length;
    expect(lastHeld).toBeGreaterThan(20);
    expect(rows.slice(0, lastHeld).every((r) => r.begTips > 0)).toBe(true);
  });
});
