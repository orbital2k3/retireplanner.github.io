import { describe, it, expect } from 'vitest';
import { PlanSchema, defaultPlan, type Plan } from '../schemas/plan';
import { computePlanWarnings, preRetirementConversionAges } from './planWarnings';
import { firstRetirementAgeA } from './streamWindow';

const currentYear = new Date().getFullYear();
/** Person A turns 52 this year, Person B 49 — B is 3 years younger. */
const basePlan = (): Plan => {
  const p = defaultPlan();
  p.personA = { ...p.personA, dob: `${currentYear - 52}-05-03`, retirementAge: 59, planThroughAge: 95 };
  p.personB = { ...p.personA, name: 'B', dob: `${currentYear - 49}-08-26`, retirementAge: 56, planThroughAge: 95 };
  return PlanSchema.parse(p);
};

describe('firstRetirementAgeA', () => {
  it('converts the younger spouse\'s retirement age into A\'s frame', () => {
    const p = basePlan();
    // B retires at 56; B is 3 years younger, so that is A's age 59. A also retires at 59.
    expect(firstRetirementAgeA(p)).toBe(59);
  });

  it('uses whichever person retires first', () => {
    const p = basePlan();
    p.personB!.retirementAge = 50;   // B at 50 → A's age 53
    expect(firstRetirementAgeA(p)).toBe(53);
  });

  it('falls back to A alone when there is no Person B', () => {
    const p = basePlan();
    p.personB = undefined;
    expect(firstRetirementAgeA(p)).toBe(59);
  });
});

describe('pre-retirement conversion warning', () => {
  it('flags non-zero manual conversions scheduled before the first retirement year', () => {
    const p = basePlan();
    p.conversion = { ...p.conversion, mode: 'manual', optimize: false, manualSchedule: { '54': 200000, '55': 200000, '60': 50000 } };

    expect(preRetirementConversionAges(p)).toEqual([54, 55]);
    const w = computePlanWarnings(p).find((x) => x.id === 'conv-pre-retirement-tax');
    expect(w).toBeDefined();
    expect(w!.severity).toBe('warn');
    expect(w!.message).toContain('ages 54–55');
    expect(w!.message).toContain('understated');
  });

  it('renders a single age without a range', () => {
    const p = basePlan();
    p.conversion = { ...p.conversion, mode: 'manual', optimize: false, manualSchedule: { '54': 100000 } };
    expect(computePlanWarnings(p).find((x) => x.id === 'conv-pre-retirement-tax')!.message).toContain('age 54');
  });

  it('does not flag conversions at or after the first retirement year', () => {
    const p = basePlan();
    p.conversion = { ...p.conversion, mode: 'manual', optimize: false, manualSchedule: { '59': 200000, '65': 200000 } };
    expect(preRetirementConversionAges(p)).toEqual([]);
    expect(computePlanWarnings(p).some((x) => x.id === 'conv-pre-retirement-tax')).toBe(false);
  });

  it('ignores zero-amount schedule entries', () => {
    const p = basePlan();
    p.conversion = { ...p.conversion, mode: 'manual', optimize: false, manualSchedule: { '54': 0, '55': 0 } };
    expect(preRetirementConversionAges(p)).toEqual([]);
  });

  it('does not fire for retirement-gated modes, whose pre-retirement conversions are always 0', () => {
    const p = basePlan();
    for (const mode of ['off', 'auto-window', 'bracket-fill'] as const) {
      p.conversion = { ...p.conversion, mode, optimize: false, startAge: 54, manualSchedule: { '54': 200000 } };
      expect(preRetirementConversionAges(p)).toEqual([]);
    }
  });

  it('stays silent when the optimizer owns conversions, even with a stale manual mode', () => {
    const p = basePlan();
    // The leak case: user picked Manual, then switched to "Optimizer decides" (optimize:true).
    // The optimizer never converts before retirementAge, so the schedule must not run — and
    // must not be warned about either.
    p.conversion = { ...p.conversion, mode: 'manual', optimize: true, manualSchedule: { '54': 200000 } };
    expect(preRetirementConversionAges(p)).toEqual([]);
    expect(computePlanWarnings(p).some((x) => x.id === 'conv-pre-retirement-tax')).toBe(false);
  });

  it('tracks the earlier-retiring spouse', () => {
    const p = basePlan();
    p.personB!.retirementAge = 50;   // → A's age 53
    p.conversion = { ...p.conversion, mode: 'manual', optimize: false, manualSchedule: { '52': 200000, '54': 200000 } };
    // 54 is a semi-retirement year (B retired), so only 52 is an accumulation year.
    expect(preRetirementConversionAges(p)).toEqual([52]);
  });
});

