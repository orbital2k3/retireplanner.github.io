import { Fragment, useState, useRef, useEffect, useMemo } from 'react';
import { useProjection, usePlanStore } from '../store/usePlanStore';
import StalePlanBanner from '../components/StalePlanBanner';
import type { DisplayMode } from '../store/usePlanStore';
import { fmtUSD, fmtFull } from '../lib/format';
import CashFlowsBalanced from '../components/charts/CashFlowsBalanced';
import WhatIfBar from '../components/WhatIfBar';
import ChartFrame from '../components/charts/ChartFrame';
import { decisionText, type YearDecision } from '../engine/explain/yearDecisions';

const fmt = (n: number, mode: DisplayMode, inflF: number): string => {
  if (!isFinite(n) || n === 0) return '—';
  const v = mode === 'real' ? n / inflF : n;
  return fmtUSD(v);
};

/** Beginning balances are last year's ending balances: same moment, so in today's dollars they must use the
 *  same price level as that End column (the previous row's factor), not this row's. Row 1 is today. */
const BEG_KEYS: ReadonlySet<string> = new Set(['begTaxable', 'begTraditional', 'begRoth', 'inheritedBegBal']);
const deflatorFor = (key: string, rows: readonly Row[], i: number): number =>
  BEG_KEYS.has(key) && i > 0 ? rows[i - 1].inflationFactor : rows[i].inflationFactor;

// Sticky-cell base style; per-column `left` offsets stack against each other.
const stickyTh = (left: number, bg = '#e2e4e6', minWidth = 60): React.CSSProperties => ({
  position: 'sticky', top: 0, left, background: bg, zIndex: 4, minWidth,
});
const stickyTd = (left: number, bg = '#fff', minWidth = 60): React.CSSProperties => ({
  position: 'sticky', left, background: bg, zIndex: 2, minWidth,
});

type Row = ReturnType<typeof useProjection>['rows'][number];
type Money = (n: number) => string;
type GroupKey = 'income' | 'withdrawals' | 'spending' | 'taxes' | 'qcd' | 'hsa' | 'tips' | 'balances' | 'decisions';

interface Column {
  key: string;
  label: string;
  group: 'identity' | GroupKey;
  essential: boolean;
  fmt?: 'money' | 'pct' | 'raw';
  get: (r: Row) => number | string;
  /** `$` formats money the way the cells show it (today's or nominal dollars). */
  tooltip?: (r: Row, $: Money) => string;
  bg: string;
}

const BG: Record<'identity' | GroupKey, string> = {
  identity:    '#e2e4e6',
  income:      '#eee3c6',
  withdrawals: '#d4e8d8',
  spending:    '#e8d8ee',
  taxes:       '#ced7e2',
  qcd:         '#f5e9c8',
  hsa:         '#e8f7f0',
  tips:        '#efeaf6',
  balances:    '#d3d6d9',
  decisions:   '#dce8e8',
};

/**
 * Deductions only exist against income. Accumulation years have no ordinary income and no LTCG
 * (wages are not modeled — contributions are the only cash flow), so reporting a standard
 * deduction there is noise: it reads as a tax figure in a row where every other tax column is 0.
 * A pre-retirement year that DOES have income — a manual Roth conversion — still reports it,
 * because the deduction is genuinely applied to that year's tax.
 */
const deductionApplies = (r: Row) => r.ordIncome + r.ltcg > 0;

const inheritedIncome = (r: Row) => (r.lumpSumOrdinaryIncome ?? 0) + (r.lumpSumForcedRothDist ?? 0)
  + (r.inheritedTradFromWd ?? 0) + (r.inheritedRothFromWd ?? 0);

/** Splits a year's Charitable spending into the QCD part and the part paid from other accounts. */
const givingTooltip = (r: Row, $: Money): string => {
  if (!(r.charitableSpend > 0)) return '';
  const other = Math.max(0, r.charitableSpend - r.qcd);
  return r.qcd > 0
    ? `${$(r.qcd)} paid from your IRA as a QCD; ${$(other)} paid from your other accounts.`
    : 'Paid from your other accounts (no QCD this year). Included in Net Spending.';
};

/** Explains a year where part of the RMD (or more) was paid straight to charity as a QCD. */
const rmdTooltip = (r: Row, $: Money): string => {
  if (!(r.qcd > 0)) return '';
  const satisfied = r.qcd - r.qcdBeyondRmd;
  let text = `Required ${$(r.rmd)}. ${$(satisfied)} went straight to charity as a QCD (not taxed); ${$(Math.max(0, r.rmd - satisfied))} came to you as cash.`;
  if (r.qcdBeyondRmd > 0) text += ` A further ${$(r.qcdBeyondRmd)} QCD went to charity beyond the RMD.`;
  if (r.qcdTaxable > 0) text += ` ${QCD_TAXED(r, $)}`;
  return text;
};

/** The part of a QCD the §408(d)(8)(A) rule taxes: deductible IRA contributions made from 70½ on. */
const QCD_TAXED = (r: Row, $: Money): string =>
  `${$(r.qcdTaxable)} of the QCD was taxed anyway, because deductible IRA contributions made from age 70½ reduce the tax-free amount.`;

