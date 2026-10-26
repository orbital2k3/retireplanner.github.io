import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { Plan } from '../../schemas/plan';
import { planF_allTradCouple, planG_californiaCouple, planP_tightPlan } from '../__golden/plans';
import type { UserGoal } from '../recommender';
import { optimizeCached } from '../__testutil__/optimizeCached';
import { digestProjection, enc, pinDate, sha, unpinDate, type ProjectionDigest } from './snapshotUtil';

/** Optimizer bit-exact snapshot (opt tier, companion to bitExact.test.ts).
 *
 *  Pins the optimizer's output on cheap fixtures: the shipped withdrawal/conversion policy
 *  (compacted windows in the clear, per-year windows by hash), the score, the evaluation count
 *  and the exact projection digest of the winning policy. A feature that a plan doesn't use must
 *  leave all of it unchanged. Regenerate only for an intended optimizer change:
 *  `UPDATE_BITEXACT=1 npx vitest run --project opt optimizerSnapshot`. */

const SNAP_FILE = path.join(path.dirname(new URL(import.meta.url).pathname), 'optimizerSnapshot.snap.json');
const UPDATE = process.env.UPDATE_BITEXACT === '1';

interface OptSnap {
  policy: unknown;
  perYearPolicyHash: string;
  metric: string;
  evaluations: number;
  ranOut: boolean;
  conversionsDisabled: boolean | null;
  conversionBaselineMetric: string;
  solvedSpendingMultiplier: string;
  projection: ProjectionDigest;
}

const snapshot: Record<string, OptSnap> = !UPDATE && fs.existsSync(SNAP_FILE) ? JSON.parse(fs.readFileSync(SNAP_FILE, 'utf8')) : {};
const produced: Record<string, OptSnap> = {};

pinDate(); // at load, so fixtures built while collecting describe blocks see the pinned year too
afterAll(() => {
  unpinDate();
  if (UPDATE) {
    const sorted = Object.fromEntries(Object.entries(produced).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(SNAP_FILE, JSON.stringify(sorted, null, 1) + '\n');
  }
});

const cases: Array<[string, () => Plan, UserGoal]> = [
  ['planF max-end-balance', planF_allTradCouple, 'max-end-balance'],
  ['planG max-end-balance', planG_californiaCouple, 'max-end-balance'],
  ['planP max-end-balance', planP_tightPlan, 'max-end-balance'],
  ['planP max-sustainable-spending', planP_tightPlan, 'max-sustainable-spending'],
];

describe('optimizer bit-exact snapshot', () => {
  it.each(cases)('%s', (name, mk, goal) => {
    const r = optimizeCached(mk(), goal, { thorough: false });
    const actual: OptSnap = {
      policy: JSON.parse(enc(r.policy)),
      perYearPolicyHash: sha(enc(r.perYearPolicy)),
      metric: enc(r.metric),
      evaluations: r.evaluations,
      ranOut: r.ranOut,
      conversionsDisabled: r.conversionsDisabled ?? null,
      conversionBaselineMetric: enc(r.conversionBaselineMetric),
      solvedSpendingMultiplier: enc(r.solvedSpendingMultiplier),
      projection: digestProjection(r.projection),
    };
    produced[name] = actual;
    if (UPDATE) return;
    const expected = snapshot[name];
    expect(expected, `no snapshot for ${name}; run with UPDATE_BITEXACT=1 at the base commit`).toBeDefined();
    // Compare piecewise so a failure names the field that moved.
    expect(actual.metric, `${name}: score`).toBe(expected.metric);
    expect(actual.policy, `${name}: compacted policy windows`).toEqual(expected.policy);
    expect(actual.perYearPolicyHash, `${name}: per-year policy`).toBe(expected.perYearPolicyHash);
    expect(actual.evaluations, `${name}: evaluation count`).toBe(expected.evaluations);
    expect(actual, `${name}: other fields`).toEqual(expected);
  }, 300_000);

  it('snapshot file has exactly the cases produced', () => {
    if (UPDATE) return;
    expect(Object.keys(produced).sort()).toEqual(Object.keys(snapshot).sort());
  });
});
