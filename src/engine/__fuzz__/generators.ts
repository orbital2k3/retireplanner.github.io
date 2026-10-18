import fc from 'fast-check';
import type { Plan } from '../../schemas/plan';

/**
 * Plan-shape generators for property-based testing. The goal is to produce *valid*
 * plans (passes schema, no NaNs, no impossible age relationships) across a realistic
 * range of inputs — so the invariants and optimizer tests run on a wide cross-section
 * of plan shapes, not just the hand-crafted goldens.
 */

const STATES = ['IL', 'CA', 'NY', 'TX', 'FL', 'WA'] as const;
const STRATEGIES: Plan['withdrawalStrategy'][] = ['taxfirst', 'rothfirst', 'tradfirst', 'proportional', 'bracketfill'];
const CONV_MODES: Plan['conversion']['mode'][] = ['off', 'manual', 'auto-window', 'bracket-fill'];
const STREAM_TYPES = ['SS', 'Pension', 'Annuity', 'MuniBond', 'VA', 'Other'] as const;
const EXPENSE_WHO = ['A', 'B', 'Household'] as const;

/** A contribSplit that sums to exactly 1.0 (within float epsilon). */
const contribSplit = () =>
  fc.tuple(fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }), fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }))
    .map(([a, b]) => {
      // Map two uniform [0,1] values to a 3-component split via a stick-breaking process.
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      return { taxable: lo, traditional: hi - lo, roth: 1 - hi };
    });

const personPortfolio = () =>
  fc.record({
    taxable: fc.integer({ min: 0, max: 3_000_000 }),
    taxableBasis: fc.integer({ min: 0, max: 3_000_000 }),
    traditional: fc.integer({ min: 0, max: 3_000_000 }),
    roth: fc.integer({ min: 0, max: 2_000_000 }),
    annualContribution: fc.integer({ min: 0, max: 75_000 }),
    contribGrowth: fc.double({ min: 0, max: 0.04, noNaN: true, noDefaultInfinity: true }).map((rate) => ({ mode: 'fixed' as const, rate })),
    contribSplit: contribSplit(),
  });

const incomeStream = () =>
  fc.record({
    id: fc.string({ minLength: 4, maxLength: 12 }).map((s) => `stream-${s}`),
    description: fc.constant('FuzzStream'),
    whose: fc.constantFrom('A', 'B', 'Household'),
    type: fc.constantFrom(...STREAM_TYPES),
    startAge: fc.integer({ min: 50, max: 75 }),
    stopAge: fc.integer({ min: 70, max: 100 }),
    annualAmount: fc.integer({ min: 0, max: 80_000 }),
    growthPct: fc.double({ min: 0, max: 0.04, noNaN: true, noDefaultInfinity: true }).map((rate) => ({ mode: 'fixed' as const, rate })),
    taxablePct: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
    stateTaxablePct: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
  })
    .filter((s) => s.stopAge > s.startAge)
    .map((s) => {
      const { stopAge, ...rest } = s;
      return { ...rest, end: { mode: 'age' as const, age: stopAge }, survivorPct: 0 };
    });

const expenseStream = () =>
  fc.record({
    id: fc.string({ minLength: 4, maxLength: 12 }).map((s) => `exp-${s}`),
    description: fc.constant('Spending'),
    whose: fc.constantFrom(...EXPENSE_WHO),
    startAge: fc.integer({ min: 45, max: 80 }),
    stopAge: fc.integer({ min: 75, max: 105 }),
    annualAmount: fc.integer({ min: 20_000, max: 200_000 }),
    inflationPct: fc.double({ min: 0, max: 0.05, noNaN: true, noDefaultInfinity: true }).map((rate) => ({ mode: 'fixed' as const, rate })),
  })
    .filter((e) => e.stopAge > e.startAge)
    .map((e) => {
      const { stopAge, ...rest } = e;
      return { ...rest, end: { mode: 'age' as const, age: stopAge }, survivorPct: 1 };
    });

/** An optional charitable-giving row. `qcd:false` marks a donor-advised-fund style gift. */
const charitableExpense = () =>
  fc.record({
    annualAmount: fc.integer({ min: 1_000, max: 120_000 }),
    startAge: fc.integer({ min: 55, max: 75 }),
    qcd: fc.option(fc.constant(false), { nil: undefined }),
  }).map((c) => ({
    id: 'exp-charity', description: 'Giving', whose: 'Household' as const, startAge: c.startAge,
    end: { mode: 'lastSurvivor' as const }, survivorPct: 1, annualAmount: c.annualAmount,
    inflationPct: { mode: 'fixed' as const, rate: 0.025 }, category: 'charitable' as const,
    ...(c.qcd === false ? { qcd: false } : {}),
  }));

