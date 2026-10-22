import { expect } from 'vitest';
import type { ProjectionResult } from '../projection';

/** Captured upgrade baselines (src/engine/__fixtures__/exports/) whose numbers moved through a deliberate
 *  engine change made after they were captured. Their key and status are still checked against the baseline;
 *  their numbers against the same plan on today's engine, which is what shows the load path is neutral. */
const CHANGES: { why: string; names: string[] }[] = [
  {
    why: '2026-10-20 audit: the retiree HSA deduction also comes off capital gains and state income; family pool; IRMAA age rule',
    names: ['planR_hsaEarlyRetiree'],
  },
  {
    why: '2026-10-21: realized capital gains (taxable draws, TIPS basis gain) count toward §86 provisional income',
    names: [
      'planA_simple', 'planD_singleFIRE', 'planH_survivorMidPlan', 'planI_multiStreamIncome', 'planJ_personBZeroBalance',
      'planK_wideAgeGap', 'planL_survivorARMD', 'planM_survivorBRMD', 'planO_largePension', 'planQ_qcdGiver',
      'planS_tipsLadder', 'builderShapedLadder',
      '2026-07-31 as saved (no result)', '2026-07-31 optimized for max end balance (fresh)',
      '2026-07-31 optimized, then pay-tax toggled (stale, charts frozen)',
      'fireopt-2026-05-29', 'fireopt-optimized', 'retirement-optimizer-2026-07-31',
    ],
  },
];
export const ENGINE_CHANGED: ReadonlySet<string> = new Set(CHANGES.flatMap((c) => c.names));

export interface HeadlineNumbers { endTotalReal: number; lifetimeFedTax: number; lifetimeConversion: number }

/** The numbers a loaded baseline plan must project to: the captured ones, or for an ENGINE_CHANGED plan the
 *  `reference` projection (the same plan on today's engine), which must then differ from the capture. */
export function expectedNumbers(name: string, baseline: Partial<HeadlineNumbers> & { endTotalReal: number }, reference: () => ProjectionResult): Partial<HeadlineNumbers> {
  if (!ENGINE_CHANGED.has(name)) return baseline;
  const p = reference();
  const moved = p.endTotalReal !== baseline.endTotalReal || (baseline.lifetimeFedTax != null && p.lifetimeFedTax !== baseline.lifetimeFedTax);
  expect(moved, `remove ${name} from ENGINE_CHANGED: its numbers match the baseline again`).toBe(true);
  return { endTotalReal: p.endTotalReal, lifetimeFedTax: p.lifetimeFedTax, lifetimeConversion: p.lifetimeConversion };
}
