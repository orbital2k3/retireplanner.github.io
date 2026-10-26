import { fmtUSD } from '../../lib/format';
import type { SpillKind } from '../withdrawal';

export type DecisionCode =
  | 'conv-bracket-headroom'
  | 'conv-trad-cap'
  | 'conv-optimizer-policy'
  | 'conv-policy-zero'
  | 'conv-with-trad-wd'
  | 'conv-during-rmd'
  | 'qcd-rmd'
  | 'wd-policy-spill'
  | 'wd-bracket-override'
  | 'wd-bracketfill-room'
  | 'irmaa-tier'
  | 'aca-cliff';

export interface YearDecision {
  year: number;
  ageA: number;
  code: DecisionCode;
  severity: 'info' | 'caution' | 'warning';
  /** True when this constraint is what set the actual number, not just contextual commentary. */
  binding: boolean;
  text: string;
  /** Same sentence with every dollar amount in today's dollars (nominal ÷ the year's inflation factor). */
  textReal?: string;
  amounts?: Record<string, number>;
}

/** The note's sentence in the dollars the user is viewing (today's when `real`, else nominal). */
export const decisionText = (n: YearDecision, real: boolean): string => (real && n.textReal) || n.text;

export interface YearDecisionContext {
  year: number;
  /** Cumulative inflation for this year. When set, each note also gets `textReal`. */
  inflationFactor?: number;
  /** Money formatter used inside note text. Internal: the builder sets it for the today's-dollars pass. */
  fmt?: (n: number) => string;
  ageA: number;
  // Conversion
  conv: number;
  /** convAmt was explicitly pinned to 0 (not undefined — undefined releases the path). */
  convPolicyZero: boolean;
  /** True when a policy window set convAmt explicitly (optimizer or manual schedule), not bracket-fill formula. */
  convOptimizerSet: boolean;
  headroomNominal: number;
  maxConv: number;
  ceilForConv: number;
  baseOrdIncome: number;
  tradBalance: number;
  // Withdrawal
  wdTax: number;
  wdTrd: number;
  wdRth: number;
  gap: number;
  /** RMD that reached the household as taxable income (the gross RMD less any QCD that satisfied it). */
  rmdTaxable: number;
  /** Gross RMD, QCD paid to charity this year, and the part of that QCD beyond the RMD. Optional: absent = no QCD. */
  rmdGross?: number;
  qcd?: number;
  qcdBeyondRmd?: number;
  /** Part of the QCD taxed under the §408(d)(8)(A) anti-abuse rule. */
  qcdTaxable?: number;
  bracketOverridden: boolean;
  spill?: { kind: SpillKind; amount: number; tradCap?: number };
  /** Active window percentages, present when a blend-policy window covers this age. */
  spillWindow?: { pctTaxable: number; pctTraditional: number; pctRoth: number };
  // Bracketfill withdrawal preset
  isActiveBracketfill: boolean;
  bracketfillRoom: number;
}

// ---------------------------------------------------------------------------
// Conversion notes
// ---------------------------------------------------------------------------

function convBracketHeadroom(ctx: YearDecisionContext): YearDecision {
  const $ = ctx.fmt ?? fmtUSD;
  const { ageA, year, headroomNominal, ceilForConv, baseOrdIncome, conv } = ctx;
  return {
    year, ageA,
    code: 'conv-bracket-headroom',
    severity: 'info',
    binding: true,
    text: `Age ${ageA} — the bracket ceiling was the binding limit on this conversion. ` +
      `${$(headroomNominal)} of room remained below the ${$(ceilForConv)} ceiling ` +
      `after ${$(baseOrdIncome)} of other ordinary income, ` +
      `and ${$(conv)} was converted — the full available headroom.`,
    amounts: { headroomNominal, ceilForConv, baseOrdIncome, conv },
  };
}