const COLUMNS: Column[] = [
  // Identity (always shown, sticky)
  { key: 'year',  label: 'Yr',    group: 'identity', essential: true, fmt: 'raw', get: (r) => r.year,       bg: BG.identity },
  { key: 'ageA',  label: 'Age A', group: 'identity', essential: true, fmt: 'raw', get: (r) => r.ageA,       bg: BG.identity },
  { key: 'ageB',  label: 'Age B', group: 'identity', essential: true, fmt: 'raw', get: (r) => r.ageB ?? '—', bg: BG.identity },
  { key: 'phase', label: 'Phase', group: 'identity', essential: true, fmt: 'raw', get: (r) => r.phase,      bg: BG.identity },

  // Income — what flows in from outside accounts
  { key: 'totalSS',             label: 'Total SS',        group: 'income', essential: true,  fmt: 'money', get: (r) => r.totalSS,                                                                               bg: BG.income },
  { key: 'otherIncome',         label: 'Other Inc',       group: 'income', essential: true,  fmt: 'money', get: (r) => r.otherIncome,                                                                           bg: BG.income },
  { key: 'ordinaryDiv',         label: 'Ord Div',         group: 'income', essential: false, fmt: 'money', get: (r) => r.ordinaryDiv  ?? 0,                                                                     bg: BG.income },
  { key: 'qualifiedDiv',        label: 'Qual Div',        group: 'income', essential: false, fmt: 'money', get: (r) => r.qualifiedDiv ?? 0,                                                                     bg: BG.income },
  { key: 'exemptInterest',      label: 'Tax-Exempt Int',  group: 'income', essential: false, fmt: 'money', get: (r) => r.exemptInterest ?? 0,                                                                    bg: BG.income },
  { key: 'distributedCash',     label: 'Div Paid Out',    group: 'income', essential: false, fmt: 'money', get: (r) => r.distributedCash ?? 0,                                                                   bg: BG.income },
  { key: 'lumpSumInject',       label: 'Lump Sum',        group: 'income', essential: true,  fmt: 'money', get: (r) => (r.lumpSumInjectTaxable ?? 0) + (r.lumpSumInjectTrad ?? 0) + (r.lumpSumInjectRoth ?? 0), bg: BG.income },
  { key: 'lumpSumOrdinaryIncome', label: 'Inherited Inc', group: 'income', essential: false, fmt: 'money', get: inheritedIncome, tooltip: (r, $) => `Required minimum: ${$((r.lumpSumOrdinaryIncome ?? 0) + (r.lumpSumForcedRothDist ?? 0))} · Extra from your withdrawal strategy: ${$((r.inheritedTradFromWd ?? 0) + (r.inheritedRothFromWd ?? 0))}`, bg: BG.income },
  { key: 'contribA',            label: 'Contrib A',       group: 'income', essential: false, fmt: 'money', get: (r) => r.contribA,                                                                              bg: BG.income },
  { key: 'contribB',            label: 'Contrib B',       group: 'income', essential: false, fmt: 'money', get: (r) => r.contribB,                                                                              bg: BG.income },
  // Spousal IRA portion of Contrib A/B — without this, the contribution column drops from a
  // full salary deferral to a few thousand at the retirement boundary with no visible reason.
  { key: 'spousalIRA',          label: 'Spousal IRA',     group: 'income', essential: false, fmt: 'money', get: (r) => (r.spousalA ?? 0) + (r.spousalB ?? 0),                                                 bg: BG.income },
  { key: 'cashSurplus',         label: 'Cash Surplus',    group: 'income', essential: false, fmt: 'money', get: (r) => r.cashSurplus ?? 0,                                                                      bg: BG.income },

  // Withdrawals — portfolio draws and conversion activity
  // Withdrawals from inherited accounts are shown in Inherited Inc, so these cover your own accounts only.
  { key: 'totalWD',   label: 'Total WD',   group: 'withdrawals', essential: true,  fmt: 'money', get: (r) => r.totalWD - (r.inheritedTradFromWd ?? 0) - (r.inheritedRothFromWd ?? 0), bg: BG.withdrawals },
  { key: 'wdTax',     label: 'WD Taxable', group: 'withdrawals', essential: false, fmt: 'money', get: (r) => r.wdTax,     bg: BG.withdrawals },
  { key: 'wdTrd',     label: 'WD Pre-tax', group: 'withdrawals', essential: false, fmt: 'money', get: (r) => r.wdTrd - (r.inheritedTradFromWd ?? 0), bg: BG.withdrawals },
  { key: 'wdRth',     label: 'WD Roth',    group: 'withdrawals', essential: false, fmt: 'money', get: (r) => r.wdRth - (r.inheritedRothFromWd ?? 0), bg: BG.withdrawals },
  { key: 'rmd',       label: 'RMD',        group: 'withdrawals', essential: false, fmt: 'money', get: (r) => r.rmd,       tooltip: rmdTooltip, bg: BG.withdrawals },
  { key: 'rothConv',  label: 'Roth Conv',  group: 'withdrawals', essential: false, fmt: 'money', get: (r) => r.rothConv,  bg: BG.withdrawals },

  // Spending — what you actually consume
  { key: 'netSpend',   label: 'Net Spend',   group: 'spending', essential: true,  fmt: 'money', get: (r) => r.netSpend,   bg: BG.spending },
  { key: 'acaPremium', label: 'ACA Premium', group: 'spending', essential: false, fmt: 'money', get: (r) => r.acaPremium, tooltip: (r, $) => `ACA MAGI (AGI + non-taxable SS): ${$(r.acaMagi)}`, bg: BG.spending },

  // Taxes — inputs first (what creates the liability), then outputs (what you pay)
  { key: 'ordIncome',    label: 'Ord Income',  group: 'taxes', essential: true,  fmt: 'money', get: (r) => r.ordIncome,                              bg: BG.taxes },
  { key: 'ltcg',         label: 'LTCG',        group: 'taxes', essential: true,  fmt: 'money', get: (r) => r.ltcg,                                   bg: BG.taxes },
  { key: 'stdDeduction', label: 'Std Deduct',  group: 'taxes', essential: false, fmt: 'money', get: (r) => deductionApplies(r) ? r.stdDeduction - r.seniorBonus - r.charityDeduction : 0, bg: BG.taxes },
  { key: 'seniorBonus',  label: 'Senior Bonus',group: 'taxes', essential: false, fmt: 'money', get: (r) => deductionApplies(r) ? r.seniorBonus : 0,     bg: BG.taxes },
  { key: 'taxableIncome',label: 'Taxable Inc', group: 'taxes', essential: false, fmt: 'money', get: (r) => Math.max(0, r.magi - r.stdDeduction),     bg: BG.taxes },
  { key: 'fedTax',       label: 'Fed Tax',     group: 'taxes', essential: true,  fmt: 'money', get: (r) => r.fedTax,                                 bg: BG.taxes },
  { key: 'stateTaxAmt',  label: 'State Tax',   group: 'taxes', essential: false, fmt: 'money', get: (r) => r.stateTaxAmt,                            bg: BG.taxes },
  { key: 'irmaa',        label: 'IRMAA',       group: 'taxes', essential: false, fmt: 'money', get: (r) => r.irmaa,        tooltip: (r, $) => `IRMAA MAGI (AGI, 2-yr lookback): ${$(r.irmaaMagi)}`, bg: BG.taxes },
  { key: 'niit',         label: 'NIIT',        group: 'taxes', essential: false, fmt: 'money', get: (r) => r.niit,                                   bg: BG.taxes },
  { key: 'effRate',      label: 'Eff Rate',    group: 'taxes', essential: false, fmt: 'pct',   get: (r) => r.effRate * 100,                          bg: BG.taxes },

  // Giving — all Charitable-tagged spending, the part paid straight from an IRA as a QCD, and the cash-gift
  // deduction. Shown by default only when the plan has giving (see `qcdAuto`); always in the chooser and CSV.
  { key: 'giving',           label: 'Giving',       group: 'qcd', essential: false, fmt: 'money', get: (r) => r.charitableSpend, tooltip: givingTooltip, bg: BG.qcd },
  { key: 'qcd',              label: 'QCD',          group: 'qcd', essential: false, fmt: 'money', get: (r) => r.qcd, tooltip: (r, $) => r.qcd > 0 ? (r.qcdTaxable > 0 ? `Paid from your IRA straight to charity. ${QCD_TAXED(r, $)}` : 'Paid from your IRA straight to charity, so it is not taxed.') + ` ${$(r.qcd - r.qcdBeyondRmd)} of it counts toward your RMD.` : '', bg: BG.qcd },
  { key: 'charityDeduction', label: 'Charity ded.', group: 'qcd', essential: false, fmt: 'money', get: (r) => r.charityDeduction, tooltip: (r) => r.charityDeduction > 0 ? 'Deduction for cash gifts to public charities when you don\'t itemize (from 2026: up to $1,000, or $2,000 joint). Included in the standard deduction total.' : '', bg: BG.qcd },

  // HSA — opt-in through the column chooser (and the CSV). Shown to every plan, but all zero without an HSA.
  { key: 'endHSA',          label: 'HSA Bal.',     group: 'hsa', essential: false, fmt: 'money', get: (r) => r.endHSA, tooltip: (r, $) => r.endHSA > 0 ? `Year-end HSA balance (included in End Total). Receipts on file: ${$(r.hsaReceiptsBal)}.` : '', bg: BG.hsa },
  { key: 'hsaContrib',      label: 'HSA Contrib',  group: 'hsa', essential: false, fmt: 'money', get: (r) => r.hsaContrib, tooltip: (r, $) => r.hsaContribRet > 0 ? `Includes ${$(r.hsaContribRet)} paid from your portfolio after retiring. That part is deducted from income (state income too, except in California), which can lower your ACA income.` : '', bg: BG.hsa },
  { key: 'hsaQualifiedWD',  label: 'HSA Paid',     group: 'hsa', essential: false, fmt: 'money', get: (r) => r.hsaQualifiedWD, tooltip: (r, $) => r.hsaQualifiedWD > 0 ? `Medical bills and Medicare surcharges paid tax-free from the HSA (medical bills this year: ${$(r.medicalSpend)}).` : '', bg: BG.hsa },
  { key: 'hsaReimbursed',   label: 'HSA Reimb.',   group: 'hsa', essential: false, fmt: 'money', get: (r) => r.hsaReimbursed, tooltip: (r) => r.hsaReimbursed > 0 ? 'Past medical bills reimbursed from the HSA tax-free. Used only after your other accounts ran out.' : '', bg: BG.hsa },
  { key: 'hsaNonQualWD',    label: 'HSA Non-qual', group: 'hsa', essential: false, fmt: 'money', get: (r) => r.hsaNonQualWD, tooltip: (r) => r.hsaNonQualWD > 0 ? 'Taken from the HSA for non-medical spending: taxed as ordinary income, plus a 20% penalty before 65.' : '', bg: BG.hsa },
  { key: 'hsaPenalty',      label: 'HSA Penalty',  group: 'hsa', essential: false, fmt: 'money', get: (r) => r.hsaPenalty, bg: BG.hsa },
  { key: 'hsaReceiptsBal',  label: 'Receipts',     group: 'hsa', essential: false, fmt: 'money', get: (r) => r.hsaReceiptsBal, tooltip: () => 'Medical bills you paid from other accounts. They can be reimbursed from the HSA later, tax-free.', bg: BG.hsa },

  // TIPS ladder — opt-in through the column chooser (and the CSV); all zero without a ladder.
  { key: 'endTips',        label: 'Ladder Bal.',  group: 'tips', essential: false, fmt: 'money', get: (r) => r.endTipsTaxable + r.endTipsTrad + r.endTipsRoth, tooltip: (r, $) => r.endTipsTaxable + r.endTipsTrad + r.endTipsRoth > 0 ? `Indexed value of the bonds still held (included in End Total): taxable ${$(r.endTipsTaxable)}, pre-tax ${$(r.endTipsTrad)}, Roth ${$(r.endTipsRoth)}. It follows inflation, not market returns.` : '', bg: BG.tips },
  { key: 'tipsCoupon',     label: 'TIPS Coupon',  group: 'tips', essential: false, fmt: 'money', get: (r) => r.tipsCoupon, tooltip: (r) => r.tipsCoupon > 0 ? `Interest paid by the bonds this year. Taxable rungs pay it to you as cash; pre-tax and Roth rungs pay it back into the account.` : '', bg: BG.tips },
  { key: 'tipsAccrual',    label: 'TIPS Accrual', group: 'tips', essential: false, fmt: 'money', get: (r) => r.tipsAccrual, tooltip: (r) => r.tipsAccrual !== 0 ? 'Inflation increase in the bonds\' principal. On taxable rungs it is taxable income with no cash until maturity ("phantom income"); inside an IRA or Roth it is not taxed.' : '', bg: BG.tips },
  { key: 'tipsMaturity',   label: 'TIPS Maturity',group: 'tips', essential: false, fmt: 'money', get: (r) => r.tipsMaturity, tooltip: (r, $) => r.tipsMaturity > 0 ? `Principal paid out by bonds maturing this year${r.tipsFloorBonus > 0 ? ` (includes ${$(r.tipsFloorBonus)} from the deflation floor)` : ''}.` : '', bg: BG.tips },
  { key: 'tipsOrdInc',     label: 'TIPS Taxable', group: 'tips', essential: false, fmt: 'money', get: (r) => r.tipsOrdInc, tooltip: (r) => r.tipsOrdInc > 0 ? 'Federal ordinary income from taxable rungs (coupons plus inflation increase). Not taxed by your state. Counted from the first year either of you has retired.' : '', bg: BG.tips },
  { key: 'rmdUnmet',       label: 'RMD Unmet',    group: 'tips', essential: false, fmt: 'money', get: (r) => r.rmdUnmet, tooltip: (r) => r.rmdUnmet > 0 ? 'Part of the required withdrawal the plan could not take because the IRA money left is tied up in ladder bonds. The plan holds bonds to maturity and does not model taking them out in kind; in real life the shortfall would be taken in kind or risk a penalty.' : '', bg: BG.tips },

  // Balances — end-of-year portfolio state
  { key: 'endTotal',       label: 'End Total', group: 'balances', essential: true,  fmt: 'money', get: (r) => r.endTotal,       bg: BG.balances },
  { key: 'begTaxable',     label: 'Beg Tax',   group: 'balances', essential: false, fmt: 'money', get: (r) => r.begTaxable,     bg: BG.balances },
  { key: 'begTraditional', label: 'Beg Trd',   group: 'balances', essential: false, fmt: 'money', get: (r) => r.begTraditional - ((r.inheritedBegBal ?? 0) - (r.inheritedRothBegBal ?? 0)), bg: BG.balances },
  { key: 'begRoth',        label: 'Beg Roth',  group: 'balances', essential: false, fmt: 'money', get: (r) => r.begRoth - (r.inheritedRothBegBal ?? 0), bg: BG.balances },
  { key: 'inheritedBegBal', label: 'Beg Inh',  group: 'balances', essential: false, fmt: 'money', get: (r) => r.inheritedBegBal ?? 0, tooltip: () => 'Money in inherited accounts at the start of the year. Beg Trd and Beg Roth cover your own accounts only.', bg: BG.balances },
  { key: 'endTaxable',     label: 'End Tax',    group: 'balances', essential: false, fmt: 'money', get: (r) => r.endTaxable,        bg: BG.balances },
  { key: 'endTraditional', label: 'End Trd',    group: 'balances', essential: false, fmt: 'money', get: (r) => r.endTraditional - ((r.inheritedBal ?? 0) - (r.inheritedRothBal ?? 0)), bg: BG.balances },
  { key: 'endRoth',        label: 'End Roth',   group: 'balances', essential: false, fmt: 'money', get: (r) => r.endRoth - (r.inheritedRothBal ?? 0), bg: BG.balances },
  { key: 'inheritedBal',   label: 'End Inh',    group: 'balances', essential: false, fmt: 'money', get: (r) => r.inheritedBal ?? 0, tooltip: () => 'Money left in inherited accounts at the end of the year. End Trd and End Roth cover your own accounts only.', bg: BG.balances },
  { key: 'endTaxableBasis',label: 'End Basis',  group: 'balances', essential: false, fmt: 'money', get: (r) => r.endTaxableBasis ?? 0, tooltip: (r, $) => `Unrealized gain: ${$(Math.max(0, r.endTaxable - (r.endTaxableBasis ?? 0)))}`, bg: BG.balances },
  { key: 'endTaxAdjusted', label: 'End Tax-Adj',group: 'balances', essential: false, fmt: 'money', get: (r) => r.endTaxAdjusted ?? 0, tooltip: (r, $) => `Gross ${$(r.endTotal)} less est. tax on pre-tax balance and unrealized gains`, bg: BG.balances },
];

