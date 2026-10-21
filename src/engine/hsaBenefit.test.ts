import { afterAll, describe, expect, it } from 'vitest';
import { computeHsaBenefit, hsaBenefitCopy } from './hsaBenefit';
import { hsaRule } from './explain/rules/hsa';
import { generateInsights, insightsForSurface } from './explain/index';
import { runProjection } from './projection';
import * as golden from './__golden/plans';
import { acaRetireePlan, medicalPlan, withHsa } from './__testutil__/hsaPlans';
import { pinDate, unpinDate } from './__regression__/snapshotUtil';

pinDate(); // at load, so fixtures built while collecting describe blocks see the pinned year too
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
      contribution: { years: 10, perYear: 9_750, acaModeled: true, yearsLowered: 10, acaMagiLowered: 9_750, subsidyRaised: 3_120, premiumNet: 31_200 } });
    expect(both.title).toBe('Your HSA covers Medicare surcharges and medical bills from 65');
    expect(both.body).toContain("$184,000 of medical costs paid tax-free over the plan (today's $).");
    expect(both.body).toContain('lowers your ACA income by about $9,800 and raises your subsidy by about $3,100 a year');
    const only = hsaBenefitCopy({ qualifiedTotal: 0, irmaaPaid: 0, contribution: { years: 3, perYear: 4_400, acaModeled: true, yearsLowered: 3, acaMagiLowered: 4_400, subsidyRaised: 0, premiumNet: 0 } });
    expect(only.title).toMatch(/lowers your ACA income/);
    expect(only.body).not.toMatch(/subsidy/);
    const noAca = hsaBenefitCopy({ qualifiedTotal: 0, irmaaPaid: 0, contribution: { years: 3, perYear: 4_400, acaModeled: false, yearsLowered: 0, acaMagiLowered: 0, subsidyRaised: 0, premiumNet: 0 } });
    expect(noAca.body).toMatch(/deducted from your taxable income/);
    // ACA modeled but the funding withdrawals cancel the deduction: no promise of a lower ACA income
    const cancelled = hsaBenefitCopy({ qualifiedTotal: 0, irmaaPaid: 0, contribution: { years: 3, perYear: 4_400, acaModeled: true, yearsLowered: 0, acaMagiLowered: 0, subsidyRaised: 0, premiumNet: 0 } });
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

describe('computeHsaBenefit on planR (audit 2026-10-20: the deduction also comes off capital gains)', () => {
  it('lowers ACA income while the brokerage funds it, and nets out the year the brokerage runs out sooner', () => {
    const b = computeHsaBenefit(golden.planR_hsaEarlyRetiree())!;
    const c = b.contribution!;
    expect(c.acaModeled).toBe(true);
    // taxfirst: the contribution is paid from brokerage money, of which only the gain part is income, so
    // ACA income falls by most of the contribution in the brokerage years
    expect(c.yearsLowered).toBeGreaterThan(0);
    expect(c.yearsLowered).toBeLessThan(c.years);
    expect(c.acaMagiLowered).toBeGreaterThan(0.4 * c.perYear);
    expect(c.acaMagiLowered).toBeLessThan(c.perYear);
    const copy = hsaBenefitCopy(b).body;
    expect(copy).toMatch(new RegExp(`in ${c.yearsLowered} of those ${c.years} years`));
    expect(copy).not.toMatch(/doesn't lower your ACA income/);
    // the net premium sentence matches the sign of the net effect
    if (c.premiumNet <= -50) expect(copy).toMatch(/premiums come to about \$[\d,]+ more/);
    if (c.premiumNet >= 50) expect(copy).toMatch(/saves about \$[\d,]+ in ACA premiums/);
  });

  it('mixed-year copy states the net premium effect either way', () => {
    const base = { years: 10, perYear: 8_750, acaModeled: true, yearsLowered: 7, acaMagiLowered: 5_000, subsidyRaised: 700 };
    expect(hsaBenefitCopy({ qualifiedTotal: 0, irmaaPaid: 0, contribution: { ...base, premiumNet: -26_000 } }).body)
      .toMatch(/in 7 of those 10 years\. .*premiums come to about \$26,000 more/);
    expect(hsaBenefitCopy({ qualifiedTotal: 0, irmaaPaid: 0, contribution: { ...base, premiumNet: 4_900 } }).body)
      .toMatch(/saves about \$4,900 in ACA premiums/);
  });
});
