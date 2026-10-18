import { describe, expect, it } from 'vitest';
import { allocateQcd, qcdAvailable, qcdEligible, qcdLimit } from './qcd';
import { QCD_LIMIT_2026 } from './taxConstants';

const person = (over: Partial<{ eligible: boolean; rmd: number; available: number }> = {}) =>
  ({ eligible: true, rmd: 0, available: 500_000, ...over });

describe('qcdEligible (70½ in the calendar year)', () => {
  it('is false before 70 and true from 71', () => {
    expect(qcdEligible('1956-01-01', 69)).toBe(false);
    expect(qcdEligible('1955-12-31', 71)).toBe(true);
    expect(qcdEligible('1950-07-01', 80)).toBe(true);
  });
  it('turning 70 on June 30 reaches 70½ in December of that year', () => {
    expect(qcdEligible('1956-06-30', 70)).toBe(true);
  });
  it('turning 70 on July 1 reaches 70½ on January 1 of the next year', () => {
    expect(qcdEligible('1956-07-01', 70)).toBe(false);
    expect(qcdEligible('1956-07-01', 71)).toBe(true);
  });
  it('January birthdays at 70 are eligible', () => {
    expect(qcdEligible('1956-01-15', 70)).toBe(true);
  });
});

describe('qcdLimit', () => {
  it('is the 2026 limit at inflation factor 1 and scales with it', () => {
    expect(qcdLimit(1)).toBe(QCD_LIMIT_2026);
    expect(qcdLimit(1.5)).toBe(QCD_LIMIT_2026 * 1.5);
  });
});

describe('qcdAvailable', () => {
  it('grows the own balance and adds contributions', () => {
    expect(qcdAvailable(100_000, 0, 0.05, 2_000)).toBeCloseTo(107_000, 6);
  });
  it('excludes inherited balances', () => {
    expect(qcdAvailable(100_000, 40_000, 0, 0)).toBe(60_000);
    expect(qcdAvailable(100_000, 100_000, 0.05, 0)).toBe(0);
  });
  it('is zero for an empty IRA and never negative', () => {
    expect(qcdAvailable(0, 0, 0.05, 0)).toBe(0);
    expect(qcdAvailable(10_000, 50_000, 0, 0)).toBe(0);
  });
});

describe('allocateQcd', () => {
  const L = 111_000;

  it('covers the RMD first, then the excess', () => {
    const r = allocateQcd(20_000, L, person({ rmd: 30_000 }));
    expect(r).toEqual({ qcdA: 20_000, qcdB: 0 });
  });

  it('MFJ: covers A then B RMDs, then sends the excess to A first', () => {
    const r = allocateQcd(60_000, L, person({ rmd: 10_000 }), person({ rmd: 15_000 }));
    // 10k (A rmd) + 15k (B rmd) + 35k excess to A
    expect(r.qcdA).toBe(45_000);
    expect(r.qcdB).toBe(15_000);
  });

  it('MFJ: when giving is below the combined RMDs, A is covered before B', () => {
    const r = allocateQcd(12_000, L, person({ rmd: 10_000 }), person({ rmd: 15_000 }));
    expect(r).toEqual({ qcdA: 10_000, qcdB: 2_000 });
  });

  it('caps each person at the annual limit and spills to the spouse', () => {
    const r = allocateQcd(200_000, L, person(), person());
    expect(r.qcdA).toBe(L);
    expect(r.qcdB).toBe(89_000);
  });

  it('never exceeds total giving or either limit', () => {
    const r = allocateQcd(500_000, L, person(), person());
    expect(r.qcdA).toBe(L);
    expect(r.qcdB).toBe(L);
  });

  it('caps by the person\'s own available balance', () => {
    const r = allocateQcd(50_000, L, person({ available: 8_000 }), person({ available: 100_000 }));
    expect(r).toEqual({ qcdA: 8_000, qcdB: 42_000 });
  });

  it('survivor only: an absent or ineligible spouse gets nothing', () => {
    expect(allocateQcd(30_000, L, person({ rmd: 10_000 }))).toEqual({ qcdA: 30_000, qcdB: 0 });
    expect(allocateQcd(30_000, L, person({ eligible: false }), person({ rmd: 5_000 }))).toEqual({ qcdA: 0, qcdB: 30_000 });
  });

  it('is zero when nobody is eligible or the IRA is empty', () => {
    expect(allocateQcd(30_000, L, person({ eligible: false }), person({ eligible: false }))).toEqual({ qcdA: 0, qcdB: 0 });
    expect(allocateQcd(30_000, L, person({ available: 0 }), person({ available: 0 }))).toEqual({ qcdA: 0, qcdB: 0 });
  });

  it('is zero for zero or negative giving', () => {
    expect(allocateQcd(0, L, person({ rmd: 10_000 }))).toEqual({ qcdA: 0, qcdB: 0 });
    expect(allocateQcd(-5, L, person({ rmd: 10_000 }))).toEqual({ qcdA: 0, qcdB: 0 });
  });

  it('inherited balance excluded: availability, not the allocator, enforces it', () => {
    const availA = qcdAvailable(60_000, 50_000, 0, 0);
    const r = allocateQcd(40_000, L, person({ available: availA }));
    expect(r.qcdA).toBe(10_000);
  });
});
