import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { runProjection, type ProjectionResult } from '../projection';
import { samplePlan, type Plan } from '../../schemas/plan';
import * as golden from '../__golden/plans';
import { runMonteCarlo, runHistoricalSweep } from '../monteCarlo';
import { DEFAULT_EQUITY_PCT, historicalBootstrap, historicalSequence, mulberry32, parametricNormal } from '../returnModels';
import { START_YEAR, indexOfYear } from '../marketHistory';
import {
  ROW_KEYS, digestProjection, diffDigest, enc, pinDate, rowWhitelist, sha, unpinDate,
  type ProjectionDigest,
} from './snapshotUtil';

/** Bit-exact regression snapshot (fast tier). See hsa-tips-qcd-plan.md, "Regression guardrails".
 *
 *  Every case runs the engine and compares an exact digest of the output to `bitExact.snap.json`:
 *  per-row hashes over the whitelisted `ProjectionRow` keys, plus the whitelisted aggregates. The
 *  golden CSVs allow ±$2; this does not allow one ulp. Rows and aggregates added after 869e998 are
 *  outside the whitelist, so a plan that doesn't use a new feature must reproduce today's numbers.
 *
 *  Never regenerate to make a feature branch green. The snapshot changes only when a change is
 *  *meant* to move projection output: `UPDATE_BITEXACT=1 npx vitest run --project fast bitExact`.
 *  To see what moved, dump the rows on both sides and diff:
 *  `BITEXACT_DUMP=/tmp/a npx vitest run --project fast bitExact` (then `diff -r /tmp/a /tmp/b`). */

const SNAP_FILE = path.join(path.dirname(new URL(import.meta.url).pathname), 'bitExact.snap.json');
const UPDATE = process.env.UPDATE_BITEXACT === '1';
const DUMP = process.env.BITEXACT_DUMP;

type Entry = { digest: ProjectionDigest } | { hash: string };
type Snap = Record<string, Entry>;

const snapshot: Snap = !UPDATE && fs.existsSync(SNAP_FILE) ? JSON.parse(fs.readFileSync(SNAP_FILE, 'utf8')) : {};
const produced: Snap = {};

pinDate(); // at load, so fixtures built while collecting describe blocks see the pinned year too
afterAll(() => {
  unpinDate();
  if (UPDATE) {
    const sorted = Object.fromEntries(Object.entries(produced).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(SNAP_FILE, JSON.stringify(sorted, null, 1) + '\n');
  }
});

function dump(name: string, res: ProjectionResult): void {
  if (!DUMP) return;
  fs.mkdirSync(DUMP, { recursive: true });
  const body = { aggregates: digestProjection(res).aggregates, rows: res.rows.map(rowWhitelist) };
  fs.writeFileSync(path.join(DUMP, `${name}.json`), JSON.stringify(body, null, 1));
}

function checkProjection(name: string, res: ProjectionResult): void {
  const digest = digestProjection(res);
  dump(name, res);
  produced[name] = { digest };
  if (UPDATE) return;
  const expected = snapshot[name];
  expect(expected, `no snapshot for ${name}; run with UPDATE_BITEXACT=1 at the base commit`).toBeDefined();
  expect(diffDigest(digest, (expected as { digest: ProjectionDigest }).digest, res.rows), `${name} drifted`).toEqual([]);
}

function checkHash(name: string, value: unknown): void {
  const hash = sha(enc(value));
  produced[name] = { hash };
  if (UPDATE) return;
  const expected = snapshot[name];
  expect(expected, `no snapshot for ${name}; run with UPDATE_BITEXACT=1 at the base commit`).toBeDefined();
  expect((expected as { hash: string }).hash, `${name} drifted`).toBe(hash);
}

const goldenPlans = (Object.entries(golden) as [string, () => Plan][])
  .filter(([k]) => /^plan[A-P]_/.test(k))
  .sort(([a], [b]) => a.localeCompare(b));

describe('bit-exact projection snapshot', () => {
  it('covers golden plans A-P', () => {
    expect(goldenPlans.map(([k]) => k[4])).toEqual('ABCDEFGHIJKLMNOP'.split(''));
  });

  it.each(goldenPlans)('%s', (name, mk) => {
    checkProjection(name, runProjection(mk()));
  });

  it('samplePlan', () => {
    checkProjection('samplePlan', runProjection(samplePlan()));
  });

  it('CA plan with payTaxFromBrokerage and bracket-fill conversions', () => {
    const plan: Plan = { ...golden.planG_californiaCouple(), payTaxFromBrokerage: true };
    checkProjection('caPayTaxFromBrokerage', runProjection(plan));
  });

  it('one seeded Monte Carlo trial (historical bootstrap, samplePlan)', () => {
    const plan = samplePlan();
    const n = runProjection(plan).rows.length;
    const { returns, inflations } = historicalBootstrap(mulberry32(7), DEFAULT_EQUITY_PCT, n, 3);
    checkProjection('mcTrialHistorical', runProjection(plan, { returnOverrides: returns, inflationOverrides: inflations }));
  });

  it('one seeded Monte Carlo trial (parametric, planG)', () => {
    const plan = golden.planG_californiaCouple();
    const n = runProjection(plan).rows.length;
    const returns = parametricNormal(mulberry32(11), plan.assumptions.tradReturn, 0.10, n);
    checkProjection('mcTrialParametric', runProjection(plan, { returnOverrides: returns }));
  });

  it('one historical cohort (1966 start, samplePlan)', () => {
    const plan = samplePlan();
    const n = runProjection(plan).rows.length;
    const seq = historicalSequence(DEFAULT_EQUITY_PCT, n, indexOfYear(1966));
    const pad = n - seq.yearsAvailable;
    const returns = [...seq.returns, ...Array<number>(pad).fill(plan.assumptions.tradReturn)];
    const inflations = [...seq.inflations, ...Array<number>(pad).fill(plan.assumptions.inflation)];
    checkProjection('historicalCohort1966', runProjection(plan, { returnOverrides: returns, inflationOverrides: inflations }));
  });

  it('runMonteCarlo (5 seeded trials) and runHistoricalSweep result shapes', () => {
    const plan = golden.planF_allTradCouple();
    checkHash('runMonteCarloParametric5', runMonteCarlo(plan, { trials: 5, seed: 42, model: 'parametric' }));
    checkHash('runMonteCarloHistorical5', runMonteCarlo(plan, { trials: 5, seed: 42, model: 'historical' }));
    checkHash('runHistoricalSweepPlanF', runHistoricalSweep(plan));
  });

  it('is deterministic across repeated runs', () => {
    const a = enc(digestProjection(runProjection(samplePlan())));
    const b = enc(digestProjection(runProjection(samplePlan())));
    expect(a).toBe(b);
  });

  it('pins the calendar so snapshots do not depend on the run date', () => {
    expect(new Date().getFullYear()).toBe(2026);
    expect(START_YEAR).toBeLessThan(2026);
  });

  it('whitelist is a subset of the live row keys (a removed or renamed row field fails here)', () => {
    const row = runProjection(samplePlan()).rows[0] as unknown as Record<string, unknown>;
    for (const k of ROW_KEYS) expect(Object.keys(row), `row lost key ${k}`).toContain(k);
  });

  it('snapshot file has exactly the cases produced', () => {
    if (UPDATE) return;
    expect(Object.keys(produced).sort()).toEqual(Object.keys(snapshot).sort());
  });
});
