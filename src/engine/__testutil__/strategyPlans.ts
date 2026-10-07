import { samplePlan, type Plan } from '../../schemas/plan';
import type { BlendWindow } from '../blendPolicy';

export const OPT_WINDOW: BlendWindow = { fromAge: 59, toAge: 98, pctTaxable: 0.4, pctTraditional: 0.4, pctRoth: 0.2, convAmt: 40_000 };
export const MANUAL_WINDOW: BlendWindow = { fromAge: 59, toAge: 98, pctTaxable: 0.2, pctTraditional: 0.5, pctRoth: 0.3 };

/** samplePlan with every optional field populated, so walking its values reaches every
 *  registry leaf. Conversions are user-owned (optimize:false, manual) so the manual schedule
 *  counts as an optimizer input. */
export function richPlan(): Plan {
  const base = samplePlan();
  return {
    ...base,
    assumptions: { ...base.assumptions, acaStartAgeA: 60, acaStartAgeB: 58, legacyTargetTaxAdjReal: 100_000 },
    portfolio: {
      personA: { ...base.portfolio.personA, spousalContribution: 1000, spousalTarget: 'roth' },
      personB: { ...base.portfolio.personB!, spousalContribution: 2000, spousalTarget: 'traditional' },
    },
    lumpSumEvents: [{ id: 'ls-1', description: 'Inheritance', whose: 'A', bucket: 'inheritedPreTaxIRA', age: 70, amount: 200_000, ownerStartedRmds: true }],
    conversion: { ...base.conversion, mode: 'manual', optimize: false, manualSchedule: { '60': 50_000, '61': 40_000 } },
    customStateTaxRate: 0.05,
    customPolicy: { windows: [OPT_WINDOW], source: 'optimizer', goal: 'max-end-balance', inputKey: 'k' },
    conversionBaselinePolicy: { windows: [{ ...OPT_WINDOW, convAmt: 0 }], source: 'optimizer' },
    optimizedForGoal: 'max-end-balance',
    optimizedBy: 'optimizer',
    mcTuning: { posture: 'balanced', before: 0.8, after: 0.9, trials: 1000, equityPct: 0.6 },
    solvedSpendingMultiplier: 1.1,
    goals: [{ id: 'g1', name: 'Boat', targetAmount: 50_000, targetYear: 2035, priority: 'Important', fundingMode: 'external', externalAccount: { currentBalance: 1000, monthlyContribution: 100, expectedReturn: 0.05 } }],
  };
}

/** Deterministic deep key shuffle (same values, different key insertion order). */
export function shuffleKeys<T>(value: T, seed: number): T {
  let s = seed >>> 0 || 1;
  const rand = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const keys = Object.keys(v);
      for (let i = keys.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [keys[i], keys[j]] = [keys[j], keys[i]];
      }
      return Object.fromEntries(keys.map((k) => [k, walk((v as Record<string, unknown>)[k])]));
    }
    return v;
  };
  return walk(value) as T;
}
