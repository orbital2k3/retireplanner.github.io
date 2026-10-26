import { createHash } from 'node:crypto';
import { vi } from 'vitest';
import type { ProjectionResult, ProjectionRow } from '../projection';

/** Shared helpers for the bit-exact regression snapshots (see hsa-tips-qcd-plan.md, P0-4).
 *
 *  A snapshot is a hash of the engine's output with every number encoded exactly (shortest
 *  round-trip digits, -0, NaN and ±Infinity kept distinct), so a one-ulp change shows up. The
 *  key lists below are **whitelists of today's fields**: new row or result fields added by later
 *  phases stay outside the snapshot, so "feature absent" must reproduce today's values exactly. */

/** `ProjectionRow` keys as of 869e998. Do NOT extend when adding new row fields. */
export const ROW_KEYS = [
  'year', 'ageA', 'ageB', 'phase', 'filingStatus', 'inflationFactor', 'contribA', 'contribB',
  'spousalA', 'spousalB', 'ssA', 'ssB', 'totalSS', 'otherIncome', 'otherIncomeTaxable',
  'otherIncomeNonExempt', 'exemptInterest', 'netSpend', 'wdTax', 'wdTrd', 'wdRth', 'totalWD',
  'bracketOverridden', 'rmd', 'rothConv', 'ordIncome', 'ltcg', 'ordinaryDiv', 'qualifiedDiv',
  'distributedCash', 'distributedDiv', 'fedTax', 'stateTaxAmt', 'irmaa', 'niit', 'effRate',
  'marginalRate', 'stateMarginalRate', 'stdDeduction', 'seniorBonus', 'magi', 'acaMagi',
  'irmaaMagi', 'acaPremium', 'lumpSumInjectTaxable', 'lumpSumInjectTrad', 'lumpSumInjectRoth',
  'lumpSumOrdinaryIncome', 'lumpSumForcedTradDist', 'lumpSumForcedRothDist', 'inheritedTradFromWd',
  'inheritedRothFromWd', 'inheritedBegBal', 'inheritedBal', 'inheritedRothBegBal',
  'inheritedRothBal', 'cashSurplus', 'begTaxable', 'begTraditional', 'begRoth', 'endTaxable',
  'endTraditional', 'endRoth', 'endTotal', 'endTaxableBasis', 'endTaxAdjusted', 'ranOut',
  'shortfall', 'taxFromBrokerage',
] as const;

/** `ProjectionResult` aggregates as of 869e998 (rows and decisionNotes are handled separately). */
export const RESULT_KEYS = [
  'lifetimeFedTax', 'lifetimeFedTaxReal', 'lifetimeRMD', 'lifetimeRMDReal', 'lifetimeConversion',
  'lifetimeConversionReal', 'endTotalNominal', 'endTotalReal', 'endTaxAdjustedNominal',
  'endTaxAdjustedReal', 'yearsCovered', 'lifetimeShortfallReal', 'ranOut', 'overrideEvents',
] as const;

/** Pinned "today". The projection reads the current date for its start year and for how much of year 1
 *  is left, so every calendar-dependent value follows this date. Jan 1 means a full year 1 (no
 *  proration), which keeps the snapshots meaning "a whole first year". No `Z`: local noon, so no
 *  timezone can move it to another calendar day. */
export const PINNED_NOW = '2026-01-01T12:00:00';

/** Call from `beforeAll`; pair with `unpinDate` in `afterAll`. Only Date is faked, so the
 *  optimizer's performance.now()-style timers keep working. */
export function pinDate(): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(PINNED_NOW));
}
export function unpinDate(): void {
  vi.useRealTimers();
}

/** Exact, deterministic text for any value built from numbers, strings, booleans, arrays and plain
 *  objects. Plain JSON.stringify would turn NaN/Infinity into null and -0 into 0. */
export function enc(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v === undefined) return '#undefined';
    if (typeof v === 'number' && (!Number.isFinite(v) || Object.is(v, -0))) return '#' + (Object.is(v, -0) ? '-0' : String(v));
    return v;
  });
}

export const sha = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16);

export function rowWhitelist(row: ProjectionRow): Record<string, unknown> {
  const r = row as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of ROW_KEYS) out[k] = r[k];
  return out;
}

export interface ProjectionDigest {
  /** Whitelisted aggregates, each encoded with `enc` (kept readable so a mismatch names the key). */
  aggregates: Record<string, string>;
  /** One hash per row over the whitelisted keys. */
  rows: string[];
}

export function digestProjection(res: ProjectionResult): ProjectionDigest {
  const r = res as unknown as Record<string, unknown>;
  const aggregates: Record<string, string> = {};
  for (const k of RESULT_KEYS) aggregates[k] = enc(r[k]);
  return { aggregates, rows: res.rows.map((row) => sha(enc(rowWhitelist(row)))) };
}

/** First differences between two digests, as short readable lines (empty array = identical). */
export function diffDigest(actual: ProjectionDigest, expected: ProjectionDigest, rowsOf?: ProjectionRow[]): string[] {
  const out: string[] = [];
  for (const k of RESULT_KEYS) {
    if (actual.aggregates[k] !== expected.aggregates[k]) {
      out.push(`aggregate ${k}: ${actual.aggregates[k]} (expected ${expected.aggregates[k]})`);
    }
  }
  if (actual.rows.length !== expected.rows.length) out.push(`row count ${actual.rows.length} (expected ${expected.rows.length})`);
  const n = Math.min(actual.rows.length, expected.rows.length);
  let shown = 0;
  for (let i = 0; i < n && shown < 5; i++) {
    if (actual.rows[i] !== expected.rows[i]) {
      out.push(`row ${i}${rowsOf ? ` (age ${rowsOf[i].ageA})` : ''} differs`);
      shown++;
    }
  }
  return out;
}
