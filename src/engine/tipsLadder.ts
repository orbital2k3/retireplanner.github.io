import type { Portfolio, TipsRung } from '../schemas/plan';
import { ladderInBalances } from './tipsValidation';

/** TIPS ladder mechanics (pure). The projection calls `resolveTipsLadder` once and `tipsLadderYear`
 *  once per year, only when the plan has a ladder, so a plan without one pays nothing.
 *
 *  Conventions (hold-to-maturity accounting):
 *  - Index ratio: `idxS` / `idxE` are the cumulative CPI factors at the start and end of the plan
 *    year (1 at plan start). Every flow of the year is valued at the year-end index `idxE`.
 *  - Principal of a live rung is `adjustedPrincipal * idx`. The year's indexation (`accrual`) is the
 *    change over the year; it is paid out only at maturity, never as cash during the life of the bond.
 *  - Coupon = real coupon rate x indexed principal at year end.
 *  - Maturity pays the greater of indexed principal and `faceValue` (the deflation floor).
 *    `floorBonus` is the part above indexed principal.
 *  - The sleeve ignores market returns entirely; it follows only CPI. */

export type TipsAccount = TipsRung['account'];
export type TipsOwner = 'A' | 'B';

/** One rung's numbers for one year. */
export interface RungYear {
  /** Indexed principal at the start of the year. */
  begVal: number;
  /** Cash coupon for the year. */
  coupon: number;
  /** Indexation of principal over the year (negative in deflation). No cash. */
  accrual: number;
  /** Principal paid at maturity (0 in other years). Includes the floor bonus. */
  payout: number;
  /** Part of the maturity payout above indexed principal (deflation floor). */
  floorBonus: number;
  /** Indexed principal at the end of the year (0 once paid out). */
  endVal: number;
}

export function rungYear(
  rung: { adjustedPrincipal: number; faceValue?: number; couponRate: number },
  idxS: number,
  idxE: number,
  isMaturity: boolean,
): RungYear {
  const begVal = rung.adjustedPrincipal * idxS;
  const endPrin = rung.adjustedPrincipal * idxE;
  const coupon = rung.couponRate * endPrin;
  const accrual = endPrin - begVal;
  if (!isMaturity) return { begVal, coupon, accrual, payout: 0, floorBonus: 0, endVal: endPrin };
  const face = rung.faceValue ?? rung.adjustedPrincipal;
  const floorBonus = Math.max(0, face - endPrin);
  return { begVal, coupon, accrual, payout: endPrin + floorBonus, floorBonus, endVal: 0 };
}

/** Federal ordinary income a taxable rung generates in a year: coupon plus indexation (phantom
 *  income). A deflation adjustment can only offset that year's coupon, never other income, so the
 *  total is floored at zero. The deflation-floor bonus at maturity is extra interest. */
export const taxableRungIncome = (y: Pick<RungYear, 'coupon' | 'accrual' | 'floorBonus'>): number =>
  Math.max(0, y.coupon + y.accrual) + y.floorBonus;

/** The person whose IRA a pre-tax rung sits in this year. A rung left by a deceased owner is in the
 *  survivor's IRA (spousal rollover), so it stays in the survivor's RMD base. */
export function effectiveOwner(whose: TipsRung['whose'], aliveA: boolean, aliveB: boolean): TipsOwner {
  if (whose === 'B') return aliveB || !aliveA ? 'B' : 'A';
  return aliveA || !aliveB ? 'A' : 'B';
}

/** Carve a ladder's value out of an account balance by direct subtraction. The carve is capped at
 *  the balance (an over-subscribed account never goes negative) and `scale` is the share of the
 *  rungs that fits (1 when it all fits). Guarded so an empty total never divides by zero. */
export function carveOut(balance: number, rungTotal: number): { carved: number; remaining: number; scale: number } {
  const carved = Math.max(0, Math.min(balance, rungTotal));
  return { carved, remaining: balance - carved, scale: rungTotal > 0 ? carved / rungTotal : 1 };
}

export interface ResolvedRung {
  maturityYear: number;
  account: TipsAccount;
  whose: TipsRung['whose'];
  /** Principal actually held (scaled down if the account could not cover the entered rungs). */
  adjustedPrincipal: number;
  faceValue?: number;
  couponRate: number;
}

export interface ResolvedLadder {
  rungs: ResolvedRung[];
  /** Amounts to subtract from the opening balances (all zero when the balances exclude the ladder). */
  carve: { taxable: number; roth: number; tradA: number; tradB: number };
}

/** Normalise a plan's ladder for the engine: drop rungs that matured before plan start, size every
 *  rung to what its account can hold, and work out the carve-out. Returns null when no rung is left,
 *  which is the exact "no ladder" path. */
