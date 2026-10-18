import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { qcdRule } from './qcd';
import { runProjection } from '../../projection';
import { planA_simple, planQ_qcdGiver, planB_largeTradSingle } from '../../__golden/plans';
import { generateInsights, insightsForSurface } from '../index';
import { pinDate, unpinDate } from '../../__regression__/snapshotUtil';
import type { Plan } from '../../../schemas/plan';

beforeAll(pinDate);
afterAll(unpinDate);

describe('qcdRule', () => {
  it('fires for a plan whose QCDs satisfy required withdrawals', () => {
    const plan = planQ_qcdGiver();
    const insight = qcdRule({ plan, proj: runProjection(plan) });
    expect(insight).not.toBeNull();
    expect(insight!.id).toBe('qcdRmd');
    expect(insight!.surfaces).toEqual(expect.arrayContaining(['taxes', 'strategy']));
    expect(insight!.body).toMatch(/covers \d+% of your required withdrawals/);
    expect(insight!.body).toContain('fewer Roth conversions');
    expect(insight!.body).not.toContain('70½');
  });

  it('is silent when the plan has no charitable giving', () => {
    const plan = planA_simple();
    expect(qcdRule({ plan, proj: runProjection(plan) })).toBeNull();
  });

  it('is silent when every QCD is beyond the RMD (nothing satisfied yet)', () => {
    const base = planB_largeTradSingle();
    const plan: Plan = {
      ...base,
      personA: { ...base.personA, dob: '1956-01-01', retirementAge: 65, planThroughAge: 72 },
      expenseStreams: [...base.expenseStreams, {
        id: 'giving', description: 'Giving', whose: 'A', startAge: 65, end: { mode: 'lastSurvivor' }, survivorPct: 1,
        annualAmount: 20_000, inflationPct: { mode: 'fixed', rate: 0 }, category: 'charitable',
      }],
    };
    const proj = runProjection(plan);
    expect(proj.rows.some((r) => r.qcd > 0)).toBe(true);
    expect(proj.rows.every((r) => r.qcd === r.qcdBeyondRmd)).toBe(true);
    expect(qcdRule({ plan, proj })).toBeNull();
  });

  it('is registered and shows on the taxes surface', () => {
    const plan = planQ_qcdGiver();
    const insights = generateInsights(plan, runProjection(plan));
    expect(insightsForSurface(insights, 'taxes').some((i) => i.id === 'qcdRmd')).toBe(true);
  });
});
