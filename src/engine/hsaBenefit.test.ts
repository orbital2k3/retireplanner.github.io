import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeHsaBenefit, hsaBenefitCopy } from './hsaBenefit';
import { hsaRule } from './explain/rules/hsa';
import { generateInsights, insightsForSurface } from './explain/index';
import { runProjection } from './projection';
import * as golden from './__golden/plans';
import { acaRetireePlan, medicalPlan, withHsa } from './__testutil__/hsaPlans';
import { pinDate, unpinDate } from './__regression__/snapshotUtil';

beforeAll(pinDate);
afterAll(unpinDate);

describe('computeHsaBenefit (HU-5)', () => {
  it('is null for a plan without an HSA and for an idle one', () => {
    expect(computeHsaBenefit(golden.planA_simple())).toBeNull();
    // balance but nothing to pay and no retiree contribution: policy age 120 means it never pays
    expect(computeHsaBenefit(withHsa(golden.planA_simple(), { a: { hsa: 50_000 }, policyAge: 120 }))).toBeNull();
  });

  it('totals the qualified payments in today\'s dollars and names the first paying age', () => {
    const plan = medicalPlan({ a: { hsa: 400_000 }, policyAge: 0 });
    const rows = runProjection(plan).rows;
    const b = computeHsaBenefit(plan)!;
    expect(b.qualifiedTotal).toBeCloseTo(rows.reduce((s, r) => s + r.hsaQualifiedWD / r.inflationFactor, 0), 6);
    expect(b.firstPayAge).toBe(rows.find((r) => r.hsaQualifiedWD > 0)!.ageA);
    expect(b.contribution).toBeUndefined();
  });

  it('measures the retiree contribution against the same plan without it', () => {
    const plan = acaRetireePlan();
    const b = computeHsaBenefit(plan)!;
    expect(b.contribution?.years).toBe(10);
    expect(b.contribution!.perYear).toBeCloseTo(4_400, 0);
    // the deduction equals the contribution while income exceeds it, and the subsidy rises with it
    expect(b.contribution!.acaMagiLowered).toBeCloseTo(4_400, 0);
    expect(b.contribution!.subsidyRaised).toBeGreaterThan(50);
    // and it is a real counterfactual: the figure matches a direct comparison of two runs
    const off = runProjection(acaRetireePlan({ contribute: false })).rows;
    const on = runProjection(plan).rows;
    const direct = on.slice(0, 10).reduce((s, r, i) => s + (off[i].acaPremium - r.acaPremium) / r.inflationFactor, 0) / 10;
    expect(b.contribution!.subsidyRaised).toBeCloseTo(direct, 4);
  });
});

describe('hsaBenefitCopy and hsaRule (HU-5)', () => {
  it('writes a title and body only from numbers that exist', () => {
    const both = hsaBenefitCopy({ qualifiedTotal: 184_040, irmaaPaid: 5_000, firstPayAge: 65,
      contribution: { years: 10, perYear: 9_750, acaModeled: true, acaMagiLowered: 9_750, subsidyRaised: 3_120 } });
    expect(both.title).toBe('Your HSA covers Medicare surcharges and medical bills from 65');
    expect(both.body).toContain("$184,000 of medical costs paid tax-free over the plan (today's $).");
    expect(both.body).toContain('lowers your ACA income by about $9,800 and raises your subsidy by about $3,100 a year');
    const only = hsaBenefitCopy({ qualifiedTotal: 0, irmaaPaid: 0, contribution: { years: 3, perYear: 4_400, acaModeled: true, acaMagiLowered: 4_400, subsidyRaised: 0 } });
    expect(only.title).toMatch(/lowers your ACA income/);
    expect(only.body).not.toMatch(/subsidy/);
    const noAca = hsaBenefitCopy({ qualifiedTotal: 0, irmaaPaid: 0, contribution: { years: 3, perYear: 4_400, acaModeled: false, acaMagiLowered: 0, subsidyRaised: 0 } });
    expect(noAca.body).toMatch(/deducted from your taxable income/);
    // ACA modeled but the funding withdrawals cancel the deduction: no promise of a lower ACA income
    const cancelled = hsaBenefitCopy({ qualifiedTotal: 0, irmaaPaid: 0, contribution: { years: 3, perYear: 4_400, acaModeled: true, acaMagiLowered: 0, subsidyRaised: 0 } });
    expect(cancelled.body).toMatch(/doesn't lower your ACA income in this plan/);
  });

  it('the insight rule fires with payments, stays silent without, and is part of the taxes surface', () => {
    const plan = medicalPlan({ a: { hsa: 400_000 }, policyAge: 0 });
    const insight = hsaRule({ plan, proj: runProjection(plan) })!;
    expect(insight.id).toBe('hsaQualified');
    expect(insight.title).toMatch(/medical bills from/);
    const flat = golden.planA_simple();
    expect(hsaRule({ plan: flat, proj: runProjection(flat) })).toBeNull();
    const all = generateInsights(plan, runProjection(plan));
    expect(insightsForSurface(all, 'taxes').some((i) => i.id === 'hsaQualified')).toBe(true);
  });
});

describe('computeHsaBenefit on planR (HU-5 finding)', () => {
  it('reports no ACA-income reduction when taxable/pre-tax withdrawals fund the contribution', () => {
    const b = computeHsaBenefit(golden.planR_hsaEarlyRetiree())!;
    expect(b.contribution?.acaModeled).toBe(true);
    // taxfirst: the contribution is paid from gains-bearing brokerage money, then pre-tax money, whose
    // withdrawal income cancels the deduction, so the card must not claim a lower ACA income
    expect(b.contribution!.acaMagiLowered).toBeLessThan(1);
    expect(hsaBenefitCopy(b).body).toMatch(/doesn't lower your ACA income/);
  });
});
