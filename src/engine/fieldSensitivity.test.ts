import { describe, it, expect } from 'vitest';
import { runProjection } from './projection';
import { samplePlan as defaultPlan } from '../schemas/plan';
import type { Plan, IncomeStream } from '../schemas/plan';
import { acaRetireePlan, medicalRow, withExpenses, withHsa } from './__testutil__/hsaPlans';
import { ladderRungs, rung, thisYear, tipsRetireePlan, withTips } from './__testutil__/tipsPlans';
import { planL_survivorARMD } from './__golden/plans';

/** Sensitivity contract: every UI-editable field that the projection consumes
 *  must move at least one observable output metric (endBalance or lifetimeFedTax)
 *  by a non-trivial amount when perturbed.
 *
 *  Why this exists: the SS-streams-ignored bug (2026-05) was a UI-editable field
 *  that was silently dropped by the engine. Users typed values into rows that
 *  had zero effect on the projection. This suite catches that whole class —
 *  "editable but inert" — by mutating each field and asserting a delta.
 *
 *  Some fields are intentionally informational-only (e.g., a Wages-typed income
 *  stream during accumulation, since the engine models savings via the explicit
 *  annualContribution field rather than deriving from wages). Those are tested
 *  in the SKIPPED block at the bottom with an explanatory comment.
 */

const DELTA_THRESHOLD = 1000; // $1K is the minimum movement we expect from a meaningful field perturbation

/** Run two projections (base and mutated) and return the magnitude of change. */
function sensitivity(basePlan: Plan, mutate: (p: Plan) => Plan): {
  endDelta: number;
  taxDelta: number;
} {
  const base = runProjection(basePlan);
  const mutated = runProjection(mutate(basePlan));
  return {
    endDelta: Math.abs(mutated.endTotalReal - base.endTotalReal),
    taxDelta: Math.abs(mutated.lifetimeFedTax - base.lifetimeFedTax),
  };
}