/** A column's value exactly as the table shows it (so a tooltip's terms match the cells). */
const colVal = (key: string, r: Row): number => Number(COLUMNS.find((c) => c.key === key)!.get(r));

/**
 * One line of arithmetic with this row's numbers: `Name $total = Term $a + Term $b − Term $c`.
 * Parts are signed values; zero terms are left out. `plug` names whatever the listed terms do not
 * explain (growth, rounding, items with no column), so the line always adds up to the total.
 */
const eq = (name: string, total: number, parts: Array<[string, number]>, $: Money, plug?: string): string => {
  const all = [...parts];
  if (plug) all.push([plug, total - parts.reduce((t, [, v]) => t + v, 0)]);
  const shown = all.filter(([, v]) => Math.abs(v) >= 0.5);
  const body = shown.length
    ? shown.map(([label, v], i) => `${i === 0 ? (v < 0 ? '−' : '') : v < 0 ? ' − ' : ' + '}${label} ${$(Math.abs(v))}`).join('')
    : '$0';
  return `${name} ${$(total)} = ${body}`;
};

/** Social Security that was taxable this year: Total SS less the part ACA MAGI adds back as non-taxable. */
const taxableSS = (r: Row): number => Math.max(0, r.totalSS - (r.acaMagi - r.ordIncome - r.ltcg - r.exemptInterest));