describe('QCD warnings on charitable expense rows', () => {
  const giving = (extra: Partial<Plan['expenseStreams'][number]> = {}): Plan['expenseStreams'][number] => ({
    id: 'giving', description: 'Church and charities', whose: 'Household', startAge: 65,
    end: { mode: 'lastSurvivor' }, survivorPct: 1, annualAmount: 10_000, inflationPct: { mode: 'cpi' }, category: 'charitable', ...extra,
  });
  const withGiving = (extra: Partial<Plan['expenseStreams'][number]> = {}, edit: (p: Plan) => void = () => {}): Plan => {
    const p = basePlan();
    p.portfolio = { ...p.portfolio, personB: p.portfolio.personB ?? { ...p.portfolio.personA } };
    p.expenseStreams = [...p.expenseStreams, giving(extra)];
    edit(p);
    return p;
  };
  const emptyIra = (pf: Plan['portfolio']['personA']) => ({ ...pf, traditional: 0, contribSplit: { taxable: 0.5, traditional: 0, roth: 0.5 } });
  const find = (p: Plan, id: string) => computePlanWarnings(p).find((w) => w.id === id);

  it('warns when nobody who would pay the gifts has an IRA', () => {
    const p = withGiving({}, (q) => { q.portfolio = { personA: emptyIra(q.portfolio.personA), personB: q.portfolio.personB ? emptyIra(q.portfolio.personB) : undefined }; });
    const w = find(p, 'qcd-no-ira-giving');
    expect(w?.severity).toBe('warn');
    expect(w?.message).toContain("can't be paid as QCDs");
    expect(w?.message).toContain("Person A's and B's IRAs are empty");
  });

  it("does not warn for a row tagged to B when A's IRA can pay it (the engine pools giving across spouses)", () => {
    const p = withGiving({ whose: 'B' }, (q) => { q.portfolio = { personA: { ...q.portfolio.personA, traditional: 300_000 }, personB: emptyIra(q.portfolio.personB!) }; });
    expect(find(p, 'qcd-no-ira-giving')).toBeUndefined();
  });

  it('names only the spouse who reaches 70½ while alive', () => {
    const p = withGiving({}, (q) => {
      q.personA.planThroughAge = 69;
      q.portfolio = { personA: { ...q.portfolio.personA, traditional: 300_000 }, personB: emptyIra(q.portfolio.personB!) };
    });
    expect(find(p, 'qcd-no-ira-giving')?.message).toContain("B's IRA is empty");
  });

  it("is silent when the row ends before anyone reaches 70½", () => {
    const p = withGiving({ startAge: 60, end: { mode: 'age', age: 66 } }, (q) => { q.portfolio = { personA: emptyIra(q.portfolio.personA), personB: emptyIra(q.portfolio.personB!) }; });
    expect(find(p, 'qcd-no-ira-giving')).toBeUndefined();
  });

  it('does not warn when someone has pre-tax money', () => {
    const p = withGiving({}, (q) => { q.portfolio = { personA: { ...q.portfolio.personA, traditional: 200_000 }, personB: q.portfolio.personB }; });
    expect(find(p, 'qcd-no-ira-giving')).toBeUndefined();
  });

  it('does not warn when contributions will build an IRA', () => {
    const p = withGiving({}, (q) => { q.portfolio = { personA: { ...emptyIra(q.portfolio.personA), annualContribution: 20_000, contribSplit: { taxable: 0, traditional: 1, roth: 0 } }, personB: q.portfolio.personB ? emptyIra(q.portfolio.personB) : undefined }; });
    expect(find(p, 'qcd-no-ira-giving')).toBeUndefined();
  });

  it('gives an info note (not a warning) for a gift marked as not paid to a public charity', () => {
    const w = find(withGiving({ qcd: false }), 'qcd-optout-giving');
    expect(w?.severity).toBe('info');
    expect(w?.message).toContain('not paid directly to a public charity');
    expect(find(withGiving({ qcd: false }), 'qcd-no-ira-giving')).toBeUndefined();
  });

  it('is silent for general rows, zero-amount rows and plans with no charitable rows', () => {
    expect(computePlanWarnings(withGiving({ category: 'general' })).filter((w) => w.id.startsWith('qcd-'))).toEqual([]);
    expect(computePlanWarnings(withGiving({ annualAmount: 0 })).filter((w) => w.id.startsWith('qcd-'))).toEqual([]);
    expect(computePlanWarnings(basePlan()).filter((w) => w.id.startsWith('qcd-'))).toEqual([]);
  });
});