describe('Field sensitivity — UI-editable fields must affect the projection', () => {
  // Each test mutates one field and asserts a non-trivial movement in
  // endBalance OR lifetimeFedTax. If a future refactor accidentally ignores a
  // field (the SS bug pattern), the corresponding test fails.

  describe('Demographics & timing', () => {
    it('personA.retirementAge', () => {
      const d = sensitivity(defaultPlan(), (p) => ({
        ...p, personA: { ...p.personA, retirementAge: p.personA.retirementAge + 3 },
      }));
      expect(d.endDelta + d.taxDelta).toBeGreaterThan(DELTA_THRESHOLD);
    });

    it('personA.planThroughAge', () => {
      const d = sensitivity(defaultPlan(), (p) => ({
        ...p,
        personA: { ...p.personA, planThroughAge: p.personA.planThroughAge - 5 },
        personB: p.personB ? { ...p.personB, planThroughAge: p.personB.planThroughAge - 5 } : p.personB,
      }));
      expect(d.endDelta + d.taxDelta).toBeGreaterThan(DELTA_THRESHOLD);
    });

    it('personB.retirementAge', () => {
      const d = sensitivity(defaultPlan(), (p) => ({
        ...p, personB: p.personB ? { ...p.personB, retirementAge: p.personB.retirementAge + 5 } : p.personB,
      }));
      expect(d.endDelta + d.taxDelta).toBeGreaterThan(DELTA_THRESHOLD);
    });

    it('personA.planThroughAge (affects projection horizon and survivor filing status)', () => {
      const d = sensitivity(defaultPlan(), (p) => ({
        ...p, personA: { ...p.personA, planThroughAge: 85 },
      }));
      expect(d.endDelta + d.taxDelta).toBeGreaterThan(DELTA_THRESHOLD);
    });
  });

  describe('Return & inflation assumptions', () => {
    it('taxableReturn', () => {
      const d = sensitivity(defaultPlan(), (p) => ({
        ...p, assumptions: { ...p.assumptions, taxableReturn: p.assumptions.taxableReturn + 0.02 },
      }));
      expect(d.endDelta).toBeGreaterThan(DELTA_THRESHOLD);
    });

    it('tradReturn', () => {
      const d = sensitivity(defaultPlan(), (p) => ({
        ...p, assumptions: { ...p.assumptions, tradReturn: p.assumptions.tradReturn + 0.02 },
      }));
      expect(d.endDelta).toBeGreaterThan(DELTA_THRESHOLD);
    });

    it('rothReturn', () => {
      const d = sensitivity(defaultPlan(), (p) => ({
        ...p, assumptions: { ...p.assumptions, rothReturn: p.assumptions.rothReturn + 0.02 },
      }));
      expect(d.endDelta).toBeGreaterThan(DELTA_THRESHOLD);
    });

    it('inflation', () => {
      const d = sensitivity(defaultPlan(), (p) => ({
        ...p, assumptions: { ...p.assumptions, inflation: p.assumptions.inflation + 0.01 },
      }));
      expect(d.endDelta + d.taxDelta).toBeGreaterThan(DELTA_THRESHOLD);
    });

    it('rmdStartAge via dob (lifetimeRMD shifts when dob moves person from age-75 to age-73 threshold)', () => {
      const base = runProjection(defaultPlan());
      // dob '1951-01-01' → rmdStartAge 73; default dob '1974-05-03' → 75
      const mut = runProjection({ ...defaultPlan(), personA: { ...defaultPlan().personA, dob: '1951-01-01' } });
      expect(Math.abs(mut.lifetimeRMD - base.lifetimeRMD)).toBeGreaterThan(DELTA_THRESHOLD);
    });
  });

  describe('Portfolio balances & contributions', () => {
    it('personA.taxable balance', () => {
      const d = sensitivity(defaultPlan(), (p) => ({
        ...p, portfolio: { ...p.portfolio, personA: { ...p.portfolio.personA, taxable: p.portfolio.personA.taxable + 100_000 } },
      }));
      expect(d.endDelta).toBeGreaterThan(DELTA_THRESHOLD);
    });

    it('personA.traditional balance', () => {
      const d = sensitivity(defaultPlan(), (p) => ({
        ...p, portfolio: { ...p.portfolio, personA: { ...p.portfolio.personA, traditional: p.portfolio.personA.traditional + 100_000 } },
      }));
      expect(d.endDelta).toBeGreaterThan(DELTA_THRESHOLD);
    });

    it('personA.roth balance', () => {
      const d = sensitivity(defaultPlan(), (p) => ({
        ...p, portfolio: { ...p.portfolio, personA: { ...p.portfolio.personA, roth: p.portfolio.personA.roth + 100_000 } },
      }));
      expect(d.endDelta).toBeGreaterThan(DELTA_THRESHOLD);
    });

    it('personA.annualContribution', () => {
      const d = sensitivity(defaultPlan(), (p) => ({
        ...p, portfolio: { ...p.portfolio, personA: { ...p.portfolio.personA, annualContribution: p.portfolio.personA.annualContribution + 10_000 } },
      }));
      expect(d.endDelta).toBeGreaterThan(DELTA_THRESHOLD);
    });

    it('personA.contribSplit (shift from roth → traditional changes tax profile)', () => {
      const d = sensitivity(defaultPlan(), (p) => ({
        ...p, portfolio: { ...p.portfolio, personA: { ...p.portfolio.personA, contribSplit: { taxable: 0.1, traditional: 0.7, roth: 0.2 } } },
      }));
      // contribSplit affects WHICH bucket gets the contribution, so end balance
      // (after taxes on withdrawal) shifts.
      expect(d.endDelta + d.taxDelta).toBeGreaterThan(DELTA_THRESHOLD);
    });
  });

  describe('HSA fields', () => {
    // samplePlan with an HSA and a medical bill, so the account has something to pay and to grow.
    const withMedical = (p: Plan): Plan => withExpenses(p, [
      ...p.expenseStreams,
      medicalRow({ id: 'med', startAge: p.personA.retirementAge, annualAmount: 15_000, inflationPct: { mode: 'fixed', rate: 0.04 } }),
    ]);
    const base = () => withMedical(withHsa(defaultPlan(), { a: { hsa: 80_000, hsaContribution: 4_000, hsaReceipts: 10_000 }, policyAge: 0 }));

    it('personA.hsa balance', () => {
      const d = sensitivity(base(), (p) => withHsa(p, { a: { hsa: 280_000 } }));
      expect(d.endDelta + d.taxDelta).toBeGreaterThan(DELTA_THRESHOLD);
    });

    it('personA.hsaContribution', () => {
      const d = sensitivity(base(), (p) => withHsa(p, { a: { hsaContribution: 8_000 } }));
      expect(d.endDelta + d.taxDelta).toBeGreaterThan(DELTA_THRESHOLD);
    });

    it('personA.hsaCoverage (family raises the limit the contribution is capped at)', () => {
      const asks = withHsa(base(), { a: { hsaContribution: 9_000 } });
      const d = sensitivity(asks, (p) => withHsa(p, { a: { hsaCoverage: 'family' } }));
      expect(d.endDelta + d.taxDelta).toBeGreaterThan(DELTA_THRESHOLD);
    });

    it('personA.hsaReceipts (receipts-backed HSA is worth more after tax at the end)', () => {
      // no medical bills, so no receipts accrue by themselves; the HSA never pays (policy age 120)
      const noReceipts = withHsa(defaultPlan(), { a: { hsa: 80_000 }, policyAge: 120 });
      // Receipts don't move the gross balance or tax, only the after-tax end value the optimizer maximizes.
      const a = runProjection(noReceipts), b = runProjection(withHsa(noReceipts, { a: { hsaReceipts: 250_000 } }));
      expect(b.endTaxAdjustedReal - a.endTaxAdjustedReal).toBeGreaterThan(DELTA_THRESHOLD);
    });

    it('personA.hsaContribInRetirement (the deduction and the ACA subsidy)', () => {
      const on = runProjection(acaRetireePlan({ contribute: true }));
      const off = runProjection(acaRetireePlan({ contribute: false }));
      expect(Math.abs(on.endTotalReal - off.endTotalReal) + Math.abs(on.lifetimeFedTax - off.lifetimeFedTax)).toBeGreaterThan(DELTA_THRESHOLD);
    });

    it('hsaPolicy.payMedicalFromAge (paying later keeps the HSA invested and logs receipts)', () => {
      const d = sensitivity(base(), (p) => withHsa(p, { policyAge: 75 }));
      expect(d.endDelta + d.taxDelta).toBeGreaterThan(DELTA_THRESHOLD);
    });

    it('assumptions.hsaReturn', () => {
      const d = sensitivity(base(), (p) => withHsa(p, { hsaReturn: p.assumptions.tradReturn + 0.03 }));
      expect(d.endDelta).toBeGreaterThan(DELTA_THRESHOLD);
    });
  });

  describe('TIPS ladder fields', () => {
    const Y = thisYear();
    const rungs = () => [
      ...ladderRungs({ firstYear: Y + 1, years: 4, principal: 40_000, couponRate: 0.012, account: 'taxable' }),
      ...ladderRungs({ firstYear: Y + 5, years: 3, principal: 50_000, couponRate: 0.015, account: 'traditional', whose: 'A' }),
    ];
    const base = () => withTips(tipsRetireePlan(), rungs());
    const mapRungs = (p: Plan, fn: (r: NonNullable<Plan['portfolio']['tipsLadder']>['rungs'][number], i: number) => Partial<NonNullable<Plan['portfolio']['tipsLadder']>['rungs'][number]>): Plan =>
      withTips(p, p.portfolio.tipsLadder!.rungs.map((r, i) => ({ ...r, ...fn(r, i) })), p.portfolio.tipsLadder!.balancesIncludeLadder);

    it('rung adjustedPrincipal', () => {
      const d = sensitivity(base(), (p) => mapRungs(p, (r, i) => (i === 0 ? { adjustedPrincipal: r.adjustedPrincipal + 100_000 } : {})));
      expect(d.endDelta + d.taxDelta).toBeGreaterThan(DELTA_THRESHOLD);
    });

    it('rung couponRate', () => {
      const d = sensitivity(base(), (p) => mapRungs(p, () => ({ couponRate: 0.04 })));
      expect(d.endDelta + d.taxDelta).toBeGreaterThan(DELTA_THRESHOLD);
    });

    it('rung maturityYear', () => {
      const d = sensitivity(base(), (p) => mapRungs(p, (r) => ({ maturityYear: r.maturityYear + 6 })));
      expect(d.endDelta + d.taxDelta).toBeGreaterThan(DELTA_THRESHOLD);
    });

    it('rung account (taxable to Roth removes the phantom income tax)', () => {
      const d = sensitivity(base(), (p) => mapRungs(p, (r) => (r.account === 'taxable' ? { account: 'roth' as const } : {})));
      expect(d.endDelta + d.taxDelta).toBeGreaterThan(DELTA_THRESHOLD);
    });

    it('rung faceValue (par above the indexed principal sets the maturity payout)', () => {
      // Par only changes anything when it is above the indexed principal (deflation, or a mismatch in the data).
      const d = sensitivity(base(), (p) => mapRungs(p, (r, i) => (i === 0 ? { faceValue: r.adjustedPrincipal * 3 } : {})));
      expect(d.endDelta + d.taxDelta).toBeGreaterThan(DELTA_THRESHOLD);
    });

    it('rung whose (decides which IRA the bonds are carved from, so whose cash can pay the required withdrawal)', () => {
      // Person B's whole IRA is one rung: owned by B it leaves B no cash for the RMD (clamped, unmet); owned by A it
      // comes out of A's IRA and B's cash is untouched. A person's RMD base is the same either way, which is why
      // this needs an IRA that the rung empties.
      const l = (who: 'A' | 'B') => {
        const b = planL_survivorARMD();
        const small = { ...b, portfolio: { ...b.portfolio, personB: { ...b.portfolio.personB!, traditional: 300_000 } } };
        return withTips(small, [rung({ maturityYear: Y + 30, adjustedPrincipal: 300_000, couponRate: 0.015, account: 'traditional', whose: who })]);
      };
      // The spending draw is the same pre-tax cash either way, so end value and tax barely move; what changes is how
      // much of it counts as a required withdrawal (and how much of the RMD goes unmet), which is lifetime RMD.
      const a = runProjection(l('A')), b = runProjection(l('B'));
      expect(Math.abs(a.lifetimeRMD - b.lifetimeRMD)).toBeGreaterThan(DELTA_THRESHOLD);
      expect(b.rows.some((r) => r.rmdUnmet > 0)).toBe(true);
    });

    it('tipsLadder.balancesIncludeLadder (on top of the balances is extra money)', () => {
      const d = sensitivity(base(), (p) => withTips(p, p.portfolio.tipsLadder!.rungs, false));
      expect(d.endDelta + d.taxDelta).toBeGreaterThan(DELTA_THRESHOLD);
    });
  });

  describe('Income streams (engine must honor each editable type)', () => {
    const baseWithExtra = (extra: IncomeStream): Plan => {
      const p = defaultPlan();
      return { ...p, incomeStreams: [...p.incomeStreams, extra] };
    };

    it('SS-typed stream annualAmount', () => {
      const baseStream: IncomeStream = {
        id: 'ss-test', description: 'SS extra', whose: 'A', type: 'SS',
        startAge: 70, end: { mode: 'age' as const, age: 95 }, survivorPct: 0, annualAmount: 10_000, growthPct: { mode: 'fixed', rate: 0.025 }, taxablePct: 1,
      };
      const base = runProjection(baseWithExtra({ ...baseStream, annualAmount: 10_000 }));
      const mut = runProjection(baseWithExtra({ ...baseStream, annualAmount: 30_000 }));
      expect(Math.abs(mut.endTotalReal - base.endTotalReal)).toBeGreaterThan(DELTA_THRESHOLD);
    });

    it('Pension stream annualAmount', () => {
      const baseStream: IncomeStream = {
        id: 'p-test', description: 'Pension', whose: 'A', type: 'Pension',
        startAge: 65, end: { mode: 'age' as const, age: 90 }, survivorPct: 0, annualAmount: 20_000, growthPct: { mode: 'fixed', rate: 0.02 }, taxablePct: 1,
      };
      const base = runProjection(baseWithExtra({ ...baseStream, annualAmount: 20_000 }));
      const mut = runProjection(baseWithExtra({ ...baseStream, annualAmount: 40_000 }));
      expect(Math.abs(mut.endTotalReal - base.endTotalReal)).toBeGreaterThan(DELTA_THRESHOLD);
    });

    it('Rental stream annualAmount', () => {
      const baseStream: IncomeStream = {
        id: 'r-test', description: 'Rental', whose: 'Household', type: 'Other',
        startAge: 65, end: { mode: 'age' as const, age: 90 }, survivorPct: 0, annualAmount: 10_000, growthPct: { mode: 'fixed', rate: 0.02 }, taxablePct: 0.7, stateTaxablePct: 1,
      };
      const base = runProjection(baseWithExtra({ ...baseStream, annualAmount: 10_000 }));
      const mut = runProjection(baseWithExtra({ ...baseStream, annualAmount: 30_000 }));
      expect(Math.abs(mut.endTotalReal - base.endTotalReal)).toBeGreaterThan(DELTA_THRESHOLD);
    });

    it('Annuity stream annualAmount', () => {
      const baseStream: IncomeStream = {
        id: 'a-test', description: 'Annuity', whose: 'A', type: 'Annuity',
        startAge: 65, end: { mode: 'age' as const, age: 90 }, survivorPct: 0, annualAmount: 10_000, growthPct: { mode: 'fixed', rate: 0 }, taxablePct: 0.7,
      };
      const base = runProjection(baseWithExtra({ ...baseStream, annualAmount: 10_000 }));
      const mut = runProjection(baseWithExtra({ ...baseStream, annualAmount: 30_000 }));
      expect(Math.abs(mut.endTotalReal - base.endTotalReal)).toBeGreaterThan(DELTA_THRESHOLD);
    });

    it('Other stream annualAmount (during retirement)', () => {
      const baseStream: IncomeStream = {
        id: 'o-test', description: 'Other', whose: 'Household', type: 'Other',
        startAge: 65, end: { mode: 'age' as const, age: 90 }, survivorPct: 0, annualAmount: 10_000, growthPct: { mode: 'fixed', rate: 0.02 }, taxablePct: 1,
      };
      const base = runProjection(baseWithExtra({ ...baseStream, annualAmount: 10_000 }));
      const mut = runProjection(baseWithExtra({ ...baseStream, annualAmount: 30_000 }));
      expect(Math.abs(mut.endTotalReal - base.endTotalReal)).toBeGreaterThan(DELTA_THRESHOLD);
    });
  });

  describe('Expense streams', () => {
    // A charitable row from retirement on: the QCD (70½+) and the OBBBA deduction (cash gifts before
    // then) both read the category and the qcd flag.
    const withGiving = (p: Plan, extra: Partial<Plan['expenseStreams'][number]> = {}): Plan => ({
      ...p,
      expenseStreams: [...p.expenseStreams, {
        id: 'giving', description: 'Giving', whose: 'Household' as const, startAge: p.personA.retirementAge,
        end: { mode: 'lastSurvivor' as const }, survivorPct: 1, annualAmount: 25_000, inflationPct: { mode: 'cpi' as const }, ...extra,
      }],
    });

    it('expense category (charitable gifts are paid as QCDs from 70½ and get the OBBBA deduction before)', () => {
      const base = withGiving(defaultPlan());
      const d = sensitivity(base, (p) => ({
        ...p, expenseStreams: p.expenseStreams.map((e) => e.id === 'giving' ? { ...e, category: 'charitable' as const } : e),
      }));
      expect(d.endDelta + d.taxDelta).toBeGreaterThan(DELTA_THRESHOLD);
    });

    it('expense qcd flag (a donor-advised-fund gift is not paid as a QCD)', () => {
      const base = withGiving(defaultPlan(), { category: 'charitable' });
      const d = sensitivity(base, (p) => ({
        ...p, expenseStreams: p.expenseStreams.map((e) => e.id === 'giving' ? { ...e, qcd: false } : e),
      }));
      expect(d.endDelta + d.taxDelta).toBeGreaterThan(DELTA_THRESHOLD);
    });

    it('annualAmount', () => {
      const d = sensitivity(defaultPlan(), (p) => ({
        ...p,
        expenseStreams: p.expenseStreams.map((e, i) => i === 0 ? { ...e, annualAmount: e.annualAmount + 20_000 } : e),
      }));
      expect(d.endDelta).toBeGreaterThan(DELTA_THRESHOLD);
    });

    it('inflationPct', () => {
      const d = sensitivity(defaultPlan(), (p) => ({
        ...p,
        expenseStreams: p.expenseStreams.map((e, i) => i === 0 ? { ...e, inflationPct: { mode: 'offset', delta: 0.02 } as const } : e),
      }));
      expect(d.endDelta + d.taxDelta).toBeGreaterThan(DELTA_THRESHOLD);
    });

    it('startAge', () => {
      const d = sensitivity(defaultPlan(), (p) => ({
        ...p,
        expenseStreams: p.expenseStreams.map((e, i) => i === 0 ? { ...e, startAge: e.startAge + 3 } : e),
      }));
      expect(d.endDelta + d.taxDelta).toBeGreaterThan(DELTA_THRESHOLD);
    });

    it('end age', () => {
      const d = sensitivity(defaultPlan(), (p) => ({
        ...p,
        expenseStreams: p.expenseStreams.map((e, i) => {
          if (i !== 0) return e;
          const currentAge = e.end.mode === 'age' ? e.end.age : e.startAge + 25;
          return { ...e, end: { mode: 'age' as const, age: Math.max(e.startAge + 1, currentAge - 10) } };
        }),
      }));
      expect(d.endDelta + d.taxDelta).toBeGreaterThan(DELTA_THRESHOLD);
    });
  });

  describe('Strategy & conversion', () => {
    it('withdrawalStrategy (taxfirst → rothfirst)', () => {
      const d = sensitivity(defaultPlan(), (p) => ({ ...p, withdrawalStrategy: 'rothfirst' }));
      expect(d.endDelta + d.taxDelta).toBeGreaterThan(DELTA_THRESHOLD);
    });

    it('conversion.mode (off → bracket-fill)', () => {
      const d = sensitivity(defaultPlan(), (p) => ({
        ...p, conversion: { ...p.conversion, mode: 'bracket-fill' as const },
      }));
      expect(d.endDelta + d.taxDelta).toBeGreaterThan(DELTA_THRESHOLD);
    });

    it('state (IL → CA, retirement-income taxability differs)', () => {
      const d = sensitivity(defaultPlan(), (p) => ({ ...p, state: 'CA' as const }));
      expect(d.endDelta + d.taxDelta).toBeGreaterThan(DELTA_THRESHOLD);
    });
  });

  // Documented intentional no-ops. If any of these starts moving the projection,
  // the engine has grown a new dependency on the field — that's worth flagging
  // explicitly in code review rather than silently.
  describe('Known informational-only fields', () => {
    it.skip('Wages-typed income stream during accumulation does NOT affect projection (engine derives savings from annualContribution, not wages — this is by design)', () => {
      // If this assertion ever starts holding, the engine has been changed
      // to wire wages into the savings rate. Promote this test to active.
      const p = defaultPlan();
      const base = runProjection(p);
      const withWages = runProjection({
        ...p,
        incomeStreams: [...p.incomeStreams, {
          id: 'w', description: 'Wages', whose: 'A' as const, type: 'Other' as const,
          startAge: 40, end: { mode: 'age' as const, age: p.personA.retirementAge - 1 }, survivorPct: 0,
          annualAmount: 100_000, growthPct: { mode: 'fixed', rate: 0.03 }, taxablePct: 1, stateTaxablePct: 1,
        }],
      });
      expect(Math.abs(withWages.endTotalReal - base.endTotalReal)).toBeLessThan(1);
    });
  });
});
