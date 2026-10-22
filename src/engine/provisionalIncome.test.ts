import { afterAll, describe, expect, it } from 'vitest';
import { runProjection } from './projection';
import { taxableSocialSecurity } from './tax';
import { pinDate, unpinDate } from './__regression__/snapshotUtil';
import * as golden from './__golden/plans';

/** IRC §86: provisional income is AGI without Social Security, plus tax-exempt interest, plus half the
 *  benefits. AGI includes realized capital gains, so a taxable-account draw with an unrealized gain (and a
 *  TIPS rung's uncovered basis gain) makes more of the benefit taxable. Each row's taxable SS is recovered
 *  from acaMagi = magi + exempt interest + (SS - taxable SS), and must equal the §86 formula applied to
 *  that row's own AGI. */
pinDate();
afterAll(unpinDate);

const plans = Object.entries(golden).filter(([k]) => /^plan[A-S]_/.test(k)) as [string, () => ReturnType<typeof golden.planA_simple>][];

describe('§86 provisional income includes realized gains', () => {
  for (const [name, make] of plans) {
    it(`${name}: taxable SS matches §86 on the row's own AGI`, () => {
      const plan = make();
      // The retiree HSA deduction comes off AGI too; it would need its own term, so those plans are skipped.
      if (plan.portfolio.personA.hsaContribInRetirement || plan.portfolio.personB?.hsaContribInRetirement) return;
      for (const r of runProjection(plan).rows) {
        if (r.totalSS <= 0 || r.magi <= 0) continue;
        const taxableSS = r.totalSS + r.magi + r.exemptInterest - r.acaMagi;
        const agiLessSS = r.magi - taxableSS;
        const want = taxableSocialSecurity(agiLessSS + r.exemptInterest + 0.5 * r.totalSS, r.totalSS, r.filingStatus);
        expect(taxableSS, `${name} age ${r.ageA}`).toBeCloseTo(want, 0);
      }
    });
  }
});
