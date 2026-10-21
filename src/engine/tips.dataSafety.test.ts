import { afterAll, describe, expect, it } from 'vitest';
import { runProjection } from './projection';
import { rungYear } from './tipsLadder';
import { tipsLadderIssues, TIPS_MAX_FACE_RATIO } from './tipsValidation';
import { parseTipsCsv } from './tipsCsv';
import { computePlanWarnings } from './planWarnings';
import { assertProjectionInvariants } from './__invariants__/assertions';
import { pinDate, unpinDate } from './__regression__/snapshotUtil';
import { rung, thisYear, tipsIdlePlan, tipsRetireePlan, withTips } from './__testutil__/tipsPlans';
import type { Plan } from '../schemas/plan';

pinDate(); // at load, so fixtures built while collecting describe blocks see the pinned year too
afterAll(unpinDate);

/** Data-safety fixes from the 2026-10-20 audit (M6 basis, M7 matured on-top rungs, M8 face value, CSV year). */
const Y = thisYear();

describe('taxable rungs carved out beyond the entered basis (M6)', () => {
  const ladder = (basis: number): Plan => {
    const p = tipsIdlePlan({ taxable: 300_000 });
    const q = { ...p, portfolio: { ...p.portfolio, personA: { ...p.portfolio.personA, taxableBasis: basis } } };
    return withTips(q, [
      rung({ id: 'r1', maturityYear: Y + 1, adjustedPrincipal: 100_000, couponRate: 0, account: 'taxable' }),
      rung({ id: 'r2', maturityYear: Y + 2, adjustedPrincipal: 100_000, couponRate: 0, account: 'taxable' }),
    ]);
  };

  it('realizes the gain the basis did not cover, pro rata, as the rungs mature', () => {
    const rows = runProjection(ladder(50_000)).rows;
    // 200k of rungs, 50k of basis: 150k of gain, 75k per 100k rung
    expect(rows[0].tipsGain).toBe(0);
    expect(rows[1].tipsGain).toBeCloseTo(75_000, 6);
    expect(rows[2].tipsGain).toBeCloseTo(75_000, 6);
    expect(rows.slice(3).every((r) => r.tipsGain === 0)).toBe(true);
    expect(rows[1].ltcg).toBeGreaterThanOrEqual(75_000);
  });

  it('realizes nothing when the basis covers the rungs, so those plans are unchanged', () => {
    const rows = runProjection(ladder(250_000)).rows;
    expect(rows.every((r) => r.tipsGain === 0)).toBe(true);
  });

  it('keeps the total gain: realized at maturity + still unrealized equals the gain entered', () => {
    // basis 0: every dollar of the 300k account is gain. 200k of it sits in the rungs, 100k stays invested.
    const rows = runProjection(ladder(0)).rows;
    expect(rows[1].tipsGain + rows[2].tipsGain).toBeCloseTo(200_000, 6);
    assertProjectionInvariants(runProjection(ladder(0)), ladder(0));
  });

  it('notes the gap in the warnings strip (info)', () => {
    const w = computePlanWarnings(ladder(50_000)).find((x) => x.id === 'tips-basis')!;
    expect(w.severity).toBe('info');
    expect(w.message).toMatch(/\$150,000 difference as a capital gain/);
    expect(computePlanWarnings(ladder(250_000)).some((x) => x.id === 'tips-basis')).toBe(false);
  });
});

describe('a matured rung (M7)', () => {
  const plan = (include: boolean) => withTips(tipsRetireePlan(), [rung({ id: 'old', maturityYear: Y - 1, adjustedPrincipal: 50_000, account: 'taxable' })], include);

  it('inside the balances: its proceeds are in the account, so the advice is to remove it', () => {
    const i = tipsLadderIssues(plan(true).portfolio, Y).find((x) => x.code === 'matured')!;
    expect(i.message).toMatch(/proceeds should now be in your account balance\. Remove it\./);
  });

  it('on top of the balances: the plan no longer counts the money, so the advice is to add it to a balance', () => {
    const i = tipsLadderIssues(plan(false).portfolio, Y).find((x) => x.code === 'matured')!;
    expect(i.message).toMatch(/no longer counts the money it paid\. Add those proceeds to the account balance/);
    expect(computePlanWarnings(plan(false)).find((w) => w.id === 'tips-matured-old')?.message).toBe(i.message);
  });
});

describe('face value above the adjusted principal (M8)', () => {
  it('is capped in the engine, so a typo cannot create money', () => {
    const y = rungYear({ adjustedPrincipal: 50_000, faceValue: 500_000, couponRate: 0 }, 1, 1, true);
    expect(y.payout).toBe(50_000 * TIPS_MAX_FACE_RATIO);
    // a real deflation floor below the cap is untouched
    expect(rungYear({ adjustedPrincipal: 50_000, faceValue: 52_000, couponRate: 0 }, 1, 1, true).payout).toBe(52_000);
  });

  it('is flagged above 1.05x, with the cap named when it applies', () => {
    const issues = (face: number) => tipsLadderIssues(withTips(tipsRetireePlan(), [rung({ id: 'f', maturityYear: Y + 3, adjustedPrincipal: 50_000, faceValue: face, account: 'roth' })]).portfolio, Y)
      .filter((i) => i.code === 'face');
    expect(issues(52_000)).toEqual([]);
    expect(issues(55_000)[0].message).not.toMatch(/uses at most/);
    expect(issues(500_000)[0].message).toMatch(/uses at most \$62,500/);
  });
});

describe('CSV paste uses the schema year bound', () => {
  it('rejects a maturity year before 1990 so the plan can still be exported and imported', () => {
    const r = parseTipsCsv('1985,10000,1%,taxable\n2031,10000,1%,taxable', {}, (i) => `r${i}`);
    expect(r.rungs.map((x) => x.maturityYear)).toEqual([2031]);
    expect(r.errors).toEqual([{ line: 1, message: 'Maturity year must be 1990 or later' }]);
  });
});