/** Numbers-in-place formulas, shown above the rules text in each cell's tooltip. */
const CALC: Record<string, (r: Row, $: Money) => string> = {
  ordinaryDiv: (r, $) => r.begTaxable > 0 ? `Beg Tax ${$(r.begTaxable)} × ${((r.ordinaryDiv ?? 0) / r.begTaxable * 100).toFixed(2)}% (Dividend Yield × (1 − Qualified %)) = ${$(r.ordinaryDiv ?? 0)}` : '',
  qualifiedDiv: (r, $) => r.begTaxable > 0 ? `Beg Tax ${$(r.begTaxable)} × ${((r.qualifiedDiv ?? 0) / r.begTaxable * 100).toFixed(2)}% (Dividend Yield × Qualified %) = ${$(r.qualifiedDiv ?? 0)}` : '',
  distributedCash: (r, $) => {
    const inc = (r.ordinaryDiv ?? 0) + (r.qualifiedDiv ?? 0) + (r.exemptInterest ?? 0);
    return inc > 0 ? `(Ord Div ${$(r.ordinaryDiv ?? 0)} + Qual Div ${$(r.qualifiedDiv ?? 0)} + Tax-Exempt Int ${$(r.exemptInterest ?? 0)}) × ${(((r.distributedCash ?? 0) / inc) * 100).toFixed(0)}% paid out in cash = ${$(r.distributedCash ?? 0)}` : '';
  },
  cashSurplus: (r, $) => (r.cashSurplus ?? 0) > 0
    ? eq('Cash Surplus', r.cashSurplus, [['Total SS', r.totalSS], ['Other Inc', r.otherIncome], ['Div Paid Out', r.distributedCash ?? 0], ['RMD', r.rmd],
        ['Net Spend', -r.netSpend], ['Fed Tax', -r.fedTax], ['State Tax', -r.stateTaxAmt], ['IRMAA', -r.irmaa], ['NIIT', -r.niit], ['ACA Premium', -r.acaPremium]], $, 'other')
    : 'No surplus: Total SS + Other Inc + Div Paid Out + RMD did not exceed Net Spend plus taxes and premiums.',
  totalWD: (r, $) => eq('Total WD', colVal('totalWD', r), [['WD Taxable', colVal('wdTax', r)], ['WD Pre-tax', colVal('wdTrd', r)], ['WD Roth', colVal('wdRth', r)]], $)
    + '\n' + eq('Cash needed', r.totalWD, [['Net Spend', r.netSpend], ['Fed Tax', r.fedTax], ['State Tax', r.stateTaxAmt], ['IRMAA', r.irmaa], ['NIIT', r.niit], ['ACA Premium', r.acaPremium],
        ['Total SS', -r.totalSS], ['Other Inc', -r.otherIncome], ['RMD', -r.rmd], ['Div Paid Out', -(r.distributedCash ?? 0)]], $, 'other (HSA, ladder, rounding)'),
  rmd: (r, $) => r.rmd > 0 && colVal('begTraditional', r) > 0
    ? `Beg Trd ${$(colVal('begTraditional', r))} ÷ ${(colVal('begTraditional', r) / r.rmd).toFixed(1)} (IRS divisor for your age) = ${$(r.rmd)}` : '',
  acaPremium: (r, $) => eq('ACA MAGI', r.acaMagi, [['Ord Income', r.ordIncome], ['LTCG', r.ltcg], ['Tax-Exempt Int', r.exemptInterest ?? 0], ['Total SS (non-taxable part)', r.totalSS - taxableSS(r)]], $, 'other'),
  ordIncome: (r, $) => eq('Ord Income', r.ordIncome, [['Total SS (taxable part)', taxableSS(r)], ['Other Inc (taxable part)', r.otherIncomeTaxable], ['WD Pre-tax', r.wdTrd],
        ['RMD', r.rmd], ['Roth Conv', r.rothConv], ['Ord Div', r.ordinaryDiv ?? 0]], $, 'other taxable (lump sum, TIPS, HSA)'),
  ltcg: (r, $) => eq('LTCG', r.ltcg, [['gain part of WD Taxable', r.ltcg - (r.qualifiedDiv ?? 0)], ['Qual Div', r.qualifiedDiv ?? 0]], $),
  seniorBonus: (r) => {
    const n = (r.ageA >= 65 ? 1 : 0) + (r.ageB !== undefined && r.ageB >= 65 ? 1 : 0);
    return n > 0 ? `${n} ${n === 1 ? 'person is' : 'people are'} 65 or older.` : 'Nobody is 65 or older yet.';
  },
  taxableIncome: (r, $) => eq('Taxable Inc', colVal('taxableIncome', r), [['Ord Income', r.ordIncome], ['LTCG', r.ltcg], ['Std Deduct', -colVal('stdDeduction', r)],
        ['Senior Bonus', -colVal('seniorBonus', r)], ['Charity ded.', -(r.charityDeduction ?? 0)]], $, 'floor at $0'),
  fedTax: (r, $) => `Taxable ordinary income ${$(Math.max(0, r.ordIncome - r.stdDeduction))} (Ord Income ${$(r.ordIncome)} − Std Deduct − Senior Bonus) through the brackets, plus LTCG ${$(r.ltcg)} at 0/15/20% = ${$(r.fedTax)}`,
  niit: (r, $) => r.niit > 0
    ? `3.8% × the smaller of (LTCG ${$(r.ltcg)} + Ord Div ${$(r.ordinaryDiv ?? 0)}) and (Ord Income + LTCG ${$(r.ordIncome + r.ltcg)} − ${$(r.filingStatus === 'MFJ' ? 250_000 : 200_000)} threshold) = ${$(r.niit)}`
    : 'No NIIT: Ord Income + LTCG is under the $250,000 joint / $200,000 single threshold, or there is no investment income.',
  effRate: (r, $) => `Fed Tax ${$(r.fedTax)} ÷ (Ord Income ${$(r.ordIncome)} + LTCG ${$(r.ltcg)}) = ${(r.effRate * 100).toFixed(1)}%`,
  endTaxable: (r, $) => eq('End Tax', r.endTaxable, [['Beg Tax', r.begTaxable], ['Cash Surplus', r.cashSurplus ?? 0], ['Lump Sum', r.lumpSumInjectTaxable ?? 0], ['WD Taxable', -r.wdTax]], $, 'growth & contributions'),
  endTraditional: (r, $) => eq('End Trd', colVal('endTraditional', r), [['Beg Trd', colVal('begTraditional', r)], ['WD Pre-tax', -colVal('wdTrd', r)], ['RMD', -r.rmd], ['Roth Conv', -r.rothConv]], $, 'growth, contributions & rollovers'),
  endRoth: (r, $) => eq('End Roth', colVal('endRoth', r), [['Beg Roth', colVal('begRoth', r)], ['Roth Conv', r.rothConv], ['WD Roth', -colVal('wdRth', r)]], $, 'growth & contributions'),
  endTotal: (r, $) => eq('End Total', r.endTotal, [['End Tax', r.endTaxable], ['End Trd', colVal('endTraditional', r)], ['End Roth', colVal('endRoth', r)], ['End Inh', r.inheritedBal ?? 0],
        ['HSA Bal.', r.endHSA ?? 0], ['Ladder Bal.', colVal('endTips', r)]], $, 'other'),
  endTaxAdjusted: (r, $) => eq('End Tax-Adj', r.endTaxAdjusted ?? 0, [['End Total', r.endTotal]], $, 'estimated tax on End Trd and unrealized gains'),
};

