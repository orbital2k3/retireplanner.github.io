import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { migrateStoredPlan } from './planMigrations';
import { SavedPlanSchema } from '../schemas/savedPlan';

describe('store migrations run oldest first', () => {
  it('a pre-v5 household contribGrowth number ends as a GrowthRate object (v5 then v16)', () => {
    const file = JSON.parse(readFileSync('src/engine/__fixtures__/exports/fireopt-2026-05-29.json', 'utf8'));
    const plan = file.plan;
    plan.assumptions.contribGrowth = 0.03;
    delete plan.portfolio.personA.contribGrowth;
    if (plan.portfolio.personB) delete plan.portfolio.personB.contribGrowth;

    const saved = SavedPlanSchema.parse(migrateStoredPlan(plan, 4));
    expect(saved.portfolio.personA.contribGrowth).toEqual({ mode: 'fixed', rate: 0.03 });
    expect((saved.assumptions as Record<string, unknown>).contribGrowth).toBeUndefined();
  });
});