function convTradCap(ctx: YearDecisionContext): YearDecision {
  const $ = ctx.fmt ?? fmtUSD;
  const { ageA, year, headroomNominal, maxConv, conv } = ctx;
  return {
    year, ageA,
    code: 'conv-trad-cap',
    severity: 'info',
    binding: true,
    text: `Age ${ageA} — the pre-tax balance was the binding limit on this conversion. ` +
      `${$(headroomNominal)} of bracket room was available, ` +
      `but only ${$(maxConv)} remained in the pre-tax account, ` +
      `so ${$(conv)} was converted.`,
    amounts: { headroomNominal, maxConv, conv },
  };
}

function convOptimizerPolicy(ctx: YearDecisionContext): YearDecision {
  const $ = ctx.fmt ?? fmtUSD;
  const { ageA, year, conv, headroomNominal } = ctx;
  const unused = Math.max(0, headroomNominal - conv);
  return {
    year, ageA,
    code: 'conv-optimizer-policy',
    severity: 'info',
    binding: true,
    text: `Age ${ageA} — the optimizer set this year's conversion to ${$(conv)}, ` +
      `leaving ${$(unused)} of the ${$(headroomNominal)} available below the next bracket ceiling unused. ` +
      `The multi-year model determined that converting more here would reduce projected after-tax wealth. ` +
      `The optimizer evaluates all years simultaneously — the trade-off is driven by future-year tax ` +
      `interactions (RMD pressure, IRMAA tiers, bracket shifts after one spouse passes) ` +
      `that are not visible in this row alone.`,
    amounts: { conv, headroomNominal, unused },
  };
}

function convPolicyZero(ctx: YearDecisionContext): YearDecision {
  const { ageA, year } = ctx;
  return {
    year, ageA,
    code: 'conv-policy-zero',
    severity: 'info',
    binding: true,
    text: `Age ${ageA} — no Roth conversion was made. ` +
      `The manual schedule sets the conversion amount to zero for this year.`,
    amounts: {},
  };
}

function convWithTradWd(ctx: YearDecisionContext): YearDecision {
  const $ = ctx.fmt ?? fmtUSD;
  const { ageA, year, conv, headroomNominal, ceilForConv, baseOrdIncome, gap, wdTax, wdRth, wdTrd } = ctx;
  return {
    year, ageA,
    code: 'conv-with-trad-wd',
    severity: 'info',
    binding: false,
    text: `Age ${ageA} — a Roth conversion and a pre-tax withdrawal are not in conflict. ` +
      `The conversion is sized first: ${$(headroomNominal)} of bracket room remained ` +
      `below the ${$(ceilForConv)} ceiling after ${$(baseOrdIncome)} of other ordinary income, ` +
      `and ${$(conv)} was converted. ` +
      `The withdrawal happens after, and funds a different need: of the ${$(gap)} spending gap, ` +
      `${$(wdTax)} came from taxable and ${$(wdRth)} from Roth, ` +
      `leaving ${$(wdTrd)} to draw from pre-tax. ` +
      `Converting more would not have reduced the withdrawal — it would have added to it, ` +
      `because conversion tax is part of the same gap.`,
    amounts: { conv, headroomNominal, ceilForConv, baseOrdIncome, gap, wdTax, wdRth, wdTrd },
  };
}

function convDuringRmd(ctx: YearDecisionContext): YearDecision {
  const $ = ctx.fmt ?? fmtUSD;
  const { ageA, year, rmdTaxable, tradBalance, ceilForConv, headroomNominal, conv, gap } = ctx;
  return {
    year, ageA,
    code: 'conv-during-rmd',
    severity: 'info',
    binding: false,
    text: `Age ${ageA} — the RMD came first and shrank the conversion. ` +
      `Your ${$(rmdTaxable)} RMD is mandatory ordinary income and consumed that much bracket space ` +
      `before any conversion was considered; it also reduced the convertible pre-tax balance to ${$(tradBalance)}. ` +
      `What remained below the ${$(ceilForConv)} ceiling was ${$(headroomNominal)}, ` +
      `and ${$(conv)} was converted. ` +
      `The RMD is spending money, not a withdrawal, so it offsets your ${$(gap)} of spending ` +
      `rather than appearing in the withdrawal columns.`,
    amounts: { rmdTaxable, tradBalance, ceilForConv, headroomNominal, conv, gap },
  };
}

