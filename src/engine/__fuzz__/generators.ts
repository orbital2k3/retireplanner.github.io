import fc from 'fast-check';
import type { Plan, TipsRung } from '../../schemas/plan';

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

/** An optional HSA for one person: balance, contribution, coverage, receipts, retirement election. */
const hsaPerson = () =>
  fc.record({
    hsa: fc.integer({ min: 0, max: 600_000 }),
    hsaContribution: fc.integer({ min: 0, max: 12_000 }),
    hsaCoverage: fc.constantFrom('self' as const, 'family' as const),
    hsaContribInRetirement: fc.boolean(),
    hsaReceipts: fc.integer({ min: 0, max: 100_000 }),
  });

const medicalExpense = () =>
  fc.record({
    annualAmount: fc.integer({ min: 2_000, max: 60_000 }),
    startAge: fc.integer({ min: 50, max: 75 }),
    rate: fc.double({ min: 0.02, max: 0.07, noNaN: true, noDefaultInfinity: true }),
  }).map((m) => ({
    id: 'exp-medical', description: 'Medical', whose: 'Household' as const, startAge: m.startAge,
    end: { mode: 'lastSurvivor' as const }, survivorPct: 1, annualAmount: m.annualAmount,
    inflationPct: { mode: 'fixed' as const, rate: m.rate }, category: 'medical' as const,
  }));

/** A generated plan layered with an HSA: optional per-person accounts, a household payment policy, an
 *  hsaReturn, medical spending and ACA modeling (so retirement contributions hit the ACA lever).
 *  Separate from `arbPlan` so the existing properties keep sampling the plans they always did. */
export const arbHsaPlan = (): fc.Arbitrary<Plan> =>
  fc.tuple(
    arbPlan(),
    fc.record({
      a: fc.option(hsaPerson(), { nil: undefined }),
      b: fc.option(hsaPerson(), { nil: undefined }),
      policy: fc.constantFrom(undefined, 0, 55, 65, 70),
      hsaReturn: fc.option(fc.double({ min: 0, max: 0.09, noNaN: true, noDefaultInfinity: true }), { nil: undefined }),
      medical: fc.option(medicalExpense(), { nil: undefined }),
      aca: fc.option(fc.integer({ min: 6_000, max: 28_000 }), { nil: undefined }),
      // A quarter of the plans are cash-poor, so the other accounts run dry and the HSA is used as the last resort.
      lean: fc.integer({ min: 0, max: 3 }).map((n) => n === 0),
    }),
  ).map(([plan, h]): Plan => {
    const shrink = (p: Plan['portfolio']['personA']) => h.lean
      ? { ...p, taxable: p.taxable * 0.03, taxableBasis: p.taxableBasis * 0.03, traditional: p.traditional * 0.03, roth: p.roth * 0.03 } : p;
    const pf = { ...plan.portfolio, personA: shrink(plan.portfolio.personA), personB: plan.portfolio.personB ? shrink(plan.portfolio.personB) : undefined };
    return {
      ...plan,
      assumptions: {
        ...plan.assumptions,
        ...(h.hsaReturn !== undefined ? { hsaReturn: h.hsaReturn } : {}),
        ...(h.aca !== undefined ? { modelACA: true, acaBenchmarkPremium: h.aca, acaHouseholdSize: plan.personB ? 2 : 1 } : {}),
      },
      portfolio: {
        ...pf,
        personA: { ...pf.personA, ...h.a },
        personB: pf.personB ? { ...pf.personB, ...h.b } : undefined,
        ...(h.policy !== undefined ? { hsaPolicy: { payMedicalFromAge: h.policy } } : {}),
      },
      expenseStreams: h.medical ? [...plan.expenseStreams, h.medical] : plan.expenseStreams,
    };
  });

