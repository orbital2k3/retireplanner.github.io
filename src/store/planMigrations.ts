/**
 * planMigrations.ts
 *
 * Standalone migration helpers called by both the Zustand store (on load)
 * and exportImport.ts (on import).  Each function mutates the raw persisted
 * object in-place — Zod parses the result afterward.
 */
import type { Plan } from '../schemas/plan';
import { optimizerKey } from '../engine/strategy/optimizerInput';
import { liveSettings } from '../engine/strategy/resultSettings';

/**
 * v23 → v24
 *
 * Person ages — "preserve both intents" rule:
 *   per person: planThroughAge = max(retirementAge, passingAge)   [mortality age]
 *   if the new household horizon < old household horizon,
 *     extend the longest-lived person's planThroughAge back to the old horizon.
 *   delete passingAge; delete planToAge.
 *
 * Old data had three variants that may need handling:
 *   - Pre-v24: planToAge (horizon) + passingAge (mortality). Both present.
 *   - Mid-v24: planThroughAge (horizon-meaning) + passingAge (mortality). planToAge absent.
 *     (Produced by the commit-1 migration which only renamed planToAge → planThroughAge.)
 *   - v24+: only planThroughAge (mortality). Neither planToAge nor passingAge present.
 *
 * Streams: stopAge → { mode: 'age', age: N }; survivorPct backfill.
 */
export function migratePlanToV24(raw: Record<string, unknown>): void {
  // ── helper: parse birth year from ISO date ──────────────────────────────
  const birthYear = (dob: unknown): number =>
    typeof dob === 'string' && dob.length >= 4 ? parseInt(dob.slice(0, 4), 10) : 1970;

  // ── step 1: determine old horizon (before deleting planToAge) ─────────
  const pA = raw.personA as Record<string, unknown> | undefined;
  const pB = raw.personB as Record<string, unknown> | undefined;
  const byA = birthYear(pA?.dob);
  const byB = birthYear(pB?.dob);

  // Old horizon: max planToAge across persons, in A's frame.
  // planToAge was the planning horizon; planThroughAge (from the commit-1 rename) carried the same meaning.
  const oldPlanToAgeA = typeof pA?.planToAge === 'number' ? pA.planToAge as number
    : typeof pA?.planThroughAge === 'number' && !('passingAge' in (pA ?? {})) ? null
    : typeof pA?.planThroughAge === 'number' ? pA.planThroughAge as number : null;
  const oldPlanToAgeB = typeof pB?.planToAge === 'number' ? pB.planToAge as number
    : typeof pB?.planThroughAge === 'number' && !('passingAge' in (pB ?? {})) ? null
    : typeof pB?.planThroughAge === 'number' ? pB.planThroughAge as number : null;

  const bEndInAOld = oldPlanToAgeB !== null ? oldPlanToAgeB + (byB - byA) : null;
  const oldHorizonA = Math.max(oldPlanToAgeA ?? 0, bEndInAOld ?? 0) || null;

  // ── step 2: set planThroughAge = mortality age per person ─────────────
  const setMortalityAge = (p: Record<string, unknown>) => {
    if (!('passingAge' in p)) return; // already v24 — nothing to do
    const retireAge = typeof p.retirementAge === 'number' ? p.retirementAge as number : 60;
    const passing = typeof p.passingAge === 'number' ? p.passingAge as number : retireAge;
    p.planThroughAge = Math.min(115, Math.max(60, retireAge, passing));
    delete p.passingAge;
    delete p.planToAge;
  };

  if (pA) setMortalityAge(pA);
  if (pB) setMortalityAge(pB);

  // ── step 3: restore horizon if it shrank ──────────────────────────────
  if (oldHorizonA !== null && pA && pB) {
    const newA = typeof pA.planThroughAge === 'number' ? pA.planThroughAge as number : 0;
    const newB = typeof pB.planThroughAge === 'number' ? pB.planThroughAge as number : 0;
    const bEndInANew = newB + (byB - byA);
    const newHorizonA = Math.max(newA, bEndInANew);
    if (newHorizonA < oldHorizonA) {
      const shortfall = oldHorizonA - newHorizonA;
      // Extend the longer-lived person
      if (newA >= bEndInANew) {
        pA.planThroughAge = Math.min(115, newA + shortfall);
      } else {
        pB.planThroughAge = Math.min(115, newB + shortfall);
      }
    }
  } else if (oldHorizonA !== null && pA && !pB) {
    const newA = typeof pA.planThroughAge === 'number' ? pA.planThroughAge as number : 0;
    if (newA < oldHorizonA) {
      pA.planThroughAge = Math.min(115, oldHorizonA);
    }
  }

  // ── step 4: income streams — stopAge → end, survivorPct ──────────────
  if (Array.isArray(raw.incomeStreams)) {
    for (const s of raw.incomeStreams as Record<string, unknown>[]) {
      if (typeof s.stopAge === 'number' && !('end' in s)) {
        s.end = { mode: 'age', age: s.stopAge };
        delete s.stopAge;
      }
      if (!('survivorPct' in s)) s.survivorPct = 0;
    }
  }

  // ── step 5: expense streams ───────────────────────────────────────────
  if (Array.isArray(raw.expenseStreams)) {
    for (const e of raw.expenseStreams as Record<string, unknown>[]) {
      if (typeof e.stopAge === 'number' && !('end' in e)) {
        e.end = { mode: 'age', age: e.stopAge };
        delete e.stopAge;
      }
      if (!('survivorPct' in e)) e.survivorPct = 1;
    }
  }
}