function qcdRmd(ctx: YearDecisionContext): YearDecision {
  const $ = ctx.fmt ?? fmtUSD;
  const { ageA, year, rmdTaxable } = ctx;
  const qcd = ctx.qcd ?? 0;
  const beyond = ctx.qcdBeyondRmd ?? 0;
  const gross = ctx.rmdGross ?? 0;
  const covered = qcd - beyond;
  const taxed = ctx.qcdTaxable ?? 0;
  const rmdPart = gross > 1
    ? `It covered ${$(covered)} of your ${$(gross)} required withdrawal, so only ${$(rmdTaxable)} of it counted as income` +
      (beyond > 1 ? `, and a further ${$(beyond)} went to charity beyond the requirement.` : '.')
    : 'No withdrawal was required yet, so none of it counted toward an RMD.';
  return {
    year, ageA,
    code: 'qcd-rmd',
    severity: 'info',
    binding: false,
    text: taxed > 1
      ? `Age ${ageA} — ${$(qcd)} went straight from your IRA to charity as a QCD. ${$(taxed)} of it was taxed anyway: ` +
        `deductible IRA contributions made from age 70½ reduce the tax-free amount (IRC §408(d)(8)). ${rmdPart}`
      : `Age ${ageA} — ${$(qcd)} went straight from your IRA to charity as a QCD, so it was not taxed. ${rmdPart}`,
    amounts: { qcd, qcdBeyondRmd: beyond, rmdGross: gross, rmdTaxable, ...(taxed > 0 ? { qcdTaxable: taxed } : {}) },
  };
}

// ---------------------------------------------------------------------------
// Withdrawal notes
// ---------------------------------------------------------------------------

function spillReasonText(kind: SpillKind, ageA: number, spill: YearDecisionContext['spill'], $: (n: number) => string): string {
  switch (kind) {
    case 'no-window':
      return `age ${ageA} is not covered by any window in your policy`;
    case 'trad-cap':
      return `the window's traditional cap (${$(spill?.tradCap ?? 0)}) limits this account`;
    case 'pct-unhonorable':
      return `account balances are too small to fill the requested percentages`;
    case 'balance-exhausted':
      return `all eligible accounts were exhausted`;
  }
}

function wdPolicySpill(ctx: YearDecisionContext): YearDecision {
  const $ = ctx.fmt ?? fmtUSD;
  const { ageA, year, spill, spillWindow, gap, wdTax, wdTrd, wdRth } = ctx;
  if (!spill) throw new Error('wdPolicySpill called without spill');
  const totalWd = wdTax + wdTrd + wdRth;
  const pctTax = totalWd > 0 ? Math.round((wdTax / totalWd) * 100) : 0;
  const pctTrd = totalWd > 0 ? Math.round((wdTrd / totalWd) * 100) : 0;
  const pctRth = totalWd > 0 ? Math.round((wdRth / totalWd) * 100) : 0;
  const windowDesc = spillWindow
    ? `The window asks for ${Math.round(spillWindow.pctTaxable * 100)}% taxable / ` +
      `${Math.round(spillWindow.pctTraditional * 100)}% pre-tax / ` +
      `${Math.round(spillWindow.pctRoth * 100)}% Roth, but `
    : 'Your policy could not be honored: ';
  const reason = spillReasonText(spill.kind, ageA, spill, $);
  return {
    year, ageA,
    code: 'wd-policy-spill',
    severity: 'caution',
    binding: true,
    text: `Age ${ageA} — your withdrawal split could not be honored. ` +
      windowDesc +
      `${$(spill.amount)} of the ${$(gap)} needed could not be drawn that way — ` +
      `${reason}. ` +
      `The shortfall was refilled taxable → pre-tax → Roth, ` +
      `which is why the actual split is ${pctTax}/${pctTrd}/${pctRth}.`,
    amounts: { spillAmount: spill.amount, gap, wdTax, wdTrd, wdRth },
  };
}

