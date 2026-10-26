import { afterAll, describe, expect, it, vi } from 'vitest';
import { computePlanWarnings } from './planWarnings';
import { computeHsaProjectionWarnings, hsaEarlyDrawWarning } from './hsaWarnings';
import { runProjection } from './projection';
import * as golden from './__golden/plans';
import { acaRetireePlan, hsaOnlyPlan, withHsa } from './__testutil__/hsaPlans';
import { pinDate, unpinDate } from './__regression__/snapshotUtil';

pinDate(); // at load, so fixtures built while collecting describe blocks see the pinned year too
afterAll(unpinDate);

// planA pinned to 2026: A is 53 (claims 67), B is 51 (claims 67).
const ids = (p: Parameters<typeof computePlanWarnings>[0]) => computePlanWarnings(p).map((w) => w.id);

describe('HSA plan warnings (HU-4)', () => {
  it('names no calendar year for the limit, which is the 2026 figure in today\'s dollars whatever the clock says', () => {
    vi.setSystemTime(new Date('2027-03-01T12:00:00Z'));
    try {
      const p = withHsa(golden.planA_simple(), { a: { hsaContribution: 11_000, hsaCoverage: 'family' } });
      const w = computePlanWarnings(p).find((x) => x.id.startsWith('hsa-limit'))!;
      expect(w.message).not.toMatch(/20\d\d limit/);
      expect(w.message).toContain('$8,750');
    } finally {
      pinDate();
    }
  });

  it('say nothing for a plan without an HSA or with sensible contributions', () => {
    expect(ids(golden.planA_simple()).filter((i) => i.startsWith('hsa'))).toEqual([]);
    const ok = withHsa(golden.planA_simple(), { a: { hsa: 10_000, hsaContribution: 4_000 } });
    expect(ids(ok).filter((i) => i.startsWith('hsa'))).toEqual([]);
  });

  it('flag a contribution above the limit, with the mockup wording', () => {
    const p = withHsa(golden.planA_simple(), { a: { hsaContribution: 11_000, hsaCoverage: 'family' } });
    const w = computePlanWarnings(p).find((x) => x.id.startsWith('hsa-limit'))!;
    expect(w.severity).toBe('warn');
    expect(w.message).toBe("Person A's HSA contribution of $11,000 is above the annual limit of $8,750 (today's dollars; the plan raises it with inflation). Capped at the limit.");
    // the catch-up raises the limit at 55
    const old = withHsa({ ...golden.planA_simple(), personA: { ...golden.planA_simple().personA, dob: '1970-01-01' } }, { a: { hsaContribution: 9_750, hsaCoverage: 'family' } });
    expect(ids(old).some((i) => i.startsWith('hsa-limit'))).toBe(false);
  });

  it('flag a contribution when the person is already on Medicare', () => {
    const base = golden.planA_simple();
    const p = withHsa({ ...base, personA: { ...base.personA, dob: '1958-01-01' } }, { a: { hsaContribution: 3_000 } });   // 68
    expect(ids(p)).toContain('hsa-medicare-Person A');
    // delaying Social Security keeps a 66-year-old worker eligible
    const late = withHsa({ ...base, personA: { ...base.personA, dob: '1960-01-01', ssClaimAge: 70 } }, { a: { hsaContribution: 3_000 } });
    expect(ids(late)).not.toContain('hsa-medicare-Person A');
  });

  it('flag two family-coverage spouses asking for more than one shared limit', () => {
    const p = withHsa(golden.planA_simple(), { a: { hsaContribution: 8_000, hsaCoverage: 'family' }, b: { hsaContribution: 8_000, hsaCoverage: 'family' } });
    const w = computePlanWarnings(p).find((x) => x.id === 'hsa-family-pool')!;
    expect(w.message).toMatch(/share one family limit because both are on family coverage/);
    const fine = withHsa(golden.planA_simple(), { a: { hsaContribution: 5_000, hsaCoverage: 'family' }, b: { hsaContribution: 3_000, hsaCoverage: 'family' } });
    expect(ids(fine)).not.toContain('hsa-family-pool');
  });

  it('share the family limit when only one spouse is on family coverage (§223(b)(5))', () => {
    const p = withHsa(golden.planA_simple(), { a: { hsaContribution: 8_000, hsaCoverage: 'family' }, b: { hsaContribution: 4_400 } });
    expect(computePlanWarnings(p).find((x) => x.id === 'hsa-family-pool')?.message).toMatch(/because one of them is on family coverage/);
    // The self-only spouse is held to the family limit, so 6,000 is not "over the self limit".
    const b = withHsa(golden.planA_simple(), { a: { hsaCoverage: 'family' }, b: { hsaContribution: 6_000 } });
    expect(ids(b).some((id) => id.startsWith('hsa-limit-'))).toBe(false);
  });

  it("show the California non-conformity notice only for a CA plan with an HSA", () => {
    const ca = withHsa(golden.planG_californiaCouple(), { a: { hsa: 50_000 } });
    expect(computePlanWarnings(ca).find((w) => w.id === 'hsa-ca-conformity')?.message)
      .toBe("California doesn't recognize HSAs: state tax on HSA growth isn't modeled.");
    expect(ids(golden.planG_californiaCouple())).not.toContain('hsa-ca-conformity');
    expect(ids(withHsa(golden.planA_simple(), { a: { hsa: 50_000 } }))).not.toContain('hsa-ca-conformity');
  });
});

describe('HSA projection warnings (HU-4)', () => {
  it('warn about early non-medical draws that carry the penalty, and not otherwise', () => {
    const rows = runProjection(hsaOnlyPlan(20_000)).rows;
    const w = hsaEarlyDrawWarning(rows)!;
    expect(w.id).toBe('hsa-early-draw');
    expect(w.message).toMatch(/20% penalty/);
    expect(hsaEarlyDrawWarning(runProjection(golden.planA_simple()).rows)).toBeNull();
  });

  it('combine the ACA-floor and early-draw warnings', () => {
    const plan = acaRetireePlan({ pension: 17_000 });
    const out = computeHsaProjectionWarnings(plan, runProjection(plan).rows);
    expect(out.map((w) => w.id)).toContain('hsa-aca-below-fpl');
  });
});