/**
 * "How it's calculated" text shown under every numeric cell's tooltip (after any live detail the
 * column's own `tooltip` adds). Keyed by column key. A function gets the row so it can show the
 * actual terms. Keep these in step with the engine: projection.ts, tax.ts, aca.ts, irmaa.ts, niit.ts.
 */
const HOW: Record<string, string | ((r: Row, $: Money) => string)> = {
  year: 'Years since the plan started. Year 1 is this calendar year.',
  ageA: 'This calendar year minus the birth year.',
  ageB: 'This calendar year minus the birth year.',
  phase: 'Accum. = neither of you has retired. SemiRetire = one of you has. Retire = both have. Survivor = one of you has died.',

  totalSS: 'Social Security from both of you at your claim ages, raised by inflation each year. After a death the survivor keeps the larger benefit.',
  otherIncome: 'Sum of your income streams other than Social Security that are active this year, each grown by its own growth rate.',
  exemptInterest: 'Beg Tax × Tax-Exempt Yield + any Muni Bond income stream. Not in Ord Income, but counted toward Social Security taxation, ACA MAGI and IRMAA.',
  lumpSumInject: 'Lump-sum events landing this year that go straight into your Taxable, Pre-tax or Roth accounts.',
  lumpSumOrdinaryIncome: 'Lump-sum amounts that must come out as taxable income this year (HSA, inherited IRA), plus any extra your withdrawal strategy takes from them.',
  contribA: 'While A works: annual contribution × growth since plan start. Zero after retiring, except Spousal IRA.',
  contribB: 'While B works: annual contribution × growth since plan start. Zero after retiring, except Spousal IRA.',
  spousalIRA: 'Spousal IRA amount × inflation, capped at the IRA limit. Included in Contrib A / Contrib B.',

  wdTax: 'Share of Total WD taken from the taxable account, per your withdrawal split. Only its gain part (1 − cost basis ÷ balance) is taxed, and lands in LTCG.',
  wdTrd: 'Share of Total WD taken from pre-tax accounts, per your withdrawal split. Counts in Ord Income. Does not include RMD or Roth Conv.',
  wdRth: 'Share of Total WD taken from Roth, per your withdrawal split. Tax-free and adds nothing to ACA MAGI or Ord Income.',
  rmd: 'Beg Trd ÷ the IRS Uniform Lifetime divisor for each person\'s age. Starts at 73 or 75 depending on birth year. Counts in Ord Income.',
  rothConv: 'Moved from End Trd to End Roth. Set by the optimizer (or your manual setting), capped at what is left in Trd after growth and RMD. Counts in Ord Income.',

  netSpend: 'Sum of your expense streams active this year, each grown by its own inflation rate. Includes one-time expenses entered as streams. Taxes are not included.',
  acaPremium: 'Benchmark premium × inflation × people covered, reduced by the subsidy. ACA MAGI = Ord Income + LTCG + Tax-Exempt Int + the non-taxable part of Total SS. Between 133% and 400% of the poverty line you pay about 3%–10% of ACA MAGI. At 400% or more you pay the full premium.',

  stdDeduction: 'Standard deduction for your filing status, plus the extra amount per person 65 or older, scaled by inflation. Senior Bonus and Charity ded. are separate.',
  seniorBonus: '$6,000 per person 65+ (2025–2028 only), reduced by 6 cents for each dollar of Ord Income + LTCG over $150,000 joint ($75,000 single).',
  stateTaxAmt: 'Your state\'s rules applied to this year\'s income: what it taxes of Total SS, WD Pre-tax, RMD and Roth Conv, less its exemptions and deductions.',
  irmaa: 'Medicare surcharge per person aged 65+, from the Ord Income + LTCG + Tax-Exempt Int of two years earlier (this year\'s in the first two years).',

  giving: 'All spending tagged Charitable. Part may come from an IRA as QCD; the rest from your other accounts.',
  qcd: 'Paid from an IRA straight to charity from age 70½. Counts toward RMD first and is left out of Ord Income.',
  charityDeduction: 'Cash gifts to charity when you take the standard deduction (from 2026: up to $1,000, or $2,000 joint). Included in Std Deduct.',

  endHSA: 'Previous HSA Bal. × (1 + HSA return) + HSA Contrib − HSA Paid − HSA Reimb. − HSA Non-qual.',
  hsaContrib: 'HSA contributions this year, up to the annual limit (plus catch-up from 55) while eligible.',
  hsaQualifiedWD: 'Medical bills (and the Medicare surcharge at 65+) paid tax-free from the HSA.',
  hsaReimbursed: 'Earlier medical bills repaid tax-free from the HSA, up to Receipts.',
  hsaNonQualWD: 'HSA money taken for non-medical spending. Counts in Ord Income, plus HSA Penalty before 65.',
  hsaPenalty: '20% × HSA Non-qual before age 65. Zero from 65.',
  hsaReceiptsBal: 'Previous Receipts + medical bills paid from other accounts − HSA Reimb.',

  endTips: 'Value of the bonds held: previous Ladder Bal. + TIPS Accrual − TIPS Maturity.',
  tipsCoupon: 'Real coupon rate × the inflation-adjusted principal of the bonds held.',
  tipsAccrual: 'Principal × this year\'s inflation (CPI) change.',
  tipsMaturity: 'Inflation-adjusted principal of the rungs that mature this year.',
  tipsOrdInc: 'TIPS Coupon + TIPS Accrual on rungs held in taxable accounts. Counts in Ord Income.',
  rmdUnmet: 'Required RMD − RMD: the part that could not be taken because the IRA money is in ladder bonds.',

  begTaxable: 'Previous year\'s End Tax.',
  begTraditional: 'Previous year\'s End Trd.',
  begRoth: 'Previous year\'s End Roth.',
  inheritedBegBal: 'Previous year\'s End Inh.',
  inheritedBal: 'Beg Inh grown at the pre-tax or Roth return, less what was taken out this year.',
  endTaxableBasis: 'Previous End Basis + contributions + reinvested dividends + Cash Surplus − the basis part of WD Taxable.',
};

