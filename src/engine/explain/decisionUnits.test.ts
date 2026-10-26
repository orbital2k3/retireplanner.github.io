import { describe, it, expect } from 'vitest';
import { runProjection } from '../projection';
import { decisionText, buildYearDecisions, type YearDecisionContext } from './yearDecisions';
import { acaCliffNote } from './headroom';
import { planC_bracketFillConv } from '../__golden/plans';
import type { ProjectionRow } from '../projection';

const usd = (n: number) => '$' + Math.round(n).toLocaleString();

describe("year-decision notes in today's dollars", () => {
  it('ACA cliff note: nominal text keeps nominal amounts, real text deflates them', () => {
    const IF = 1.344;
    const row = { year: 11, ageA: 58, inflationFactor: IF, acaMagi: 764_859, acaPremium: 36_000 } as ProjectionRow;
    const note = acaCliffNote(row, 2, true)!;
    const cliff = 4 * 15960 * IF + 4 * 5680 * IF; // 400% FPL for a household of 2, inflated
    expect(note.text).toContain(usd(764_859));
    expect(note.textReal).toContain(usd(764_859 / IF));
    expect(note.textReal).not.toContain(usd(764_859));
    expect(note.textReal).toContain(usd(cliff / IF));
  });

  it('conversion note: amounts are divided by the inflation factor in the real text', () => {
    const IF = 1.344;
    const base: YearDecisionContext = {
      year: 11, ageA: 58, inflationFactor: IF, conv: 542_337, convPolicyZero: false, convOptimizerSet: true,
      headroomNominal: 542_337, maxConv: 900_000, ceilForConv: 700_000, baseOrdIncome: 11_850, tradBalance: 900_000,
      wdTax: 0, wdTrd: 0, wdRth: 0, gap: 0, rmdTaxable: 0, bracketOverridden: false,
      isActiveBracketfill: false, bracketfillRoom: 0,
    };
    const [note] = buildYearDecisions(base);
    expect(note.text).toContain(usd(542_337));
    expect(note.textReal).toContain(usd(542_337 / IF));
    expect(decisionText(note, true)).toBe(note.textReal);
    expect(decisionText(note, false)).toBe(note.text);
  });

  it('every note from a real projection has a real-dollar variant that differs only in amounts', () => {
    const proj = runProjection(planC_bracketFillConv(), { explain: true });
    expect(proj.decisionNotes.length).toBeGreaterThan(0);
    const shape = (t: string) => t.replace(/\$[\d,]+/g, '$');
    for (const n of proj.decisionNotes) {
      expect(n.textReal, n.code).toBeDefined();
      expect(shape(n.textReal!)).toBe(shape(n.text));
    }
  });
});
