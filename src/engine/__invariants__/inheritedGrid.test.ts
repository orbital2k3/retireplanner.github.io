import { describe, it, expect } from 'vitest';
import { runProjection } from '../projection';
import { assertProjectionInvariants } from './assertions';
import type { Plan, LumpSumEvent } from '../../schemas/plan';
import * as G from '../__golden/plans';

/** Inherited IRA/Roth grid (M12): the forced distribution must be reserved before strategy draws and
 *  conversions, and the tracked inherited balance must never exceed the account that holds it. */
const STRATS: Plan['withdrawalStrategy'][] = ['taxfirst', 'tradfirst', 'rothfirst', 'proportional', 'bracketfill'];
const BUCKETS = ['inheritedPreTaxIRA', 'inheritedRoth'] as const;
const OWN = [0, 50_000, 400_000];
const TAXABLE = [0, 100_000, 1_000_000];
const CONV = [false, true];
const STARTED = [false, true];

function gridPlan(strat: Plan['withdrawalStrategy'], bucket: typeof BUCKETS[number], own: number, taxable: number, conv: boolean, started: boolean): Plan {
  const p = G.planB_largeTradSingle();
  p.withdrawalStrategy = strat;
  p.portfolio.personA = {
    ...p.portfolio.personA,
    taxable, taxableBasis: taxable * 0.6,
    traditional: bucket === 'inheritedPreTaxIRA' ? own : p.portfolio.personA.traditional,
    roth: bucket === 'inheritedRoth' ? own : p.portfolio.personA.roth,
  };
  if (conv) p.conversion = { ...p.conversion, mode: 'bracket-fill', startAge: 65, endAge: 75, optimize: false };
  const ev: LumpSumEvent = { id: 'inh', description: 'inh', whose: 'A', bucket, age: 66, amount: 300_000, ownerStartedRmds: started };
  p.lumpSumEvents = [ev];
  return p;
}

describe('inherited account grid: reserve forced distributions, track the real balance', () => {
  for (const strat of STRATS) {
    it(strat, () => {
      const failures: string[] = [];
      for (const bucket of BUCKETS) for (const own of OWN) for (const tax of TAXABLE) for (const conv of CONV) for (const started of STARTED) {
        const p = gridPlan(strat, bucket, own, tax, conv, started);
        try { assertProjectionInvariants(runProjection(p), p, { skipSpendingCoverage: true }); }
        catch (e) { failures.push(`${bucket} own=${own} tax=${tax} conv=${conv} started=${started}: ${(e as Error).message.split('\n').slice(0, 2).join(' | ')}`); }
      }
      expect(failures).toEqual([]);
    });
  }
});

describe('inherited account grid: couple, owner per spouse, B dies inside the 10-year window', () => {
  for (const strat of STRATS) {
    it(strat, () => {
      const failures: string[] = [];
      for (const whose of ['A', 'B', 'Household'] as const) for (const bucket of BUCKETS) for (const ownA of OWN) for (const ownB of OWN) for (const conv of CONV) {
        const p = G.planH_survivorMidPlan();
        p.withdrawalStrategy = strat;
        const key = bucket === 'inheritedPreTaxIRA' ? 'traditional' : 'roth';
        p.portfolio.personA = { ...p.portfolio.personA, [key]: ownA, taxable: 50_000, taxableBasis: 30_000 };
        p.portfolio.personB = { ...p.portfolio.personB!, [key]: ownB, taxable: 0, taxableBasis: 0 };
        if (conv) p.conversion = { ...p.conversion, mode: 'bracket-fill', startAge: 65, endAge: 80, optimize: false };
        // A turns 70 when B is 68; B dies at 75 (A 77), three years before the deadline.
        p.lumpSumEvents = [{ id: 'inh', description: 'inh', whose, bucket, age: whose === 'B' ? 68 : 70, amount: 300_000, ownerStartedRmds: true }];
        try {
          const proj = runProjection(p);
          assertProjectionInvariants(proj, p, { skipSpendingCoverage: true });
          const bad = proj.rows.find((r) => r.inheritedTradFromWd > r.wdTrd + 0.01);
          if (bad) throw new Error(`inheritedTradFromWd ${bad.inheritedTradFromWd} > wdTrd ${bad.wdTrd} at ${bad.ageA}`);
        }
        catch (e) { failures.push(`${whose} ${bucket} ownA=${ownA} ownB=${ownB} conv=${conv}: ${(e as Error).message.split('\n').slice(0, 2).join(' | ')}`); }
      }
      expect(failures).toEqual([]);
    });
  }
});
