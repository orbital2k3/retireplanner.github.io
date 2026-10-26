import { describe, expect, it } from 'vitest';
import { PlanSchema, samplePlan } from '../schemas/plan';
import { classifyPath } from './strategy/fieldRegistry';

/** H-1: HSA fields are optional with no default, so parsing a plan that has none leaves
 *  every key absent and no saved plan's optimizer key moves. */
describe('HSA schema', () => {
  it('leaves every HSA field absent when the input has none', () => {
    const parsed = PlanSchema.parse(JSON.parse(JSON.stringify(samplePlan())));
    for (const k of ['hsa', 'hsaContribution', 'hsaCoverage', 'hsaContribInRetirement', 'hsaReceipts'] as const) {
      expect(k in parsed.portfolio.personA).toBe(false);
      if (parsed.portfolio.personB) expect(k in parsed.portfolio.personB).toBe(false);
    }
    expect('hsaPolicy' in parsed.portfolio).toBe(false);
    expect('hsaReturn' in parsed.assumptions).toBe(false);
  });

  it('accepts a full HSA configuration', () => {
    const plan = samplePlan();
    const a = { ...plan.portfolio.personA, hsa: 62_000, hsaContribution: 9_750, hsaCoverage: 'family' as const,
      hsaContribInRetirement: true, hsaReceipts: 18_000 };
    const parsed = PlanSchema.parse({ ...plan, assumptions: { ...plan.assumptions, hsaReturn: 0.06 },
      portfolio: { ...plan.portfolio, personA: a, hsaPolicy: { payMedicalFromAge: 0 } } });
    expect(parsed.portfolio.personA.hsa).toBe(62_000);
    expect(parsed.portfolio.hsaPolicy).toEqual({ payMedicalFromAge: 0 });
    expect(parsed.assumptions.hsaReturn).toBe(0.06);
  });

  it('classifies hsaReturn as a fact', () => {
    expect(classifyPath(['assumptions', 'hsaReturn'])).toBe('fact');
    expect(classifyPath(['portfolio', 'hsaPolicy'])).toBe('fact');
  });
});
