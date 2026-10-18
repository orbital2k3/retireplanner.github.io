import { describe, expect, it } from 'vitest';
import { parseTipsCsv } from './tipsCsv';

const names = { a: 'Alex', b: 'Jordan' };
const id = (i: number) => `r${i}`;

describe('parseTipsCsv', () => {
  it('parses a header-less comma table with the full column set', () => {
    const r = parseTipsCsv('2031,48000,1.25%,pre-tax,Alex,45000\n2032,48000,0.625%,Pre-tax,Alex,46500\n2033,48000,1.75,taxable,,', names, id);
    expect(r.errors).toEqual([]);
    expect(r.rungs).toEqual([
      { id: 'r0', maturityYear: 2031, adjustedPrincipal: 48_000, couponRate: 0.0125, account: 'traditional', whose: 'A', faceValue: 45_000 },
      { id: 'r1', maturityYear: 2032, adjustedPrincipal: 48_000, couponRate: 0.00625, account: 'traditional', whose: 'A', faceValue: 46_500 },
      { id: 'r2', maturityYear: 2033, adjustedPrincipal: 48_000, couponRate: 0.0175, account: 'taxable', whose: 'Household' },
    ]);
  });

  it('skips a header row, reads tab-separated spreadsheet paste with $ and thousands separators', () => {
    const r = parseTipsCsv('Maturity\tPrincipal\tCoupon\tAccount\tOwner\n02/15/2034\t$52,300.50\t0.125%\tRoth IRA\t\nFeb 2035\t"$10,000"\t0.0125\tIRA\tJordan', names, id);
    expect(r.errors).toEqual([]);
    expect(r.rungs.map((x) => [x.maturityYear, x.adjustedPrincipal, x.couponRate, x.account, x.whose])).toEqual([
      [2034, 52_300.5, 0.00125, 'roth', 'Household'],
      [2035, 10_000, 0.0125, 'traditional', 'B'],
    ]);
  });

  it('reads a coupon as a percent unless it is a decimal under 0.05', () => {
    const c = (s: string) => parseTipsCsv(`2031,1000,${s},taxable`, names, id).rungs[0].couponRate;
    expect(c('1.25')).toBeCloseTo(0.0125, 12);
    expect(c('1.25%')).toBeCloseTo(0.0125, 12);
    expect(c('0.0125')).toBeCloseTo(0.0125, 12);
    expect(c('0.5')).toBeCloseTo(0.005, 12);
    expect(c('0')).toBe(0);
  });

  it('defaults a pre-tax rung to Person A and ignores an owner on taxable and Roth rungs', () => {
    const r = parseTipsCsv('2031,1000,1,traditional\n2032,1000,1,taxable,Jordan\n2033,1000,1,roth,B', names, id);
    expect(r.rungs.map((x) => x.whose)).toEqual(['A', 'Household', 'Household']);
  });

  it('keeps par only when it differs from the principal', () => {
    const r = parseTipsCsv('2031,1000,1,taxable,,1000\n2032,1000,1,taxable,,900', names, id);
    expect('faceValue' in r.rungs[0]).toBe(false);
    expect(r.rungs[1].faceValue).toBe(900);
  });

  it('reports each bad row by line and still returns the good ones', () => {
    const r = parseTipsCsv('2031,1000,1,taxable\nsoon,1000,1,taxable\n2033,-5,1,taxable\n2034,1000,40%,taxable\n2035,1000,1,gold\n2036,1000,1,taxable,,-3\n2037,2000,1,roth', names, id);
    expect(r.rungs.map((x) => x.maturityYear)).toEqual([2031, 2037]);
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4, 5, 6]);
    expect(r.errors[0].message).toMatch(/year/i);
    expect(r.errors[3].message).toMatch(/account/i);
  });

  it('ignores blank lines and returns nothing for empty input', () => {
    expect(parseTipsCsv('', names, id)).toEqual({ rungs: [], errors: [] });
    expect(parseTipsCsv('\n\n2031,1000,1,roth\n\n', names, id).rungs).toHaveLength(1);
  });

  it('a single-person plan maps every pre-tax rung to A', () => {
    const r = parseTipsCsv('2031,1000,1,ira,Jordan', { a: 'Alex' }, id);
    expect(r.rungs[0].whose).toBe('A');
  });
});
