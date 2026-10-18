import { describe, it } from 'vitest';
import fc from 'fast-check';
import { runProjection } from '../projection';
import { assertDeterministic, assertProjectionInvariants } from '../__invariants__/assertions';
import { arbHsaPlan } from './generators';
import { enc } from '../__regression__/snapshotUtil';
import type { Plan } from '../../schemas/plan';

/** H-10: property tests for the owned HSA over randomly generated plans. */
const NUM_RUNS = Number(process.env.FUZZ_RUNS ?? 50);

const hasAnyHsa = (p: Plan) => (p.portfolio.personA.hsa ?? 0) > 0 || (p.portfolio.personA.hsaContribution ?? 0) > 0
  || (p.portfolio.personB?.hsa ?? 0) > 0 || (p.portfolio.personB?.hsaContribution ?? 0) > 0;

describe('Property-based fuzz: HSA', () => {
  it(`HSA conservation, mass balance and every dollar-flow invariant hold (${NUM_RUNS} runs)`, () => {
    fc.assert(
      fc.property(arbHsaPlan(), (plan) => {
        const proj = runProjection(plan);
        assertProjectionInvariants(proj, plan, { skipSpendingCoverage: true });
      }),
      { numRuns: NUM_RUNS, verbose: true },
    );
  }, 120_000);

  it(`the qualified path never adds taxable income (${NUM_RUNS} runs)`, () => {
    // Compare against the same plan with the HSA never paying (policy age 120). Until the first year the HSA
    // pays, both runs are identical, so in that year the only difference is that the portfolio draws less:
    // ordinary income, gains and federal tax cannot be higher. Conversions are off, because the room a
    // smaller draw frees can legitimately be filled with a bigger conversion. ACA modeling is off too:
    // its premium jumps at 100% of the poverty level, and next to that cliff the gross-up has no fixed
    // point (a shrinking draw drops income under the line, which adds a premium, which grows the draw).
    // That is existing engine behavior, found by this property at seed 1050108452; the ACA effect of
    // HSA contributions is tested directly in hsa.retirement.test.ts.
    fc.assert(
      fc.property(arbHsaPlan(), (generated) => {
        const plan: Plan = {
          ...generated,
          assumptions: { ...generated.assumptions, modelACA: false },
          conversion: { ...generated.conversion, mode: 'off', optimize: false },
        };
        const on = runProjection(plan);
        const k = on.rows.findIndex((r) => r.hsaQualifiedWD > 1);
        if (k < 0 || on.rows[k].hsaNonQualWD > 0) return;
        const never: Plan = { ...plan, portfolio: { ...plan.portfolio, hsaPolicy: { payMedicalFromAge: 120 } } };
        const base = runProjection(never).rows[k];
        const r = on.rows[k];
        if (base.hsaNonQualWD > 0) return;
        if (r.ordIncome + r.ltcg > base.ordIncome + base.ltcg + 50 || r.fedTax > base.fedTax + 50) {
          throw new Error(
            `qualified HSA payment raised income at year ${r.year} (age ${r.ageA}): ` +
            `ord+ltcg ${(r.ordIncome + r.ltcg).toFixed(0)} vs ${(base.ordIncome + base.ltcg).toFixed(0)}, fedTax ${r.fedTax.toFixed(0)} vs ${base.fedTax.toFixed(0)}`,
          );
        }
      }),
      { numRuns: NUM_RUNS, verbose: true },
    );
  }, 120_000);

  it(`absent equals zero: no HSA fields, explicit zeros and an unused policy all project identically (${NUM_RUNS} runs)`, () => {
    fc.assert(
      fc.property(arbHsaPlan(), (generated) => {
        const strip = (pf: Plan['portfolio']['personA']): Plan['portfolio']['personA'] => {
          const { hsa: _a, hsaContribution: _b, hsaCoverage: _c, hsaContribInRetirement: _d, hsaReceipts: _e, ...rest } = pf;
          void _a; void _b; void _c; void _d; void _e;
          return rest;
        };
        const bare: Plan = {
          ...generated,
          portfolio: { personA: strip(generated.portfolio.personA), personB: generated.portfolio.personB ? strip(generated.portfolio.personB) : undefined },
        };
        const zeros: Plan = {
          ...bare,
          portfolio: {
            personA: { ...bare.portfolio.personA, hsa: 0, hsaContribution: 0, hsaReceipts: 0, hsaContribInRetirement: true, hsaCoverage: 'family' },
            personB: bare.portfolio.personB ? { ...bare.portfolio.personB, hsa: 0, hsaContribution: 0, hsaReceipts: 0 } : undefined,
            hsaPolicy: { payMedicalFromAge: 0 },
          },
        };
        if (enc(runProjection(bare)) !== enc(runProjection(zeros))) throw new Error('explicit zero HSA changed the projection');
        // unless the generated plan has an HSA, it is the same as the bare plan too
        if (!hasAnyHsa(generated) && enc(runProjection(bare)) !== enc(runProjection(generated))) {
          throw new Error('a plan with no HSA balance or contribution changed because of leftover HSA fields');
        }
      }),
      { numRuns: NUM_RUNS, verbose: true },
    );
  }, 120_000);

  it(`HSA plans are deterministic (${Math.floor(NUM_RUNS / 2)} runs)`, () => {
    fc.assert(fc.property(arbHsaPlan(), (plan) => { assertDeterministic(plan); }),
      { numRuns: Math.floor(NUM_RUNS / 2), verbose: true });
  }, 120_000);
});