/**
 * v24 → v25
 *
 * Upgrade streams whose end.age was baked in from the old planToAge horizon
 * (now planThroughAge after the v24 migration) to semantic EndRule modes so
 * they correctly follow the owner's lifetime instead of stopping at a
 * hardcoded age.
 *
 * Heuristic: a stream with { mode: 'age', age: N } where N exactly matches
 * a person's planThroughAge was almost certainly migrated from stopAge = planToAge
 * rather than being a deliberate fixed-age cutoff.
 *
 *   whose: 'A'         + end.age === personA.planThroughAge  → { mode: 'life' }
 *   whose: 'B'         + end.age === personB.planThroughAge  → { mode: 'life' }
 *   whose: 'Household' + end.age matches either person's
 *                        planThroughAge in A-frame            → { mode: 'lastSurvivor' }
 *
 * Safe for SS streams: SS survivor benefits are modeled in socialSecurity.ts
 * and rely on survivorPct: 0 (enforced by UI). Upgrading SS window mode to
 * life/lastSurvivor with survivorPct: 0 yields identical cash-flow because
 * streamFactor returns 0 after the owner dies regardless of window width.
 */
export function migratePlanToV25(raw: Record<string, unknown>): void {
  const pA = raw.personA as Record<string, unknown> | undefined;
  const pB = raw.personB as Record<string, unknown> | undefined;

  if (!pA) return;

  const planThroughAgeA = typeof pA.planThroughAge === 'number' ? pA.planThroughAge as number : null;
  const planThroughAgeB = typeof pB?.planThroughAge === 'number' ? pB.planThroughAge as number : null;

  // Compute B's planThroughAge in A's frame for Household stream end.age comparison.
  // deltaBA = startAgeB - startAgeA; planThroughBInAFrame = planThroughAgeB - deltaBA.
  let planThroughBInAFrame: number | null = null;
  if (pB && planThroughAgeB !== null && typeof pA.dob === 'string' && typeof pB.dob === 'string') {
    const byA = parseInt(pA.dob.slice(0, 4), 10);
    const byB = parseInt(pB.dob.slice(0, 4), 10);
    if (!isNaN(byA) && !isNaN(byB)) {
      const curYear = new Date().getFullYear();
      const deltaBA = (curYear - byB) - (curYear - byA); // startAgeB - startAgeA
      planThroughBInAFrame = planThroughAgeB - deltaBA;
    }
  }

  const upgradeEnd = (s: Record<string, unknown>) => {
    const end = s.end as Record<string, unknown> | undefined;
    if (!end || end.mode !== 'age' || typeof end.age !== 'number') return;
    const age = end.age as number;
    const whose = s.whose as string | undefined;

    if (whose === 'A' && planThroughAgeA !== null && age === planThroughAgeA) {
      s.end = { mode: 'life' };
    } else if (whose === 'B' && planThroughAgeB !== null && age === planThroughAgeB) {
      s.end = { mode: 'life' };
    } else if (whose === 'Household') {
      if (
        (planThroughAgeA !== null && age === planThroughAgeA) ||
        (planThroughBInAFrame !== null && age === planThroughBInAFrame)
      ) {
        s.end = { mode: 'lastSurvivor' };
      }
    }
  };

  if (Array.isArray(raw.incomeStreams)) {
    for (const s of raw.incomeStreams as Record<string, unknown>[]) upgradeEnd(s);
  }
  if (Array.isArray(raw.expenseStreams)) {
    for (const e of raw.expenseStreams as Record<string, unknown>[]) upgradeEnd(e);
  }
}

