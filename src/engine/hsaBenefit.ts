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
    /** How much the contribution lowers ACA income per year (0 when ACA isn't modeled). */
    acaMagiLowered: number;
    /** How much it lowers the net ACA premium per year. */
    subsidyRaised: number;
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
    let magi = 0, premium = 0;
    for (const r of contributing) {
      const b = off[r.year - 1];
      if (!b) continue;
      magi += real(b.acaMagi - r.acaMagi, r);
      premium += real(b.acaPremium - r.acaPremium, r);
    }
    out.contribution = {
      years,
      perYear: sum(contributing, (r) => r.hsaContribRet) / years,
      acaMagiLowered: plan.assumptions.modelACA ? Math.max(0, magi / years) : 0,
      subsidyRaised: plan.assumptions.modelACA ? Math.max(0, premium / years) : 0,
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
    if (c.acaMagiLowered >= 1 && c.subsidyRaised >= 50) {
      parts.push(`${gives} lowers your ACA income by about ${fmtFull(round100(c.acaMagiLowered))} and raises your subsidy by about ${fmtFull(round100(c.subsidyRaised))} a year.`);
    } else if (c.acaMagiLowered >= 1) {
      parts.push(`${gives} lowers your ACA income by about ${fmtFull(round100(c.acaMagiLowered))} a year.`);
    } else {
      parts.push(`${gives} is deducted from your taxable income.`);
    }
  }
  return { title, body: parts.join(' ') };
}
