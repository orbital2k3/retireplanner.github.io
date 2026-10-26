import { describe, it } from 'vitest';
import fc from 'fast-check';
import { runProjection } from '../projection';
import { assertDeterministic, assertProjectionInvariants } from '../__invariants__/assertions';
import { arbHsaPlan, arbTipsPlan } from './generators';
import { enc } from '../__regression__/snapshotUtil';
import type { Plan, TipsRung } from '../../schemas/plan';

/** T-6: property tests for the TIPS ladder over randomly generated plans. */
const NUM_RUNS = Number(process.env.FUZZ_RUNS ?? 50);
const N = 80;

const withoutLadder = (p: Plan): Plan => ({ ...p, portfolio: { ...p.portfolio, tipsLadder: undefined } });
const withLadderObj = (p: Plan, tipsLadder: Plan['portfolio']['tipsLadder']): Plan => ({ ...p, portfolio: { ...p.portfolio, tipsLadder } });

const flows = (r: ReturnType<typeof runProjection>['rows'][number]) => [
  r.begTips, r.endTipsTaxable, r.endTipsTrad, r.endTipsRoth, r.tipsCoupon, r.tipsAccrual, r.tipsMaturity,
  r.tipsFloorBonus, r.tipsCash, r.tipsToTrad, r.tipsToRoth, r.tipsOrdInc,
];

describe('Property-based fuzz: TIPS ladder', () => {
  it(`every dollar-flow invariant holds, including the sleeve mass balance and conservation (${NUM_RUNS} runs)`, () => {
    fc.assert(
      fc.property(arbTipsPlan(), (plan) => {
        assertProjectionInvariants(runProjection(plan), plan, { skipSpendingCoverage: true });
      }),
      { numRuns: NUM_RUNS, verbose: true },
    );
  }, 300_000);

  it(`HSA and TIPS together: every invariant, including the exact cash identity and conservation (${NUM_RUNS} runs)`, () => {
    // The ladder's cash and the HSA's qualified payments both reduce the spending gap, and both feed ACA
    // income, so a plan with both is the case where their ordering in the gross-up could double-count.
    fc.assert(
      fc.property(arbTipsPlan(arbHsaPlan()), (plan) => {
        assertProjectionInvariants(runProjection(plan), plan, { skipSpendingCoverage: true });
      }),
      { numRuns: NUM_RUNS, seed: 20261021, verbose: true },
    );
  }, 300_000);

  it(`invariants hold on a CPI path that includes deflation years (${NUM_RUNS} runs)`, () => {
    // Only CPI is overridden (returns stay at the plan's), so the per-row growth checks still apply, while
    // negative indexation, the deflation floor at maturity and stochastic CPI all show up.
    fc.assert(
      fc.property(
        arbTipsPlan(),
        fc.array(fc.double({ min: -0.04, max: 0.08, noNaN: true, noDefaultInfinity: true }), { minLength: N, maxLength: N }),
        (plan, cpi) => {
          assertProjectionInvariants(runProjection(plan, { inflationOverrides: cpi }), plan, { skipSpendingCoverage: true });
        }),
      { numRuns: NUM_RUNS, verbose: true },
    );
  }, 300_000);

  it(`absent equals empty equals matured-only: no live rung means the exact no-ladder projection (${NUM_RUNS} runs)`, () => {
    fc.assert(
      fc.property(arbTipsPlan(), (generated) => {
        const bare = withoutLadder(generated);
        const base = enc(runProjection(bare));
        const stale: TipsRung = { id: 'old', maturityYear: new Date().getFullYear() - 1, adjustedPrincipal: 5e8, couponRate: 0.03, account: 'taxable', whose: 'Household' };
        for (const ladder of [{ rungs: [] }, { rungs: [], balancesIncludeLadder: false }, { rungs: [stale] }]) {
          if (enc(runProjection(withLadderObj(generated, ladder))) !== base) throw new Error(`a ladder with no live rung changed the projection: ${JSON.stringify(ladder)}`);
        }
      }),
      { numRuns: NUM_RUNS, verbose: true },
    );
  }, 300_000);

  it(`ladder cash flows do not depend on the return path (${NUM_RUNS} runs)`, () => {
    fc.assert(
      fc.property(
        arbTipsPlan(),
        fc.array(fc.double({ min: -0.4, max: 0.5, noNaN: true, noDefaultInfinity: true }), { minLength: N, maxLength: N }),
        fc.array(fc.double({ min: -0.01, max: 0.06, noNaN: true, noDefaultInfinity: true }), { minLength: N, maxLength: N }),
        (plan, returnsB, cpi) => {
          const a = runProjection(plan, { returnOverrides: Array(N).fill(0.05), inflationOverrides: cpi });
          const b = runProjection(plan, { returnOverrides: returnsB, inflationOverrides: cpi });
          if (a.rows.length !== b.rows.length) throw new Error('row counts differ across return paths');
          for (let i = 0; i < a.rows.length; i++) {
            const fa = flows(a.rows[i]), fb = flows(b.rows[i]);
            if (fa.some((v, k) => v !== fb[k])) throw new Error(`ladder flows moved with returns at year ${i + 1}: ${fa} vs ${fb}`);
          }
        }),
      { numRuns: NUM_RUNS, verbose: true },
    );
  }, 300_000);

  it(`ladder plans are deterministic (${Math.floor(NUM_RUNS / 2)} runs)`, () => {
    fc.assert(fc.property(arbTipsPlan(), (plan) => { assertDeterministic(plan); }),
      { numRuns: Math.floor(NUM_RUNS / 2), verbose: true });
  }, 300_000);
});