const GROUP_LABELS: Record<GroupKey, string> = {
  income:      'Income',
  withdrawals: 'Withdrawals',
  spending:    'Spending',
  taxes:       'Taxes',
  qcd:         'Giving',
  hsa:         'HSA',
  tips:        'TIPS',
  balances:    'Balances',
  decisions:   'Decisions',
};

const GROUP_COLORS: Record<GroupKey, { bg: string; text: string }> = {
  income:      { bg: '#b8922a', text: '#fff' },
  withdrawals: { bg: '#2d6a4f', text: '#fff' },
  spending:    { bg: '#6a2d6a', text: '#fff' },
  taxes:       { bg: '#3b5e8a', text: '#fff' },
  qcd:         { bg: '#c9a84c', text: '#0d1b2e' },
  hsa:         { bg: '#1f8f8c', text: '#fff' },
  tips:        { bg: '#6b4f96', text: '#fff' },
  balances:    { bg: '#0d1b2e', text: '#fff' },
  decisions:   { bg: '#2d6a6a', text: '#fff' },
};

function GroupCheckbox({ cols, visibleKeys, onToggle }: {
  cols: Column[]; visibleKeys: Set<string>; onToggle: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const allChecked = cols.every(c => visibleKeys.has(c.key));
  const someChecked = cols.some(c => visibleKeys.has(c.key));
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = someChecked && !allChecked;
  }, [someChecked, allChecked]);
  return (
    <input ref={ref} type="checkbox" checked={allChecked} onChange={onToggle}
      style={{ accentColor: 'var(--navy)', cursor: 'pointer' }} />
  );
}

const STORAGE_KEY = 'fireopt-projections-cols-v5';
// Set once the user changes the column choice while the QCD columns were auto-shown, so their choice sticks.
const QCD_TOUCHED_KEY = 'fireopt-projections-qcd-touched';
const QCD_KEYS = COLUMNS.filter((c) => c.group === 'qcd').map((c) => c.key);

const DEFAULT_VISIBLE = new Set([
  ...COLUMNS.filter(c => c.essential || c.group === 'identity').map(c => c.key),
  'why',
]);

const loadVisibleKeys = (): Set<string> => {
  if (typeof window === 'undefined') return DEFAULT_VISIBLE;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch { /* fall through */ }
  return DEFAULT_VISIBLE;
};

