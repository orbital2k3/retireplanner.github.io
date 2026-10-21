import type { Plan } from '../schemas/plan';
import { runProjection, type ProjectionRow } from './projection';
import { resolveStrategy } from './strategy/resultSettings';
import { fmtFull } from '../lib/format';

/** What the HSA does for the plan, in today's dollars: the medical costs it pays tax-free, and (for a retiree who
 *  keeps contributing) what that contribution does to ACA income and the subsidy. The contribution effect is a
 *  counterfactual: the same plan projected again with the retirement-contribution election switched off. */
export interface HsaBenefit {
  /** Lifetime qualified payments (medical bills and Medicare surcharges), today's $. */
  qualifiedTotal: number;
  /** Part of that which paid IRMAA surcharges rather than medical-tagged bills. */
  irmaaPaid: number;
  firstPayAge?: number;
  /** Set when a retiree contributes. Averages over the contributing years. */
  contribution?: {
    years: number;
    perYear: number;
    /** Whether the plan models ACA premiums (the ACA figures below mean nothing otherwise). */
    acaModeled: boolean;
    /** Contributing years in which ACA income is actually lower than without the contribution. The extra
     *  income from the withdrawals that fund it can cancel the deduction (pre-tax money cancels it
     *  entirely), and spending taxable money sooner can raise income in a later year. */
    yearsLowered: number;
    /** Average amount ACA income is lowered by, over the `yearsLowered` years. */
    acaMagiLowered: number;
    /** Average net ACA premium saved, over the `yearsLowered` years. */
    subsidyRaised: number;
    /** Net ACA premium saved over all the contributing years (negative = the contribution costs subsidy). */
    premiumNet: number;
  };
}

const real = (n: number, r: ProjectionRow) => n / r.inflationFactor;
const sum = (rows: ProjectionRow[], f: (r: ProjectionRow) => number) => rows.reduce((s, r) => s + real(f(r), r), 0);

/** Returns null when the HSA does neither (no qualified payment and no retiree contribution). */
export function computeHsaBenefit(livePlan: Plan): HsaBenefit | null {
  const plan = resolveStrategy(livePlan);
  const pf = plan.portfolio;
  // No HSA at all: skip the projection (this runs on every Taxes-page render of a changed plan).
  if (!((pf.personA.hsa ?? 0) > 0 || (pf.personA.hsaContribution ?? 0) > 0 || (pf.personB?.hsa ?? 0) > 0 || (pf.personB?.hsaContribution ?? 0) > 0)) return null;
  const on = runProjection(plan);
  const paying = on.rows.filter((r) => r.hsaQualifiedWD > 0);
  const contributing = on.rows.filter((r) => r.hsaContribRet > 0);
  if (paying.length === 0 && contributing.length === 0) return null;

  const out: HsaBenefit = {
    qualifiedTotal: sum(on.rows, (r) => r.hsaQualifiedWD),
    irmaaPaid: sum(on.rows, (r) => Math.max(0, r.hsaQualifiedWD - r.medicalSpend)),
    firstPayAge: paying[0]?.ageA,
  };

  if (contributing.length > 0) {
    const without: Plan = {
      ...plan,
      portfolio: {
        ...plan.portfolio,
        personA: { ...plan.portfolio.personA, hsaContribInRetirement: undefined },
        personB: plan.portfolio.personB ? { ...plan.portfolio.personB, hsaContribInRetirement: undefined } : undefined,
      },
    };
    const off = runProjection(without).rows;
    const years = contributing.length;
    let yearsLowered = 0, magi = 0, premium = 0, premiumNet = 0;
    for (const r of contributing) {
      const b = off[r.year - 1];
      if (!b) continue;
      const dPremium = real(b.acaPremium - r.acaPremium, r);
      premiumNet += dPremium;
      const dMagi = real(b.acaMagi - r.acaMagi, r);
      if (dMagi >= 1) { yearsLowered++; magi += dMagi; premium += dPremium; }
    }
    const aca = plan.assumptions.modelACA;
    out.contribution = {
      years,
      perYear: sum(contributing, (r) => r.hsaContribRet) / years,
      acaModeled: aca,
      yearsLowered: aca ? yearsLowered : 0,
      acaMagiLowered: aca && yearsLowered > 0 ? magi / yearsLowered : 0,
      subsidyRaised: aca && yearsLowered > 0 ? Math.max(0, premium / yearsLowered) : 0,
      premiumNet: aca ? premiumNet : 0,
    };
  }
  return out;
}

const round100 = (n: number) => Math.round(n / 100) * 100;

/** Title and body for the Taxes-page card. */
export function hsaBenefitCopy(b: HsaBenefit): { title: string; body: string } {
  const c = b.contribution;
  const pays = b.qualifiedTotal >= 1 && b.firstPayAge !== undefined;
  const title = pays
    ? `Your HSA covers ${b.irmaaPaid >= 1 ? 'Medicare surcharges and ' : ''}medical bills from ${b.firstPayAge}`
    : 'Contributing to your HSA in retirement lowers your ACA income';
  const parts: string[] = [];
  if (pays) {
    parts.push(`${fmtFull(round100(b.qualifiedTotal))} of medical costs paid tax-free over the plan (today's $).`);
  }
  if (c) {
    const gives = `Contributing ${fmtFull(round100(c.perYear))} a year on an HSA-eligible plan before 65`;
    if (c.yearsLowered > 0 && c.yearsLowered < c.years) {
      // Mixed: lower in some years, higher in others (e.g. taxable money runs out sooner).
      parts.push(`${gives} lowers your ACA income by about ${fmtFull(round100(c.acaMagiLowered))} a year in ${c.yearsLowered} of those ${c.years} years.`);
      if (c.premiumNet <= -50) {
        parts.push(`In the other years the withdrawals that replace that money raise it, and over all ${c.years} years your ACA premiums come to about ${fmtFull(round100(-c.premiumNet))} more than without contributing.`);
      } else if (c.premiumNet >= 50) {
        parts.push(`Over all ${c.years} years it saves about ${fmtFull(round100(c.premiumNet))} in ACA premiums.`);
      }
    } else if (c.yearsLowered > 0 && c.subsidyRaised >= 50) {
      parts.push(`${gives} lowers your ACA income by about ${fmtFull(round100(c.acaMagiLowered))} and raises your subsidy by about ${fmtFull(round100(c.subsidyRaised))} a year.`);
    } else if (c.yearsLowered > 0) {
      parts.push(`${gives} lowers your ACA income by about ${fmtFull(round100(c.acaMagiLowered))} a year.`);
    } else if (c.acaModeled) {
      // The deduction is real, but the withdrawals that pay for it count as income too (pre-tax money
      // cancels it exactly; brokerage gains cancel part). Say so rather than promise a subsidy.
      parts.push(`${gives} doesn't lower your ACA income in this plan, because the money comes from withdrawals that count as income. Paying it from Roth money would.`);
    } else {
      parts.push(`${gives} is deducted from your taxable income.`);
    }
  }
  return { title, body: parts.join(' ') };
}
