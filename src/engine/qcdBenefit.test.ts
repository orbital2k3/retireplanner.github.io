import { afterAll, describe, expect, it } from 'vitest';
import { compareWithWithoutQCD, qcdBenefitCopy } from './qcdBenefit';
import { runProjection } from './projection';
import * as golden from './__golden/plans';
import { pinDate, unpinDate } from './__regression__/snapshotUtil';
import type { Plan } from '../schemas/plan';

pinDate(); // at load, so fixtures built while collecting describe blocks see the pinned year too
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
    const on = runProjection(plan), off = runProjection(plan, { disableQCD: true, conversionOverrides: on.rows.map((r) => r.rothConv) });
    const fedReal = (rows: typeof on.rows) => rows.reduce((s, r) => s + r.fedTax / r.inflationFactor, 0);
    expect(b.parts.fed).toBeCloseTo(fedReal(off.rows) - fedReal(on.rows), 6);
  });

  it('holds the QCD run\'s conversions fixed, so bracket-fill does not re-size them in the cash run', () => {
    const p = golden.planQ_qcdGiver();
    const plan: Plan = { ...p, conversion: { ...p.conversion, mode: 'bracket-fill', endAge: 80 } };
    const on = runProjection(plan);
    expect(on.lifetimeConversion).toBeGreaterThan(0);
    const b = compareWithWithoutQCD(plan)!;
    const fixed = runProjection(plan, { disableQCD: true, conversionOverrides: on.rows.map((r) => r.rothConv) });
    expect(fixed.lifetimeConversion).toBeCloseTo(on.lifetimeConversion, 6);
    const fedReal = (rows: typeof on.rows) => rows.reduce((s, r) => s + r.fedTax / r.inflationFactor, 0);
    expect(b.parts.fed).toBeCloseTo(fedReal(fixed.rows) - fedReal(on.rows), 6);
    // A re-sized cash run (the old counterfactual) converts less: the taxable RMD fills the bracket that the
    // QCD left free for conversions, so its "saving" nets out conversions the QCD made room for.
    expect(runProjection(plan, { disableQCD: true }).lifetimeConversion).toBeLessThan(on.lifetimeConversion - 1_000);
  });

  it('conversionOverrides with a run\'s own conversions reproduces that run exactly', () => {
    for (const plan of [golden.planC_bracketFillConv(), golden.planQ_qcdGiver(), golden.planG_californiaCouple()]) {
      const on = runProjection(plan);
      expect(runProjection(plan, { conversionOverrides: on.rows.map((r) => r.rothConv) }).rows).toEqual(on.rows);
    }
  });

  it('quotes the age and name of the spouse who pays the first QCD', () => {
    const p = golden.planQ_qcdGiver();
    const b = compareWithWithoutQCD({ ...p, portfolio: { ...p.portfolio, personA: { ...p.portfolio.personA, traditional: 0 } } })!;
    expect(b.firstQcdName).toBe('Person B');
    expect(b.firstQcdAge).toBe(72);   // B, born 1954, in 2026; A is 74
    expect(qcdBenefitCopy(b).body).toMatch(/^Once Person B is 72, /);
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
    rmdCoveredShare: 0.64, lowersTaxableSS: true, irmaaYearsAvoided: 9, totalQcdTaxed: 0,
  };

  it('names the saving, the age, the giving and each real effect', () => {
    const { title, body } = qcdBenefitCopy(base);
    expect(title).toBe("QCDs save you $61,400 in lifetime taxes (today's $)");
    expect(body).toContain('From age 72, $25,000 a year');
    expect(body).toContain('64% of your required withdrawals');
    expect(body).toContain('lowers taxable Social Security');
    expect(body).toContain('IRMAA surcharges in 9 years');
    expect(body).toContain('Compared with paying the same gifts in cash, with the same withdrawal plan and Roth conversions');
    expect(body).toContain('If you itemize, cash gifts are deductible too, so the saving is smaller.');
    expect(body).not.toContain('taxed anyway');
  });

  it('names the QCDs the post-70½ contribution rule taxes', () => {
    expect(qcdBenefitCopy({ ...base, totalQcdTaxed: 24_030 }).body)
      .toContain('$24,000 of the QCDs is taxed anyway: deductible IRA contributions made from age 70½ reduce the tax-free amount.');
  });

  it('leaves out effects that did not happen', () => {
    const { body } = qcdBenefitCopy({ ...base, lowersTaxableSS: false, irmaaYearsAvoided: 0, rmdCoveredShare: 0 });
    expect(body).not.toMatch(/Social Security|IRMAA|required withdrawals/);
  });

  it('does not claim a saving when there is none', () => {
    expect(qcdBenefitCopy({ ...base, taxSaved: 20 }).title).toBe("QCDs don't change your lifetime taxes much (today's $)");
  });
});
