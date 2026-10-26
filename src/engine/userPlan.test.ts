import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { runProjection } from './projection';
import { enginePlan } from './strategy/savedPlan';
import { remainingYearFraction } from './yearFraction';

/** The user's own exported plan (repo root, git-ignored: it holds real birth dates and balances). It is the realistic
 *  input for checks a sample plan can't give, so these tests skip on a clone that doesn't have the file. */
const PLAN_FILE = resolve(process.cwd(), 'retirement-optimizer-2026-10-26.json');
const exported = existsSync(PLAN_FILE) ? JSON.parse(readFileSync(PLAN_FILE, 'utf8')) : undefined;
const savedPlan = () => JSON.parse(JSON.stringify(exported.plan));

describe.skipIf(!exported)('user plan (retirement-optimizer-2026-10-26.json)', () => {
  const asOf = new Date(2026, 9, 26, 12);
  const f = remainingYearFraction(asOf);
  const proj = exported ? runProjection(enginePlan(savedPlan()), { asOf }) : undefined!;
  const pf = exported?.plan.portfolio;

  it('year 1 uses the entered amount (A) or the prorated annual amount (B) and earns the rest-of-year return', () => {
    expect(pf.personA.year1Contribution).toBe(12_000); // typed into "This year's contribution"
    expect(proj.rows[0].contribA).toBe(12_000);
    expect(proj.rows[0].contribB).toBeCloseTo(pf.personB.annualContribution * f, 6);
    const g = Math.pow(1 + exported.plan.assumptions.rothReturn, f) - 1;
    expect(proj.rows[0].endRoth).toBeCloseTo(pf.personA.roth * (1 + g), 4); // no Roth contributions or withdrawals in year 1
    expect(proj.rows[1].contribA).toBeGreaterThan(pf.personA.annualContribution); // year 2: full amount, CPI-grown
  });

  it("year 1 follows its own 50/50 mix, not the annual 84/16 one", () => {
    const withoutOwnMix = savedPlan();
    delete withoutOwnMix.portfolio.personA.year1Split;
    const alt = runProjection(enginePlan(withoutOwnMix), { asOf });
    // Same $12,000 either way, but 50/50 puts more in pre-tax and less in the taxable account than 84/16.
    const dTrd = proj.rows[0].endTraditional - alt.rows[0].endTraditional;
    const dTax = proj.rows[0].endTaxable - alt.rows[0].endTaxable;
    const shift = 12_000 * (0.5 - pf.personA.contribSplit.traditional);
    expect(dTrd).toBeGreaterThan(0);
    expect(dTrd).toBeCloseTo(shift, 0);
    expect(dTax).toBeCloseTo(-shift, 0);
  });

  it('each year starts where the last one ended, in nominal dollars', () => {
    for (let i = 1; i < proj.rows.length; i++) {
      expect(proj.rows[i].begTaxable).toBeCloseTo(proj.rows[i - 1].endTaxable, 4);
      expect(proj.rows[i].begRoth).toBeCloseTo(proj.rows[i - 1].endRoth, 4);
    }
  });

  it('End Total is the sum of the account balances and every figure is finite', () => {
    for (const r of proj.rows) {
      expect(r.endTotal).toBeCloseTo(r.endTaxable + r.endTraditional + r.endRoth + r.endHSA + r.endTipsTaxable + r.endTipsTrad + r.endTipsRoth, 2);
      for (const v of Object.values(r)) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
    }
  });
});
