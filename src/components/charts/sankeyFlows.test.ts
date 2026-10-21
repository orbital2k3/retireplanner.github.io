import { describe, it, expect } from 'vitest';
import { buildSankeyFlows } from './sankeyFlows';
import { runProjection, type ProjectionRow } from '../../engine/projection';
import type { Plan, LumpSumEvent } from '../../schemas/plan';
import * as G from '../../engine/__golden/plans';
import { acaRetireePlan, hsaOnlyPlan, medicalPlan } from '../../engine/__testutil__/hsaPlans';
import { ladderRungs, rung, thisYear, tipsRetireePlan, withTips } from '../../engine/__testutil__/tipsPlans';

const golden = (Object.entries(G).filter(([, f]) => typeof f === 'function') as [string, () => Plan][])
  .map(([name, make]) => [name, make()] as [string, Plan]);

function singlePlan(): Plan {
  const p = G.planB_largeTradSingle();
  p.portfolio.personA = { ...p.portfolio.personA, taxable: 1_500_000, taxableBasis: 900_000 };
  return p;
}
const inherit = (bucket: LumpSumEvent['bucket'], amount: number): LumpSumEvent =>
  ({ id: bucket, description: bucket, whose: 'A', bucket, age: 66, amount });
const withEvents = (events: LumpSumEvent[], strat: Plan['withdrawalStrategy'] = 'taxfirst') => {
  const p = singlePlan(); p.withdrawalStrategy = strat; p.lumpSumEvents = events; return p;
};
const convBrok = () => {
  const p = singlePlan();
  p.conversion = { ...p.conversion, mode: 'bracket-fill', startAge: 65, endAge: 72 };
  p.payTaxFromBrokerage = true;
  return p;
};

/** Single retiree giving $25k a year from an IRA. `born` picks the QCD situation: 1950 pays QCDs inside
 *  the RMD, 1956 (70 in the first year, RMDs from 75) pays them with no RMD at all. */
const qcdGiver = (born: string): Plan => {
  const p = G.planB_largeTradSingle();
  p.personA = { ...p.personA, dob: born, retirementAge: 65 };
  p.expenseStreams = [...p.expenseStreams, {
    id: 'giving', description: 'Giving', whose: 'A', startAge: 65, end: { mode: 'age', age: 95 }, survivorPct: 1,
    annualAmount: 25_000, inflationPct: { mode: 'fixed', rate: 0.025 }, category: 'charitable',
  }];
  return p;
};
/** The same giving marked as not paid to a public charity (donor-advised fund). */
const daf = (p: Plan): Plan => ({ ...p, expenseStreams: p.expenseStreams.map((e) => (e.category === 'charitable' ? { ...e, qcd: false } : e)) });
/** A $60k giver whose other spending (x4) runs the accounts dry, so later years have a shortfall and giving. */
const shortfallGiver = (qcd: boolean): Plan => {
  const p = qcdGiver('1950-01-01');
  p.expenseStreams = p.expenseStreams.map((e) => (e.category === 'charitable'
    ? { ...e, annualAmount: 60_000, ...(qcd ? {} : { qcd: false }) }
    : { ...e, annualAmount: e.annualAmount * 4 }));
  return p;
};

function mixedTips(): Plan {
  const Y = thisYear();
  return withTips(tipsRetireePlan(), [
    ...ladderRungs({ firstYear: Y + 1, years: 5, principal: 25_000, couponRate: 0.012, account: 'taxable' }),
    ...ladderRungs({ firstYear: Y + 3, years: 4, principal: 30_000, couponRate: 0.01, account: 'traditional', whose: 'A' }),
    rung({ maturityYear: Y + 2, adjustedPrincipal: 15_000, couponRate: 0.0125, account: 'roth' }),
  ]);
}

