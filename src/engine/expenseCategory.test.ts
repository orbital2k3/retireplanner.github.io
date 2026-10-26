import { afterAll, describe, expect, it } from 'vitest';
import { runProjection } from './projection';
import { samplePlan, PlanSchema, type ExpenseStream, type Plan } from '../schemas/plan';
import * as golden from './__golden/plans';
import { EXPENSE_TEMPLATES, type TemplateCtx } from './streamTemplates';
import { assertProjectionInvariants } from './__invariants__/assertions';
import { digestProjection, enc, pinDate, unpinDate } from './__regression__/snapshotUtil';

/** Phase 1A foundation (F-1..F-3): expense `category` / `qcd` are tags. They feed the
 *  medicalSpend / charitableSpend row fields and change nothing else until the QCD engine lands. */

pinDate(); // at load, so fixtures built while collecting describe blocks see the pinned year too
afterAll(unpinDate);

const tagAll = (p: Plan, tag: (e: ExpenseStream, i: number) => Partial<ExpenseStream>): Plan => ({
  ...p, expenseStreams: p.expenseStreams.map((e, i) => ({ ...e, ...tag(e, i) })),
});

const plans: Array<[string, () => Plan]> = [
  ['samplePlan', samplePlan],
  ['planA', golden.planA_simple],
  ['planG (CA, conversions)', golden.planG_californiaCouple],
  ['planF (all-Trad, RMD)', golden.planF_allTradCouple],
];

describe('expense category tags', () => {
  it.each(plans)('%s: tags that don\'t trigger a QCD change no projection value (bit-exact)', (_n, mk) => {
    const base = digestProjection(runProjection(mk()));
    // Charitable rows carry qcd:false (a gift that can't be a QCD); an eligible charitable row is covered in qcd.projection.test.ts.
    const cycle = ['general', 'medical', 'charitable'] as const;
    const tagged = digestProjection(runProjection(tagAll(mk(), (_e, i) => ({ category: cycle[i % 3], qcd: i % 3 === 2 ? false : undefined }))));
    expect(enc(tagged)).toBe(enc(base));
  });

  it('medicalSpend and charitableSpend sum the tagged rows; untagged spend is general', () => {
    const p = samplePlan();
    const [first, ...rest] = p.expenseStreams;
    const plan: Plan = {
      ...p,
      expenseStreams: [
        { ...first, id: 'med', category: 'medical', annualAmount: 12_000 },
        { ...first, id: 'char', category: 'charitable', annualAmount: 7_000 },
        { ...first, id: 'gen', annualAmount: 30_000 },
        ...rest,
      ],
    };
    const res = runProjection(plan);
    const retired = res.rows.filter((r) => r.netSpend > 0);
    expect(retired.length).toBeGreaterThan(0);
    for (const r of retired) {
      expect(r.medicalSpend).toBeCloseTo(12_000 * Math.pow(1 + 0.025, r.year - 1), 6);
      expect(r.charitableSpend).toBeGreaterThan(0);
      expect(r.medicalSpend + r.charitableSpend).toBeLessThanOrEqual(r.netSpend);
    }
    assertProjectionInvariants(res, plan);
  });

  it('plans without tags report zero medical and charitable spend', () => {
    const res = runProjection(samplePlan());
    for (const r of res.rows) {
      expect(r.medicalSpend).toBe(0);
      expect(r.charitableSpend).toBe(0);
    }
  });

  it('a stream whose end rule has passed contributes to neither the total nor its category', () => {
    const p = samplePlan();
    const late: ExpenseStream = {
      ...p.expenseStreams[0], id: 'short', category: 'charitable', annualAmount: 5_000,
      startAge: p.personA.retirementAge, end: { mode: 'age', age: p.personA.retirementAge + 1 },
    };
    const res = runProjection({ ...p, expenseStreams: [...p.expenseStreams, late] });
    const last = res.rows.at(-1)!;
    expect(last.charitableSpend).toBe(0);
  });
});

describe('expense category schema', () => {
  it('leaves category and qcd absent when the input has none (no default, so saved keys do not move)', () => {
    const parsed = PlanSchema.parse(JSON.parse(JSON.stringify(samplePlan())));
    for (const e of parsed.expenseStreams) {
      expect('category' in e).toBe(false);
      expect('qcd' in e).toBe(false);
    }
  });

  it('accepts and round-trips the three categories and the qcd flag', () => {
    const p = samplePlan();
    const plan = tagAll(p, (_e, i) => ({ category: (['general', 'medical', 'charitable'] as const)[i % 3], qcd: false }));
    const parsed = PlanSchema.parse(JSON.parse(JSON.stringify(plan)));
    expect(parsed.expenseStreams.map((e) => [e.category, e.qcd])).toEqual(plan.expenseStreams.map((e) => [e.category, e.qcd]));
    expect(PlanSchema.safeParse({ ...plan, expenseStreams: [{ ...plan.expenseStreams[0], category: 'bogus' }] }).success).toBe(false);
  });
});

describe('stock expense templates', () => {
  it('tag only HSA-qualified costs as Medical: premiums are General, out-of-pocket costs are Medical', () => {
    const make = (id: string) => EXPENSE_TEMPLATES.find((t) => t.id === id)!.make({ retirementAge: 60, planThroughAge: 95 } as TemplateCtx);
    expect(make('healthcare').category).toBeUndefined();
    expect(make('healthcare').description).toMatch(/premiums/i);
    expect(make('medical').category).toBe('medical');
    expect(make('healthcare').annualAmount + make('medical').annualAmount).toBe(18_000);
  });
});