function wdBracketOverride(ctx: YearDecisionContext): YearDecision {
  const $ = ctx.fmt ?? fmtUSD;
  const { ageA, year, wdTrd, gap, wdTax, wdRth } = ctx;
  return {
    year, ageA,
    code: 'wd-bracket-override',
    severity: 'caution',
    binding: true,
    text: `Age ${ageA} — the bracket-fill ceiling was overridden. ` +
      `Taxable and Roth accounts could not cover the ${$(gap)} spending need on their own, ` +
      `so ${$(wdTrd)} was drawn from the pre-tax account past the bracket ceiling. ` +
      `Taxable covered ${$(wdTax)} and Roth ${$(wdRth)}.`,
    amounts: { gap, wdTrd, wdTax, wdRth },
  };
}

function wdBracketfillRoom(ctx: YearDecisionContext): YearDecision {
  const $ = ctx.fmt ?? fmtUSD;
  const { ageA, year, bracketfillRoom, ceilForConv } = ctx;
  return {
    year, ageA,
    code: 'wd-bracketfill-room',
    severity: 'info',
    binding: false,
    text: `Age ${ageA} — the withdrawal preset filled the bracket up to ${$(ceilForConv)}. ` +
      `${$(bracketfillRoom)} of room remained after the pre-tax draw; ` +
      `remaining spending came from Roth and taxable.`,
    amounts: { bracketfillRoom, ceilForConv },
  };
}

// ---------------------------------------------------------------------------
// Public builder
// ---------------------------------------------------------------------------

/** Notes in nominal dollars; with `ctx.inflationFactor`, each also carries `textReal` in today's dollars. */
export function buildYearDecisions(ctx: YearDecisionContext): YearDecision[] {
  const notes = buildNotes(ctx);
  const f = ctx.inflationFactor;
  if (!f || f <= 0) return notes;
  const real = buildNotes({ ...ctx, fmt: (n) => fmtUSD(n / f) });
  return notes.map((n, i) => ({ ...n, textReal: real[i].text }));
}

function buildNotes(ctx: YearDecisionContext): YearDecision[] {
  const notes: YearDecision[] = [];

  if (ctx.conv > 1) {
    // Exactly one binding conversion-sizing note per year.
    // Use a $1 epsilon: convBracketHeadroom fires only when conv actually reached the bracket ceiling;
    // convTradCap only when conv hit the trad balance; otherwise the optimizer chose an intermediate amount.
    const EPS = 1;
    const hitHeadroom = ctx.conv >= ctx.headroomNominal - EPS;
    const hitTradCap  = !hitHeadroom && ctx.conv >= ctx.maxConv - EPS;
    const bindingConv = hitHeadroom
      ? convBracketHeadroom(ctx)
      : hitTradCap || !ctx.convOptimizerSet
        ? convTradCap(ctx)
        : convOptimizerPolicy(ctx);
    notes.push(bindingConv);

    // Non-binding pattern callouts (can coexist).
    if (ctx.wdTrd > 1) notes.push(convWithTradWd(ctx));
    if (ctx.rmdTaxable > 1) notes.push(convDuringRmd(ctx));
  } else if (ctx.convPolicyZero) {
    notes.push(convPolicyZero(ctx));
  }

  if ((ctx.qcd ?? 0) > 1) notes.push(qcdRmd(ctx));

  // At most one binding withdrawal-sizing note per year.
  if (ctx.spill && ctx.spill.amount > 0.01) {
    notes.push(wdPolicySpill(ctx));
  } else if (ctx.bracketOverridden) {
    notes.push(wdBracketOverride(ctx));
  }

  // Non-binding bracketfill informational note.
  if (ctx.isActiveBracketfill && ctx.bracketfillRoom > 1) {
    notes.push(wdBracketfillRoom(ctx));
  }

  return notes;
}