const extra: [string, Plan][] = [
  ['inherited HSA', withEvents([inherit('inheritedHSA', 50_000)])],
  ['inherited IRA taxfirst', withEvents([inherit('inheritedPreTaxIRA', 100_000)])],
  ['inherited IRA tradfirst', withEvents([inherit('inheritedPreTaxIRA', 100_000)], 'tradfirst')],
  ['inherited Roth', withEvents([inherit('inheritedRoth', 100_000)])],
  ['taxable gift', withEvents([inherit('taxable', 50_000)])],
  ['conversion + pay tax from brokerage', convBrok()],
  ['QCD inside the RMD', qcdGiver('1950-01-01')],
  ['QCD beyond the RMD (70, no RMD yet)', qcdGiver('1956-01-01')],
  ['giving before 70½', qcdGiver('1975-01-01')],
  ['giving to a donor-advised fund', daf(qcdGiver('1950-01-01'))],
  ['shortfall years with donor-advised giving', shortfallGiver(false)],
  ['shortfall years with QCD-eligible giving', shortfallGiver(true)],
  ['HSA pays medical + IRMAA', medicalPlan({ a: { hsa: 400_000 }, policyAge: 0 })],
  ['HSA last resort with penalty', hsaOnlyPlan(20_000)],
  ['HSA retiree contribution (ACA)', acaRetireePlan()],
  ['TIPS ladder in all three accounts', mixedTips()],
  ['TIPS taxable ladder, balances on top', withTips(tipsRetireePlan(), ladderRungs({ firstYear: thisYear(), years: 6, principal: 40_000, couponRate: 0.02 }), false)],
];

const TAX = new Set(['fed', 'state']);
const sum = (xs: { value: number }[]) => xs.reduce((s, n) => s + n.value, 0);

function checkRow(row: ProjectionRow, real: boolean) {
  const f = buildSankeyFlows(row, real);
  const sc = (n: number) => (real ? n / row.inflationFactor : n);
  const tag = `age ${row.ageA}`;

  // Sources total = uses total, and links account for every dollar on both sides.
  expect(Math.abs(sum(f.sources) - sum(f.uses)), tag).toBeLessThan(0.5);
  for (const s of f.sources) {
    const out = f.links.filter((l) => l.source === s.id).reduce((a, l) => a + l.amount, 0);
    expect(Math.abs(out - s.value), `${tag} ${s.id}`).toBeLessThan(0.05);
  }
  for (const u of f.uses) {
    const inn = f.links.filter((l) => l.target === u.id).reduce((a, l) => a + l.amount, 0);
    expect(Math.abs(inn - u.value), `${tag} ${u.id}`).toBeLessThan(0.05);
  }

  // Converted to Roth is the full conversion, fed only by the conversion.
  const toRoth = f.uses.find((u) => u.id === 'toRoth')?.value ?? 0;
  expect(toRoth, tag).toBeCloseTo(sc(row.rothConv), 6);
  for (const l of f.links.filter((l) => l.source === 'conv')) expect(l.target, tag).toBe('toRoth');

  // Brokerage tax payment feeds tax bars only.
  for (const l of f.links.filter((l) => l.source === 'brokTax')) expect(TAX.has(l.target), tag).toBe(true);

  // Roth withdrawals never feed a tax bar.
  expect(f.links.some((l) => l.source === 'wdRth' && TAX.has(l.target)), tag).toBe(false);

  // Net Savings ties to engine savings.
  const save = f.uses.find((u) => u.id === 'save')?.value ?? 0;
  expect(Math.abs(save - sc(row.cashSurplus + row.contribA + row.contribB)), tag).toBeLessThan(1);

  // The safety node should never appear for a valid plan.
  const draw = f.sources.find((s) => s.id === 'draw')?.value ?? 0;
  expect(draw, tag).toBeLessThan(1);
}

