import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { PlanSchema, type Plan } from '../../schemas/plan';
import { optimizerInput } from './optimizerInput';
import { usePlanStore } from '../../store/usePlanStore';
import { fromFlat, optimizerView } from './savedPlan';
import { FED_BRACKETS_MFJ } from '../taxConstants';
import { richPlan, MANUAL_WINDOW, OPT_WINDOW } from '../__testutil__/strategyPlans';

// Phase 1 manual slot: withdrawal preset, withdrawal bracket ceiling and a hand-built blend.
// Conversion settings and pay-tax-from-brokerage are shared with the optimizer until Phase 2.
type ManualEdit =
  | { kind: 'preset'; v: Plan['withdrawalStrategy'] }
  | { kind: 'ceiling'; v: number }
  | { kind: 'blend'; pctTaxable: number };

const manualEdit: fc.Arbitrary<ManualEdit> = fc.oneof(
  fc.constantFrom('taxfirst', 'rothfirst', 'tradfirst', 'proportional', 'bracketfill').map((v) => ({ kind: 'preset' as const, v })),
  fc.constantFrom(...FED_BRACKETS_MFJ.slice(0, 5).map(([top]) => top)).map((v) => ({ kind: 'ceiling' as const, v })),
  fc.double({ min: 0, max: 1, noNaN: true }).map((pctTaxable) => ({ kind: 'blend' as const, pctTaxable })),
);

function applyManualEdit(p: Plan, e: ManualEdit): Plan {
  if (e.kind === 'preset') return { ...p, withdrawalStrategy: e.v, customPolicy: undefined };
  if (e.kind === 'ceiling') return { ...p, withdrawalBracketCeiling: e.v };
  const rest = 1 - e.pctTaxable;
  return { ...p, customPolicy: { windows: [{ ...MANUAL_WINDOW, pctTaxable: e.pctTaxable, pctTraditional: rest, pctRoth: 0 }], source: 'manual' } };
}

/** A plan with no optimizer result (a manual blend may or may not be present). */
const manualStart = (withBlend: boolean): Plan => {
  const p = PlanSchema.parse(richPlan());
  return {
    ...p,
    customPolicy: withBlend ? { windows: [MANUAL_WINDOW], source: 'manual' } : undefined,
    conversionBaselinePolicy: undefined, optimizedForGoal: undefined, optimizedBy: undefined, mcTuning: undefined,
  };
};

describe('§6.3 "Set it myself" settings never reach the optimizer', () => {
  it('any sequence of manual edits leaves optimizerInput byte-identical', () => {
    fc.assert(fc.property(fc.boolean(), fc.array(manualEdit, { maxLength: 12 }), (withBlend, edits) => {
      const start = manualStart(withBlend);
      const end = edits.reduce(applyManualEdit, start);
      return JSON.stringify(optimizerInput(end)) === JSON.stringify(optimizerInput(start));
    }), { numRuns: 300 });
  });

  it('a hand-built blend is never passed as an optimizer seed', () => {
    expect(optimizerInput(manualStart(true)).customPolicy).toBeUndefined();
    const noSource = { ...manualStart(false), customPolicy: { windows: [MANUAL_WINDOW] } };
    expect(optimizerInput(noSource).customPolicy).toBeUndefined();
  });

  it('an optimizer-authored policy is kept as the seed', () => {
    const p = PlanSchema.parse(richPlan());
    expect(optimizerInput(p).customPolicy?.windows).toEqual([OPT_WINDOW]);
  });

  it('the withdrawal bracket ceiling never changes the conversion ceiling the optimizer sees', () => {
    const p = manualStart(false);
    const conv = optimizerInput(p).conversion.bracketCeiling;
    for (const [top] of FED_BRACKETS_MFJ.slice(0, 5)) {
      expect(optimizerInput({ ...p, withdrawalBracketCeiling: top }).conversion.bracketCeiling).toBe(conv);
    }
  });
});

describe('§6.3 store: withdrawal ceiling edit does not touch the optimizer conversion ceiling', () => {
  // Phase 1 kept this as it.fails: the ceiling clamp edited a conversion field shared with the
  // optimizer. Phase 2 slots made the clamp a "Set it myself"-only rule.
  beforeEach(() => {
    const p = fromFlat({ ...manualStart(false), conversion: { ...manualStart(false).conversion, mode: 'bracket-fill', optimize: false, bracketCeiling: FED_BRACKETS_MFJ[3][0] } }, false);
    usePlanStore.setState({ plan: p });
  });

  it('a manual withdrawal ceiling edit leaves the optimizer conversion ceiling alone', () => {
    const before = optimizerView(usePlanStore.getState().plan).conversion.bracketCeiling;
    usePlanStore.getState().editManual({ preset: 'bracketfill', withdrawalBracketCeiling: FED_BRACKETS_MFJ[1][0] });
    expect(optimizerView(usePlanStore.getState().plan).conversion.bracketCeiling).toBe(before);
  });
});