// ── Frozen pre-v34 fingerprints. Used only to recognise results that were current when saved. ──
const LEGACY_INPUT_FIELDS = [
  'personA', 'personB', 'assumptions', 'portfolio',
  'incomeStreams', 'lumpSumEvents', 'expenseStreams', 'withdrawalStrategy',
  'withdrawalBracketCeiling', 'conversion', 'payTaxFromBrokerage', 'state',
  'customStateTaxRate', 'goals',
] as const;

/** planInputKey as of v33: insertion-order JSON of the input fields, manualSchedule excluded. */
export function legacyPlanInputKey(raw: Record<string, unknown>): string {
  const { manualSchedule, ...conversion } = (raw.conversion ?? {}) as Record<string, unknown>;
  void manualSchedule;
  return JSON.stringify(Object.fromEntries(LEGACY_INPUT_FIELDS.map((k) => [k, k === 'conversion' ? conversion : raw[k]])));
}

/** manualScheduleKey as of v33. */
export function legacyManualScheduleKey(raw: Record<string, unknown>): string {
  const s = ((raw.conversion as Record<string, unknown> | undefined)?.manualSchedule ?? {}) as Record<string, number>;
  return JSON.stringify(Object.keys(s).filter((k) => s[k] !== 0).sort().map((k) => [k, s[k]]));
}

/** True when a stored optimizer result was current under the pre-v34 keys. */
export function wasLegacyFresh(raw: Record<string, unknown>): boolean {
  const cp = raw.customPolicy as Record<string, unknown> | undefined;
  if (!cp || cp.source !== 'optimizer' || typeof cp.inputKey !== 'string') return false;
  if (cp.inputKey !== legacyPlanInputKey(raw)) return false;
  return cp.manualScheduleKey == null || cp.manualScheduleKey === legacyManualScheduleKey(raw);
}

/**
 * v33 → v34
 *
 * Staleness moves to a single key, optimizerKey. Re-stamp results that were current under the
 * old keys so no plan turns stale on upgrade; results already out of date stay out of date.
 * manualScheduleKey is retired (the schedule is part of optimizerKey now).
 * Optimizer results get a settings snapshot of the plan's current strategy fields, so the
 * projection is unchanged today and stays put when those fields are edited later.
 */
export function migratePlanToV34(raw: Record<string, unknown>): void {
  const cp = raw.customPolicy as Record<string, unknown> | undefined;
  if (!cp) return;
  if (wasLegacyFresh(raw)) cp.inputKey = optimizerKey(raw as unknown as Plan);
  delete cp.manualScheduleKey;
  stampLegacySettings(raw);
}

/** Freezes the current strategy fields onto an optimizer result saved without a snapshot. */
export function stampLegacySettings(raw: Record<string, unknown>): void {
  const cp = raw.customPolicy as Record<string, unknown> | undefined;
  if (cp?.source === 'optimizer' && !cp.settings && raw.conversion) cp.settings = liveSettings(raw as unknown as Plan);
}