export default function Projections() {
  const mode = usePlanStore((s) => s.displayMode);
  const proj = useProjection();
  const [visibleKeys, setVisibleKeysState] = useState<Set<string>>(loadVisibleKeys);
  const [qcdTouched, setQcdTouched] = useState<boolean>(() => {
    try { return typeof window !== 'undefined' && localStorage.getItem(QCD_TOUCHED_KEY) === '1'; } catch { return false; }
  });
  // Giving columns are on by default only when this plan has charitable giving, until the user chooses otherwise.
  const lifetimeGiving = proj.rows.reduce((s, r) => s + r.charitableSpend, 0);
  const qcdAuto = lifetimeGiving > 0 && !qcdTouched;
  const effectiveVisible = useMemo(
    () => (qcdAuto ? new Set([...visibleKeys, ...QCD_KEYS]) : visibleKeys),
    [qcdAuto, visibleKeys],
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPos, setPickerPos] = useState<{ top: number; right: number; maxHeight: number }>({ top: 0, right: 0, maxHeight: 400 });
  const [cellTip, setCellTip] = useState<{ x: number; y: number; text: string; wide?: boolean } | null>(null);
  const [expandedYear, setExpandedYear] = useState<number | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const notesMap = useMemo(() => {
    const m = new Map<number, YearDecision[]>();
    for (const n of proj.decisionNotes) {
      const arr = m.get(n.year) ?? [];
      arr.push(n);
      m.set(n.year, arr);
    }
    return m;
  }, [proj.decisionNotes]);

  const whyColumn = useMemo<Column>(() => ({
    key: 'why',
    label: 'Why',
    group: 'decisions',
    essential: true,
    fmt: 'raw',
    get: (r: Row) => {
      const notes = notesMap.get(r.year) ?? [];
      if (!notes.length) return '';
      // Strip newlines: CSV uses join('\n') so embedded newlines break naive consumers.
      return notes.map(n => decisionText(n, mode === 'real').replace(/\n/g, ' ')).join(' | ');
    },
    tooltip: (r: Row) => {
      const notes = notesMap.get(r.year) ?? [];
      if (!notes.length) return '';
      return notes.map(n => decisionText(n, mode === 'real').replace(/\n/g, ' ')).join('\n\n');
    },
    bg: BG.decisions,
  }), [notesMap, mode]);

  const allColumns = useMemo<Column[]>(() => [...COLUMNS, whyColumn], [whyColumn]);

  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node) &&
          buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [pickerOpen]);

  const openPicker = () => {
    if (buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect();
      setPickerPos({
        top: r.bottom + 4,
        right: window.innerWidth - r.right,
        maxHeight: window.innerHeight - r.bottom - 12,
      });
    }
    setPickerOpen(o => !o);
  };

  const save = (next: Set<string>, resetQcd = false) => {
    setVisibleKeysState(next);
    const touched = resetQcd ? false : qcdTouched || qcdAuto;
    setQcdTouched(touched);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      if (touched) localStorage.setItem(QCD_TOUCHED_KEY, '1'); else localStorage.removeItem(QCD_TOUCHED_KEY);
    } catch { /* ignore */ }
  };

  const toggleColumn = (key: string) => {
    const next = new Set(effectiveVisible);
    if (next.has(key)) next.delete(key); else next.add(key);
    save(next);
  };

  const toggleGroup = (g: GroupKey) => {
    const cols = allColumns.filter(c => c.group === g);
    const allOn = cols.every(c => effectiveVisible.has(c.key));
    const next = new Set(effectiveVisible);
    cols.forEach(c => allOn ? next.delete(c.key) : next.add(c.key));
    save(next);
  };

  const visibleColumns = allColumns.filter(c => c.group === 'identity' || effectiveVisible.has(c.key));

  const downloadCSV = () => {
    // CSV always includes every column regardless of UI expansion.
    const header = allColumns.map((c) => c.label).join(',');
    const rows = proj.rows.map((r, i) =>
      allColumns.map((c) => {
        const v = c.get(r);
        if (typeof v === 'number') {
          const isMoney = c.fmt === 'money';
          const scaled = isMoney && mode === 'real' ? v / deflatorFor(c.key, proj.rows, i) : v;
          return Math.round(scaled);
        }
        return `"${String(v).replace(/"/g, '""')}"`;
      }).join(','),
    );
    const csv = [header, ...rows].join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = `retirement-optimizer-projection-${mode === 'real' ? 'realdollars' : 'nominal'}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="page">
      <StalePlanBanner />
      <div className="page-body">
        <WhatIfBar />

        {proj.overrideEvents.length > 0 && (() => {
          const first = proj.overrideEvents[0];
          const last = proj.overrideEvents[proj.overrideEvents.length - 1];
          const ageRange = first.age === last.age ? `age ${first.age}` : `ages ${first.age}–${last.age}`;
          return (
            <div style={{
              background: '#fff8e1', border: '1px solid #f59e0b', borderRadius: 6,
              padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#78350f',
              display: 'flex', gap: 10, alignItems: 'flex-start',
            }}>
              <span style={{ fontSize: 16, lineHeight: '18px' }}>⚠</span>
              <div>
                <strong>Bracket-fill ceiling overridden at {ageRange}</strong> — taxable and Roth accounts were depleted and spending could not be covered within the bracket-fill ceiling. Traditional draws exceeded the ceiling to prevent unfunded expenses. Without this override, the plan would stop funding retirement at age {first.age}.
              </div>
            </div>
          );
        })()}

        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header">
            <div className="panel-title"><div className="panel-title-dot"></div>Annual Cash Flows ({mode === 'real' ? "Today's $" : 'Nominal $'})</div>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Income above zero · Spending &amp; tax below zero · Portfolio total line on right axis</span>
          </div>
          <div className="panel-body">
            <ChartFrame caption="Use this to see the net cash flow each year and how taxes eat into income.">
              <CashFlowsBalanced proj={proj} real={mode === 'real'} height={320} />
            </ChartFrame>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title"><div className="panel-title-dot"></div>Year-by-Year Detail</div>
            <div className="projections-toolbar" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
              <div style={{ position: 'relative' }}>
                <button
                  ref={buttonRef}
                  onClick={openPicker}
                  style={{
                    border: '1px solid var(--border-light)',
                    background: pickerOpen ? 'var(--navy)' : 'rgba(13,27,46,0.04)',
                    color: pickerOpen ? '#fff' : 'var(--text-secondary)',
                    fontSize: 11, padding: '4px 10px', borderRadius: 6,
                    cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4,
                  }}
                >
                  <strong>Show / Hide Columns</strong>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor">
                    <path d="M2 3.5l3 3 3-3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                {pickerOpen && (
                  <div ref={pickerRef} style={{
                    position: 'fixed', top: pickerPos.top, right: pickerPos.right, zIndex: 1000,
                    background: '#fff', border: '1px solid var(--border-light)',
                    borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                    padding: '10px 0', minWidth: 220,
                    maxHeight: pickerPos.maxHeight, overflowY: 'auto',
                  }}>
                    {(Object.keys(GROUP_LABELS) as GroupKey[]).map(g => {
                      const cols = allColumns.filter(c => c.group === g);
                      const { bg, text } = GROUP_COLORS[g];
                      return (
                        <div key={g}>
                          <label style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '5px 14px', cursor: 'pointer', userSelect: 'none',
                            background: bg,
                          }}>
                            <GroupCheckbox cols={cols} visibleKeys={effectiveVisible} onToggle={() => toggleGroup(g)} />
                            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: text, textTransform: 'uppercase' }}>
                              {GROUP_LABELS[g]}
                            </span>
                          </label>
                          {cols.map(c => (
                            <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 14px 3px 32px', cursor: 'pointer', userSelect: 'none' }}>
                              <input
                                type="checkbox"
                                checked={effectiveVisible.has(c.key)}
                                onChange={() => toggleColumn(c.key)}
                                style={{ accentColor: 'var(--navy)', cursor: 'pointer' }}
                              />
                              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{c.label}</span>
                            </label>
                          ))}
                        </div>
                      );
                    })}
                    <div style={{ borderTop: '1px solid var(--border-light)', margin: '8px 0 4px' }} />
                    <button
                      onClick={() => save(DEFAULT_VISIBLE, true)}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '3px 14px', fontSize: 11, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                      Reset to defaults
                    </button>
                  </div>
                )}
              </div>
              <span style={{ width: 1, height: 18, background: 'var(--border-light)', margin: '0 2px' }} />
              <button
                onClick={downloadCSV}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  border: '1px solid var(--border-light)',
                  background: 'rgba(201,168,76,0.12)',
                  color: 'var(--navy)',
                  fontSize: 11, fontWeight: 600,
                  padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                }}
                title="Download all columns as CSV (respects Today's $ / Nominal $ toggle)"
              >
                <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Download CSV
              </button>
            </div>
          </div>
          <div className="panel-body" style={{ padding: 0, overflow: 'auto', maxHeight: 'calc(100vh - 380px)', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
            <table className="data-table" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  {visibleColumns.map((c, i) => {
                    const sticky = c.group === 'identity';
                    const leftOffsets = [0, 60, 120, 180];
                    return (
                      <th
                        key={c.key}
                        style={sticky
                          ? stickyTh(leftOffsets[i] ?? 0, c.bg, c.key === 'phase' ? 90 : 60)
                          : { position: 'sticky', top: 0, background: c.bg, fontWeight: c.key === 'endTotal' ? 700 : 600, zIndex: 3 }}
                      >
                        {c.label}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {proj.rows.map((r, rowIdx) => {
                  const rowNotes = notesMap.get(r.year) ?? [];
                  const isExpanded = expandedYear === r.year;
                  const leftOffsets = [0, 60, 120, 180];
                  return (
                    <Fragment key={r.year}>
                      <tr>
                        {visibleColumns.map((c, i) => {
                          const sticky = c.group === 'identity';
                          const v = c.get(r);
                          let display: string | number;
                          if (typeof v === 'string') display = v;
                          else if (c.fmt === 'money') display = fmt(v, mode, deflatorFor(c.key, proj.rows, rowIdx));
                          else if (c.fmt === 'pct') display = `${v.toFixed(1)}%`;
                          else display = v;
                          const money = (n: number) => fmtFull(mode === 'real' ? n / r.inflationFactor : n);
                          const detail = c.tooltip?.(r, money);
                          const how = HOW[c.key];
                          const rules = typeof how === 'function' ? how(r, money) : how;
                          const howText = [CALC[c.key]?.(r, money), rules].filter(Boolean).join('\n');
                          const tipText = [detail, howText && `How it's calculated: ${howText}`].filter(Boolean).join('\n\n');
                          const isWhy = c.key === 'why';
                          const hasNotes = isWhy && rowNotes.length > 0;
                          const style: React.CSSProperties = sticky
                            ? { ...stickyTd(leftOffsets[i] ?? 0), textAlign: 'center' }
                            : isWhy
                              ? {
                                  textAlign: 'left',
                                  maxWidth: 220,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  cursor: hasNotes ? 'pointer' : undefined,
                                  background: isExpanded && hasNotes ? '#c8dede' : undefined,
                                }
                              : { textAlign: 'right', fontWeight: c.key === 'endTotal' ? 700 : undefined, cursor: tipText ? 'help' : undefined };
                          return (
                            <td
                              key={c.key}
                              style={style}
                              onMouseEnter={tipText ? (e) => setCellTip({ x: e.clientX, y: e.clientY, text: tipText, wide: isWhy || tipText.includes('\n') }) : undefined}
                              onMouseLeave={tipText ? () => setCellTip(null) : undefined}
                              onClick={hasNotes ? () => setExpandedYear(y => y === r.year ? null : r.year) : undefined}
                            >
                              {display}
                            </td>
                          );
                        })}
                      </tr>
                      {isExpanded && rowNotes.length > 0 && (
                        <tr key={`why-${r.year}`} style={{ background: '#edf4f4' }}>
                          <td
                            colSpan={visibleColumns.length}
                            style={{ padding: '8px 18px 10px', fontSize: 11, lineHeight: 1.6, borderBottom: '1px solid #c8dede' }}
                          >
                            {rowNotes.map((n, idx) => (
                              <div key={idx} style={{ marginBottom: idx < rowNotes.length - 1 ? 8 : 0 }}>
                                <span style={{ fontWeight: n.binding ? 700 : 400 }}>{decisionText(n, mode === 'real')}</span>
                              </div>
                            ))}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '10px 18px', fontSize: 11, color: 'var(--text-muted)', borderTop: '1px solid var(--border-light)' }}>
            Showing {visibleColumns.length} of {allColumns.length} columns · CSV export always includes all columns · Click a Why cell to expand
          </div>
        </div>
      </div>
      {cellTip && (
        <div style={{
          position: 'fixed', left: cellTip.x + 12, top: cellTip.y - 8,
          background: '#1a2535', color: '#e8edf3', fontSize: 11,
          padding: '5px 9px', borderRadius: 5, pointerEvents: 'none',
          // Short tips stay on one line; long ones wrap instead of running off the screen.
          whiteSpace: cellTip.wide ? 'pre-wrap' : 'normal',
          width: 'max-content',
          maxWidth: cellTip.wide ? 420 : 360,
          zIndex: 9999, boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
        }}>
          {cellTip.text}
        </div>
      )}
    </div>
  );
}
