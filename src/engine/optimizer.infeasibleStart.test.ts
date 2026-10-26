import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { optimizeStrategy } from './optimizer';
import { optimizerView } from './strategy/savedPlan';

/** The user's exported plan sits right at the edge of feasibility. Starting from a policy that runs out of money,
 *  every nearby policy also ran out, all scored $0, and the search never moved: the result was a placeholder that
 *  ran out even though a feasible strategy existed (one contribution level up, the same search found one). */
const PLAN_FILE = resolve(process.cwd(), 'retirement-optimizer-2026-10-26.json'); // git-ignored: real birth dates and balances
const exported = existsSync(PLAN_FILE) ? JSON.parse(readFileSync(PLAN_FILE, 'utf8')) : undefined;

function planWithTaxableContribution(taxable: number) {
  const saved = JSON.parse(JSON.stringify(exported.plan));
  delete saved.strategy.result;
  const pre = 38_500;
  const pf = saved.portfolio.personA;
  pf.annualContribution = taxable + pre;
  pf.contribSplit = { taxable: taxable / (taxable + pre), traditional: pre / (taxable + pre), roth: 0 };
  return optimizerView(saved);
}

describe.skipIf(!exported)('optimizer on a plan whose obvious starting policy runs out', () => {
  it('finds a strategy that survives, and more contribution never ends worse', () => {
    vi.setSystemTime(new Date(2026, 9, 26, 12)); // part-way through year 1, where this plan is tight
    const low = optimizeStrategy(planWithTaxableContribution(200_000), 'max-end-balance', { thorough: false });
    const high = optimizeStrategy(planWithTaxableContribution(205_000), 'max-end-balance', { thorough: false });
    expect(low.projection.ranOut).toBe(false);
    expect(high.projection.ranOut).toBe(false);
    expect(high.projection.endTotalReal).toBeGreaterThan(low.projection.endTotalReal);
  }, 600_000);
});