/** Generate a valid Plan. Couples vs singles, varied states, varied returns and balances. */
export const arbPlan = (): fc.Arbitrary<Plan> =>
  fc.record({
    // Ages 54 to 75 at the start, so QCD ages (70+) and RMD ages show up in the first years too.
    aBirthYear: fc.integer({ min: new Date().getFullYear() - 75, max: new Date().getFullYear() - 54 }),
    ageDeltaB: fc.integer({ min: -10, max: 10 }),                       // personB age relative to personA
    aRetireAge: fc.integer({ min: 50, max: 70 }),
    aPlanThroughAge: fc.integer({ min: 75, max: 100 }),
    aSsPIA: fc.integer({ min: 0, max: 55_000 }),
    aSsClaimAge: fc.integer({ min: 62, max: 70 }),
    bSsPIA: fc.integer({ min: 0, max: 55_000 }),
    bSsClaimAge: fc.integer({ min: 62, max: 70 }),
    taxableReturn: fc.double({ min: 0.02, max: 0.10, noNaN: true, noDefaultInfinity: true }),
    tradReturn: fc.double({ min: 0.02, max: 0.10, noNaN: true, noDefaultInfinity: true }),
    rothReturn: fc.double({ min: 0.02, max: 0.10, noNaN: true, noDefaultInfinity: true }),
    inflation: fc.double({ min: 0.005, max: 0.05, noNaN: true, noDefaultInfinity: true }),
    taxAdjOrdRate: fc.double({ min: 0, max: 0.50, noNaN: true, noDefaultInfinity: true }),
    taxAdjLtcgRate: fc.double({ min: 0, max: 0.35, noNaN: true, noDefaultInfinity: true }),
    pfA: personPortfolio(),
    pfB: personPortfolio(),
    hasPersonB: fc.boolean(),
    state: fc.constantFrom(...STATES),
    strategy: fc.constantFrom(...STRATEGIES),
    convMode: fc.constantFrom(...CONV_MODES),
    convOptimize: fc.boolean(),
    expense: expenseStream(),
    charity: fc.option(charitableExpense(), { nil: undefined }),
    incomes: fc.array(incomeStream(), { minLength: 0, maxLength: 3 }),
  })
    .filter((s) => s.aPlanThroughAge > s.aRetireAge + 5 && s.aPlanThroughAge >= new Date().getFullYear() - s.aBirthYear + 3)
    .map((s): Plan => {
      const aBirthYear = s.aBirthYear;
      const bBirthYear = aBirthYear + s.ageDeltaB;
      const bRetire = Math.max(50, Math.min(70, s.aRetireAge - s.ageDeltaB));
      const bPlanTo = Math.max(s.aPlanThroughAge - 2, 75);
      return {
        personA: {
          name: 'A',
          dob: `${aBirthYear}-01-01`,
          retirementAge: s.aRetireAge,
          planThroughAge: s.aPlanThroughAge,
          ssPIA: s.aSsPIA,
          ssClaimAge: s.aSsClaimAge,
        },
        personB: s.hasPersonB
          ? {
              name: 'B',
              dob: `${bBirthYear}-01-01`,
              retirementAge: bRetire,
              planThroughAge: bPlanTo,
              ssPIA: s.bSsPIA,
              ssClaimAge: s.bSsClaimAge,
            }
          : undefined,
        assumptions: {
          taxableReturn: s.taxableReturn,
          taxableDivYield: 0,
          taxableQualifiedPct: 0.80,
          taxableExemptYield: 0,
          taxableExemptStatePct: 1,
          taxableDistributePct: 0,
          taxAdjOrdRate: s.taxAdjOrdRate,
          taxAdjLtcgRate: s.taxAdjLtcgRate,
          legacyTargetTaxAdjReal: 0,
          tradReturn: s.tradReturn,
          rothReturn: s.rothReturn,
          inflation: s.inflation,
          modelACA: false,
          acaHouseholdSize: 2,
          acaBenchmarkPremium: 0,
          acaNoSubsidy: false,
        },
        portfolio: {
          personA: s.pfA,
          personB: s.hasPersonB ? s.pfB : undefined,
        },
        incomeStreams: s.incomes,
        lumpSumEvents: [],
        expenseStreams: s.charity ? [s.expense, s.charity] : [s.expense],
        withdrawalStrategy: s.strategy,
        withdrawalBracketCeiling: s.hasPersonB ? 100800 : 50400,
        conversion: {
          mode: s.convMode,
          startAge: 65,
          endAge: 73,
          autoAmount: 70_000,
          bracketCeiling: 96_950,
          manualSchedule: {},
          optimize: s.convOptimize,
        },
        state: s.state,
        payTaxFromBrokerage: false,
        goals: [],
      };
    });
