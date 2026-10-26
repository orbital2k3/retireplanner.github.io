import { appendFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { optimizeStrategy } from '../optimizer';
import { buildTipsLadder } from '../tipsBuilder';
import { planWithoutLadder } from '../tipsLadder';
import { pinDate } from '../__regression__/snapshotUtil';
import { tipsRetireePlan, withTips } from '../__testutil__/tipsPlans';
import { planF_allTradCouple } from '../__golden/plans';
import type { Plan } from '../../schemas/plan';

/** Part 3 item 6: what the optimizer does when a ladder is fixed input. A bridge ladder over the early
 *  retirement years vs the same money left liquid. Research output, not a regression check.
 *  Run: HEAVY=1 pnpm vitest run --project opt src/engine/__study__/tipsOptimizer.study.test.ts */

pinDate();
/** Console output is not shown under the opt project, so findings go to STUDY_OUT (default: stderr). */
const log = (t: string) => { if (process.env.STUDY_OUT) appendFileSync(process.env.STUDY_OUT, t + '\n'); else process.stderr.write(t + '\n'); };
const Y = new Date().getFullYear();

function bridge(p: Plan, income: number, years: number, funding: Parameters<typeof buildTipsLadder>[0]['funding']): Plan {
  const b = buildTipsLadder({ incomeReal: income, fromYear: Y, throughYear: Y + years - 1, realYield: 0.019, funding, startYear: Y });
  return withTips(p, b.rungs);
}

const summarize = (label: string, r: ReturnType<typeof optimizeStrategy>) => {
  const p = r.projection;
  const conv = p.rows.reduce((s, x) => s + x.rothConv / x.inflationFactor, 0);
  const spend = r.solvedSpendingMultiplier !== undefined ? ` spendMult=${r.solvedSpendingMultiplier.toFixed(4)}` : '';
  return `${label.padEnd(44)} goal=${r.goal} metric=${r.metricFormatted} endTaxAdjReal=${Math.round(p.endTaxAdjustedReal)} lifetimeFedTax=${Math.round(p.lifetimeFedTax)} convReal=${Math.round(conv)} ranOut=${p.ranOut}${spend} windows=${r.policy.windows.length}`;
};

describe('optimizer with a fixed TIPS ladder', () => {
  it('bridge ladder vs the same money liquid', () => {
    const cases: Array<[string, Plan]> = [
      ['retiree 53/51, taxable bridge 25k x 14y', bridge(tipsRetireePlan(), 25_000, 14, { account: 'taxable' })],
      ['retiree 53/51, IRA-A bridge 25k x 14y', bridge(tipsRetireePlan(), 25_000, 14, { account: 'traditional', whose: 'A' })],
      ['planF, IRA-A ladder 40k x 10y', bridge(planF_allTradCouple(), 40_000, 10, { account: 'traditional', whose: 'A' })],
    ];
    const out: string[] = [];
    for (const [label, withL] of cases) {
      const without = planWithoutLadder(withL, Y)!;
      for (const goal of ['max-end-balance', 'max-sustainable-spending'] as const) {
        const t0 = performance.now();
        const a = optimizeStrategy(withL, goal, { thorough: false });
        const b = optimizeStrategy(without, goal, { thorough: false });
        out.push(summarize(`${label} WITH`, a), summarize(`${label} liquid`, b), `  (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
      }
    }
    log(['ITEM 6', ...out].join('\n'));
  }, 1_800_000);
});