/** One generated rung: when it matures, how big, its coupon and par, and where it sits. */
const tipsRungSpec = () =>
  fc.record({
    matureIn: fc.integer({ min: 0, max: 45 }),
    principal: fc.integer({ min: 1_000, max: 400_000 }),
    coupon: fc.double({ min: 0, max: 0.04, noNaN: true, noDefaultInfinity: true }),
    account: fc.constantFrom('taxable' as const, 'traditional' as const, 'roth' as const),
    ownerB: fc.boolean(),
    par: fc.option(fc.double({ min: 0.5, max: 1.2, noNaN: true, noDefaultInfinity: true }), { nil: undefined }),
  });

/** A generated plan layered with a TIPS ladder of 1-8 rungs. A quarter of the plans are cash-poor (balances
 *  shrunk, so rungs outgrow their accounts and get scaled down, and IRAs run dry under RMDs) and a quarter are
 *  survivor plans (A dies early with an A-owned pre-tax rung still outstanding). One in five leaves the
 *  balances excluding the ladder. Separate from `arbPlan` so the existing properties keep their samples. */
export const arbTipsPlan = (base: fc.Arbitrary<Plan> = arbPlan()): fc.Arbitrary<Plan> =>
  fc.tuple(
    base,
    fc.record({
      rungs: fc.array(tipsRungSpec(), { minLength: 1, maxLength: 8 }),
      excluded: fc.integer({ min: 0, max: 4 }).map((n) => n === 0),
      lean: fc.integer({ min: 0, max: 3 }).map((n) => n === 0),
      survivor: fc.integer({ min: 0, max: 3 }).map((n) => n === 0),
      deathIn: fc.integer({ min: 3, max: 15 }),
      // ACA modeling on in a third of the plans, so ladder income reaches the subsidy calculation.
      aca: fc.option(fc.integer({ min: 6_000, max: 28_000 }), { nil: undefined }),
    }),
  ).map(([plan, t]): Plan => {
    const year = new Date().getFullYear();
    const startAgeA = year - Number(plan.personA.dob.slice(0, 4));
    const shrink = (p: Plan['portfolio']['personA']) => t.lean
      ? { ...p, taxable: p.taxable * 0.03, taxableBasis: p.taxableBasis * 0.03, traditional: p.traditional * 0.03, roth: p.roth * 0.03 } : p;
    const survivor = t.survivor && plan.personB !== undefined;
    const rungs: TipsRung[] = t.rungs.map((r, i) => ({
      id: `tips-${i}`,
      maturityYear: year + r.matureIn,
      adjustedPrincipal: r.principal,
      couponRate: r.coupon,
      account: r.account,
      whose: r.account === 'traditional' ? (r.ownerB && plan.personB ? 'B' : 'A') : 'Household',
      ...(r.par !== undefined ? { faceValue: Math.round(r.principal * r.par) } : {}),
    }));
    if (survivor) {
      // an A-owned pre-tax rung that matures well after A's death
      rungs.push({ id: 'tips-survivor', maturityYear: year + t.deathIn + 6, adjustedPrincipal: 50_000, couponRate: 0.015, account: 'traditional', whose: 'A' });
    }
    return {
      ...plan,
      assumptions: t.aca !== undefined
        ? { ...plan.assumptions, modelACA: true, acaBenchmarkPremium: t.aca, acaHouseholdSize: plan.personB ? 2 : 1 }
        : plan.assumptions,
      personA: survivor ? { ...plan.personA, planThroughAge: startAgeA + t.deathIn } : plan.personA,
      personB: survivor && plan.personB ? { ...plan.personB, planThroughAge: Math.max(plan.personB.planThroughAge, startAgeA + t.deathIn + 20) } : plan.personB,
      portfolio: {
        ...plan.portfolio,
        personA: shrink(plan.portfolio.personA),
        personB: plan.portfolio.personB ? shrink(plan.portfolio.personB) : undefined,
        tipsLadder: { rungs, ...(t.excluded ? { balancesIncludeLadder: false } : {}) },
      },
    };
  });
