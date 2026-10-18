import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compareWithWithoutQCD, qcdBenefitCopy } from './qcdBenefit';
import { runProjection } from './projection';
import * as golden from './__golden/plans';
import { pinDate, unpinDate } from './__regression__/snapshotUtil';
import type { Plan } from '../schemas/plan';

beforeAll(pinDate);
afterAll(unpinDate);

describe('compareWithWithoutQCD', () => {
  it('returns null (card hidden) for a plan with no QCDs', () => {
    expect(compareWithWithoutQCD(golden.planA_simple())).toBeNull();
    expect(compareWithWithoutQCD(golden.planF_allTradCouple())).toBeNull();
  });

  it('reports a positive saving for the QCD giver, and the parts add up', () => {
    const b = compareWithWithoutQCD(golden.planQ_qcdGiver())!;
    expect(b).not.toBeNull();
    expect(b.totalQcd).toBeGreaterThan(0);
    expect(b.firstQcdAge).toBe(74);
    expect(b.taxSaved).toBeGreaterThan(0);
    const { fed, state, irmaa, niit, aca } = b.parts;
    expect(fed + state + irmaa + niit + aca).toBeCloseTo(b.taxSaved, 6);
    expect(b.parts.state).toBeGreaterThan(0); // NY taxes IRA income
    expect(b.rmdCoveredShare).toBeGreaterThan(0);
    expect(b.rmdCoveredShare).toBeLessThanOrEqual(1);
  });

  it('matches the difference of two projections directly', () => {
    const plan = golden.planQ_qcdGiver();
    const b = compareWithWithoutQCD(plan)!;
    const on = runProjection(plan), off = runProjection(plan, { disableQCD: true });
    const fedReal = (rows: typeof on.rows) => rows.reduce((s, r) => s + r.fedTax / r.inflationFactor, 0);
    expect(b.parts.fed).toBeCloseTo(fedReal(off.rows) - fedReal(on.rows), 6);
  });

  it('a QCD-eligible plan with a donor-advised-fund gift has no benefit card', () => {
    const p: Plan = golden.planQ_qcdGiver();
    const dafPlan: Plan = { ...p, expenseStreams: p.expenseStreams.map((e) => e.category === 'charitable' ? { ...e, qcd: false } : e) };
    expect(compareWithWithoutQCD(dafPlan)).toBeNull();
  });
});

describe('qcdBenefitCopy', () => {
  const base = {
    totalQcd: 500_000, firstQcdAge: 72, firstQcd: 25_000, taxSaved: 61_432,
    parts: { fed: 50_000, state: 10_000, irmaa: 1_432, niit: 0, aca: 0 },
    rmdCoveredShare: 0.64, lowersTaxableSS: true, irmaaYearsAvoided: 9,
  };

  it('names the saving, the age, the giving and each real effect', () => {
    const { title, body } = qcdBenefitCopy(base);
    expect(title).toBe("QCDs save you $61,400 in lifetime taxes (today's $)");
    expect(body).toContain('From age 72, $25,000 a year');
    expect(body).toContain('64% of your required withdrawals');
    expect(body).toContain('lowers taxable Social Security');
    expect(body).toContain('IRMAA surcharges in 9 years');
    expect(body).toContain('Same withdrawal plan, compared with paying the same gifts in cash.');
  });

  it('leaves out effects that did not happen', () => {
    const { body } = qcdBenefitCopy({ ...base, lowersTaxableSS: false, irmaaYearsAvoided: 0, rmdCoveredShare: 0 });
    expect(body).not.toMatch(/Social Security|IRMAA|required withdrawals/);
  });

  it('does not claim a saving when there is none', () => {
    expect(qcdBenefitCopy({ ...base, taxSaved: 20 }).title).toBe("QCDs don't change your lifetime taxes much (today's $)");
  });
});