export function resolveTipsLadder(portfolio: Portfolio, startYear: number): ResolvedLadder | null {
  const ladder = portfolio.tipsLadder;
  if (!ladder) return null;
  const live = ladder.rungs.filter((r) => r.maturityYear >= startYear && r.adjustedPrincipal > 0);
  if (live.length === 0) return null;

  const inBalances = ladderInBalances(portfolio);
  const a = portfolio.personA, b = portfolio.personB;
  const total = (pick: (r: TipsRung) => boolean) => live.filter(pick).reduce((s, r) => s + r.adjustedPrincipal, 0);
  const sizes = {
    taxable: carveOut(a.taxable + (b?.taxable ?? 0), total((r) => r.account === 'taxable')),
    roth: carveOut(a.roth + (b?.roth ?? 0), total((r) => r.account === 'roth')),
    tradA: carveOut(a.traditional, total((r) => r.account === 'traditional' && r.whose !== 'B')),
    tradB: carveOut(b?.traditional ?? 0, total((r) => r.account === 'traditional' && r.whose === 'B')),
  };
  const scaleOf = (r: TipsRung): number => {
    if (!inBalances) return 1;
    if (r.account === 'taxable') return sizes.taxable.scale;
    if (r.account === 'roth') return sizes.roth.scale;
    return r.whose === 'B' ? sizes.tradB.scale : sizes.tradA.scale;
  };

  const rungs: ResolvedRung[] = [];
  for (const r of live) {
    const k = scaleOf(r);
    if (k <= 0) continue;
    rungs.push({
      maturityYear: r.maturityYear,
      account: r.account,
      whose: r.whose,
      adjustedPrincipal: k === 1 ? r.adjustedPrincipal : r.adjustedPrincipal * k,
      faceValue: r.faceValue === undefined ? undefined : (k === 1 ? r.faceValue : r.faceValue * k),
      couponRate: r.couponRate,
    });
  }
  if (rungs.length === 0) return null;
  return {
    rungs,
    carve: inBalances
      ? { taxable: sizes.taxable.carved, roth: sizes.roth.carved, tradA: sizes.tradA.carved, tradB: sizes.tradB.carved }
      : { taxable: 0, roth: 0, tradA: 0, tradB: 0 },
  };
}

/** The whole ladder for one plan year. */
export interface TipsYear {
  /** Sleeve value at the start of the year (all accounts). */
  beg: number;
  /** Pre-tax part of `beg` by owner: it joins that owner's RMD base. */
  begTradA: number;
  begTradB: number;
  coupon: number;
  /** Net indexation of principal (signed). */
  accrual: number;
  /** Principal paid at maturity (includes `floorBonus`). */
  maturity: number;
  floorBonus: number;
  /** Cash that reaches the household from taxable rungs (coupons + maturities). */
  cash: number;
  /** Coupons and maturities from pre-tax rungs, returned to each owner's IRA. */
  toTradA: number;
  toTradB: number;
  /** Coupons and maturities from Roth rungs, returned to the Roth account. */
  toRoth: number;
  /** Federal ordinary income (taxable rungs only): coupons + indexation, state-exempt. */
  ordInc: number;
  /** Sleeve value at the end of the year, by account. */
  endTaxable: number;
  endTrad: number;
  endRoth: number;
}

export function tipsLadderYear(
  ladder: ResolvedLadder,
  calendarYear: number,
  idxS: number,
  idxE: number,
  aliveA: boolean,
  aliveB: boolean,
): TipsYear {
  const y: TipsYear = {
    beg: 0, begTradA: 0, begTradB: 0, coupon: 0, accrual: 0, maturity: 0, floorBonus: 0,
    cash: 0, toTradA: 0, toTradB: 0, toRoth: 0, ordInc: 0, endTaxable: 0, endTrad: 0, endRoth: 0,
  };
  for (const r of ladder.rungs) {
    if (calendarYear > r.maturityYear) continue;
    const ry = rungYear(r, idxS, idxE, calendarYear === r.maturityYear);
    const paid = ry.coupon + ry.payout;
    y.beg += ry.begVal;
    y.coupon += ry.coupon;
    y.accrual += ry.accrual;
    y.maturity += ry.payout;
    y.floorBonus += ry.floorBonus;
    if (r.account === 'taxable') {
      y.cash += paid;
      y.ordInc += taxableRungIncome(ry);
      y.endTaxable += ry.endVal;
    } else if (r.account === 'roth') {
      y.toRoth += paid;
      y.endRoth += ry.endVal;
    } else if (effectiveOwner(r.whose, aliveA, aliveB) === 'A') {
      y.begTradA += ry.begVal; y.toTradA += paid; y.endTrad += ry.endVal;
    } else {
      y.begTradB += ry.begVal; y.toTradB += paid; y.endTrad += ry.endVal;
    }
  }
  return y;
}