describe('buildSankeyFlows', () => {
  for (const [name, plan] of [...golden, ...extra]) {
    it(`${name}: ledger balances and ties to the engine every year`, () => {
      for (const row of runProjection(plan).rows) {
        checkRow(row, true);
        checkRow(row, false);
      }
    });
  }

  it('conversion + brokerage plan actually exercises the brokerage tax node', () => {
    const rows = runProjection(convBrok()).rows;
    const hits = rows.filter((r) => buildSankeyFlows(r).links.some((l) => l.source === 'brokTax'));
    expect(hits.length).toBeGreaterThan(0);
  });

  it('QCD years send the QCD straight to a Charity use; the RMD source is only the cash part', () => {
    const rows = runProjection(qcdGiver('1950-01-01')).rows.filter((r) => r.qcd > 0);
    expect(rows.length).toBeGreaterThan(5);
    for (const row of rows) {
      const f = buildSankeyFlows(row, false);
      expect(f.links.filter((l) => l.source === 'qcd').map((l) => l.target)).toEqual(['charity']);
      expect(f.sources.find((s) => s.id === 'qcd')?.value).toBeCloseTo(row.qcd, 6);
      expect(f.uses.find((u) => u.id === 'charity')?.value).toBeCloseTo(row.charitableSpend, 6);
      expect(f.sources.find((s) => s.id === 'rmd')?.value ?? 0).toBeCloseTo(row.rmd - (row.qcd - row.qcdBeyondRmd), 6);
      // Net Spending excludes all giving, so spending + charity = the row's netSpend.
      expect((f.uses.find((u) => u.id === 'spend')?.value ?? 0) + row.charitableSpend).toBeCloseTo(row.netSpend, 6);
    }
  });

  it('giving that is not a QCD (before 70½, or to a donor-advised fund) is a Charity use paid from the pool', () => {
    for (const [label, plan] of [['before 70½', qcdGiver('1975-01-01')], ['DAF', daf(qcdGiver('1950-01-01'))]] as const) {
      const rows = runProjection(plan).rows.filter((r) => r.charitableSpend > 0 && r.qcd === 0);
      expect(rows.length, label).toBeGreaterThan(0);
      for (const row of rows) {
        const f = buildSankeyFlows(row, false);
        expect(f.uses.find((u) => u.id === 'charity')?.value, label).toBeCloseTo(row.charitableSpend, 6);
        expect(f.uses.find((u) => u.id === 'charity')?.label).toBe('Charity');
        expect(f.links.some((l) => l.source === 'qcd')).toBe(false);
        const intoCharity = f.links.filter((l) => l.target === 'charity').reduce((s, l) => s + l.amount, 0);
        expect(intoCharity, label).toBeCloseTo(row.charitableSpend, 1);
      }
    }
  });

  it('a plan with no QCD has no QCD source or Charity use', () => {
    for (const row of runProjection(G.planA_simple()).rows) {
      const f = buildSankeyFlows(row);
      expect(f.sources.some((s) => s.id === 'qcd')).toBe(false);
      expect(f.uses.some((u) => u.id === 'charity')).toBe(false);
    }
  });

  it('inheritance years show inherited cash as income', () => {
    const row = runProjection(extra[0][1]).rows.find((r) => r.ageA === 66)!;
    const inh = buildSankeyFlows(row, false).sources.find((s) => s.id === 'inh');
    expect(inh?.value).toBeCloseTo(50_000, 0);
  });

  it('depletion years route unfunded spending to Net Spending only', () => {
    const p = G.planA_simple();
    p.expenseStreams = p.expenseStreams.map((e) => ({ ...e, annualAmount: e.annualAmount * 3 }));
    const rows = runProjection(p).rows.filter((r) => r.shortfall > 0);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      checkRow(row, true);
      const gapLinks = buildSankeyFlows(row).links.filter((l) => l.source === 'gap');
      expect(gapLinks.map((l) => l.target)).toEqual(['spend']);
    }
  });

  it('shortfall years with giving split the unfunded amount between Net Spending and Charity', () => {
    for (const qcd of [false, true]) {
      const rows = runProjection(shortfallGiver(qcd)).rows.filter((r) => r.shortfall > 0 && r.charitableSpend > r.qcd);
      expect(rows.length, `qcd ${qcd}`).toBeGreaterThan(0);
      for (const row of rows) {
        const f = buildSankeyFlows(row, false);
        const gap = f.links.filter((l) => l.source === 'gap');
        expect(gap.map((l) => l.target).sort(), `age ${row.ageA}`).toEqual(['charity', 'spend']);
        expect(gap.reduce((s, l) => s + l.amount, 0)).toBeCloseTo(row.shortfall, 6);
        // Each use gets the same unfunded share of what the pool had to pay for it.
        const spend = f.uses.find((u) => u.id === 'spend')!.value;
        const gifts = row.charitableSpend - row.qcd;
        const toSpend = gap.find((l) => l.target === 'spend')!.amount;
        const toCharity = gap.find((l) => l.target === 'charity')!.amount;
        expect(toSpend / spend).toBeCloseTo(toCharity / gifts, 9);
      }
    }
  });

  it('HSA qualified payments go straight to a Medical use; the HSA never shows as a cash source for them', () => {
    const rows = runProjection(medicalPlan({ a: { hsa: 400_000 }, policyAge: 0 })).rows.filter((r) => r.hsaQualifiedWD > 0);
    expect(rows.length).toBeGreaterThan(5);
    for (const row of rows) {
      const f = buildSankeyFlows(row, false);
      expect(f.links.filter((l) => l.source === 'hsaQual').map((l) => l.target)).toEqual(['medical']);
      expect(f.uses.find((u) => u.id === 'medical')?.value).toBeCloseTo(row.hsaQualifiedWD, 6);
      // net spending excludes the medical bills the HSA paid
      expect((f.uses.find((u) => u.id === 'spend')?.value ?? 0) + Math.min(row.hsaQualifiedWD, row.medicalSpend)).toBeCloseTo(row.netSpend, 6);
    }
  });

  it('a retiree HSA contribution and an early-draw penalty are uses paid from the pool', () => {
    const c = runProjection(acaRetireePlan()).rows[0];
    expect(buildSankeyFlows(c, false).uses.find((u) => u.id === 'hsaContrib')?.value).toBeCloseTo(c.hsaContribRet, 6);
    const p = runProjection(hsaOnlyPlan(20_000)).rows.find((r) => r.hsaPenalty > 0)!;
    expect(buildSankeyFlows(p, false).uses.find((u) => u.id === 'hsaPenalty')?.value).toBeCloseTo(p.hsaPenalty, 6);
  });

  it('a plan without an HSA has no HSA source or use', () => {
    for (const row of runProjection(G.planA_simple()).rows) {
      const f = buildSankeyFlows(row);
      expect([...f.sources, ...f.uses].some((n) => /hsa|medical/i.test(n.id))).toBe(false);
    }
  });

  it('taxable TIPS cash is a general source taxed by the ladder income; IRA and Roth rungs are not household cash', () => {
    const rows = runProjection(mixedTips()).rows;
    const hit = rows.filter((r) => r.tipsCash > 0);
    expect(hit.length).toBeGreaterThanOrEqual(5);
    for (const row of hit) {
      const f = buildSankeyFlows(row, false);
      const src = f.sources.find((x) => x.id === 'tips')!;
      expect(src.value).toBeCloseTo(row.tipsCash, 6);
      expect(src.taxBase).toBeCloseTo(row.tipsOrdInc, 6);
      expect(src.route).toBe('general');
    }
    // IRA / Roth-only years have no TIPS source even though the sleeve pays into the accounts
    const iraOnly = rows.find((r) => r.tipsToTrad > 0 && r.tipsCash === 0);
    expect(iraOnly).toBeDefined();
    expect(buildSankeyFlows(iraOnly!, false).sources.some((x) => x.id === 'tips')).toBe(false);
  });

  it('a plan without a ladder has no TIPS source', () => {
    for (const row of runProjection(G.planA_simple()).rows) {
      expect(buildSankeyFlows(row).sources.some((x) => x.id === 'tips')).toBe(false);
    }
  });
});
