/**
 * planMigrations.ts
 *
 * Standalone migration helpers called by both the Zustand store (on load)
 * and exportImport.ts (on import).  Each function mutates the raw persisted
 * object in-place — Zod parses the result afterward.
 */
import { PlanSchema, type Plan } from '../schemas/plan';
import type { SavedPlan } from '../schemas/savedPlan';
import { optimizerKey } from '../engine/strategy/optimizerInput';
import { liveSettings } from '../engine/strategy/resultSettings';
import { fromFlat } from '../engine/strategy/savedPlan';
import { policyStatus } from '../engine/policyStatus';
import { FED_BRACKETS_MFJ } from '../engine/taxConstants';

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

/** True when a flat plan's optimizer result matches its v34 key (judged on the object as stored). */
export function wasV34Fresh(raw: Record<string, unknown>): boolean {
  return policyStatus(raw as unknown as Plan) === 'fresh';
}

/**
 * v34 → v35
 *
 * The flat strategy fields move into `strategy` slots ("Set it myself", "Optimize for me", and the
 * optimizer result). The active slot is the one the flat plan was showing, so projections are
 * unchanged, and a result that was current stays current. Returns the new plan object.
 */
export function migrateFlatToSaved(raw: Record<string, unknown>, fresh = wasV34Fresh(raw)): SavedPlan {
  const parsed = PlanSchema.safeParse(raw);
  return fromFlat(parsed.success ? parsed.data : (raw as unknown as Plan), fresh);
}

/**
 * v1 → v33 field migrations on a flat plan, in place. The store runs them on load and import runs
 * them on old files, so every file version the app has written loads the same way. Steps are
 * guarded by `fromVersion` and by shape, so running one on an already-current plan is harmless.
 */
export function migrateFlatFields(plan: Record<string, unknown>, fromVersion: number): void {
  // Oldest first: each step expects the shape the steps before it produce. v34 and v35 run
  // after these (migratePlanToV34, migrateFlatToSaved).
  if (fromVersion < 2) {
    const oldPf = (plan.portfolio ?? {}) as Record<string, number>;
    // Only migrate if it looks like the v1 flat shape
    if ('taxable' in oldPf || 'splitTaxable' in oldPf) {
      const split = {
        taxable: typeof oldPf.splitTaxable === 'number' ? oldPf.splitTaxable : 0.2,
        traditional: typeof oldPf.splitTraditional === 'number' ? oldPf.splitTraditional : 0.4,
        roth: typeof oldPf.splitRoth === 'number' ? oldPf.splitRoth : 0.4,
      };
      plan.portfolio = {
        personA: {
          taxable: oldPf.taxable ?? 0,
          traditional: oldPf.traditional ?? 0,
          roth: oldPf.roth ?? 0,
          annualContribution: oldPf.contribA ?? 0,
          contribSplit: split,
        },
        personB: plan.personB
          ? {
              taxable: 0,
              traditional: 0,
              roth: 0,
              annualContribution: oldPf.contribB ?? 0,
              contribSplit: split,
            }
          : undefined,
      };
    }
  }
  if (fromVersion < 3 && !Array.isArray(plan.goals)) {
    plan.goals = [];
  }
  if (fromVersion < 4) {
    const assumptions = plan.assumptions as Record<string, unknown> | undefined;
    if (assumptions) {
      if (!('modelACA' in assumptions)) assumptions.modelACA = false;
      if (!('acaHouseholdSize' in assumptions)) assumptions.acaHouseholdSize = 2;
      if (!('acaBenchmarkPremium' in assumptions)) assumptions.acaBenchmarkPremium = 0;
      if (!('acaNoSubsidy' in assumptions)) assumptions.acaNoSubsidy = false;
    }
  }
  // v5: contribGrowth moved from assumptions (household-wide) to each person's
  // portfolio. Copy the old single value onto both people so projections are
  // unchanged; persisted plans without it would otherwise yield NaN factors.
  if (fromVersion < 5) {
    const asm = plan.assumptions as Record<string, unknown> | undefined;
    const oldCg = asm && typeof asm.contribGrowth === 'number' ? asm.contribGrowth : 0;
    const pf = plan.portfolio as { personA?: Record<string, unknown>; personB?: Record<string, unknown> } | undefined;
    if (pf?.personA && typeof pf.personA === 'object' && !('contribGrowth' in pf.personA)) pf.personA.contribGrowth = oldCg;
    if (pf?.personB && typeof pf.personB === 'object' && !('contribGrowth' in pf.personB)) pf.personB.contribGrowth = oldCg;
    if (asm && 'contribGrowth' in asm) delete asm.contribGrowth;
  }
  // v6 backfilled assumptions.equityPct; removed, since v30 deletes that field.
  // v7: replace preRetReturn/postRetReturn with per-bucket taxableReturn/tradReturn/rothReturn.
  // Remove any income streams with removed types Wages/Rental.
  if (fromVersion < 7) {
    const asm = plan.assumptions as Record<string, unknown> | undefined;
    if (asm) {
      const pre = typeof asm.preRetReturn === 'number' ? asm.preRetReturn : 0.065;
      const post = typeof asm.postRetReturn === 'number' ? asm.postRetReturn : 0.05;
      if (!('taxableReturn' in asm)) asm.taxableReturn = pre;
      if (!('tradReturn' in asm)) asm.tradReturn = pre;
      if (!('rothReturn' in asm)) asm.rothReturn = post;
      delete asm.preRetReturn;
      delete asm.postRetReturn;
    }
    const streams = plan.incomeStreams;
    if (Array.isArray(streams)) {
      plan.incomeStreams = streams.filter((s: Record<string, unknown>) => s.type !== 'Wages' && s.type !== 'Rental');
    }
  }
  // v8: rmdStartAge removed from assumptions (now derived from personA.dob).
  if (fromVersion < 8) {
    const asm = plan.assumptions as Record<string, unknown> | undefined;
    if (asm) delete asm.rmdStartAge;
  }
  // v9: withdrawalBracketCeiling added (configurable bracket-fill ceiling for withdrawal ordering).
  if (fromVersion < 9) {
    if (!('withdrawalBracketCeiling' in plan)) plan.withdrawalBracketCeiling = FED_BRACKETS_MFJ[1][0];
  }
  // v10: migrate stale 2025 bracket thresholds → 2026 values (taxConstants update).
  if (fromVersion < 10) {
    const OLD_TO_NEW: Record<number, number> = { 23850: 24800, 96950: 100800, 206700: 211400, 394600: 403550 };
    const wdCur = plan.withdrawalBracketCeiling as number | undefined;
    if (wdCur !== undefined && OLD_TO_NEW[wdCur] !== undefined) plan.withdrawalBracketCeiling = OLD_TO_NEW[wdCur];
    const conv = plan.conversion as Record<string, unknown> | undefined;
    if (conv) {
      const convCur = conv.bracketCeiling as number | undefined;
      if (convCur !== undefined && OLD_TO_NEW[convCur] !== undefined) conv.bracketCeiling = OLD_TO_NEW[convCur];
    }
  }
  // v11: initialize taxableBasis to 50% of taxable balance (preserves prior 50% flat assumption).
  if (fromVersion < 11) {
    const pf = plan.portfolio as Record<string, unknown> | undefined;
    const pA = pf?.personA as Record<string, unknown> | undefined;
    const pB = pf?.personB as Record<string, unknown> | undefined;
    if (pA && pA.taxableBasis == null) pA.taxableBasis = ((pA.taxable as number) ?? 0) * 0.5;
    if (pB && pB.taxableBasis == null) pB.taxableBasis = ((pB.taxable as number) ?? 0) * 0.5;
  }
  // v12: backfill stateTaxablePct = 1 on existing income streams.
  if (fromVersion < 12) {
    const streams = plan.incomeStreams as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(streams)) {
      for (const s of streams) {
        if (s.stateTaxablePct == null) s.stateTaxablePct = 1;
      }
    }
  }
  // v13: backfill conversion.optimize = true (preserves prior optimizer-decides-conversions behavior).
  if (fromVersion < 13) {
    const conv = plan.conversion as Record<string, unknown> | undefined;
    if (conv && typeof conv === 'object' && conv.optimize == null) conv.optimize = true;
  }
  // v14: add lumpSumEvents array to plan.
  if (fromVersion < 14) {
    if (!Array.isArray(plan.lumpSumEvents)) plan.lumpSumEvents = [];
  }
  // v15: rename legacy bucket values 'trad'→'inheritedPreTaxIRA', 'roth'→'inheritedRoth'.
  if (fromVersion < 15) {
    const events = plan.lumpSumEvents as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(events)) {
      for (const ev of events) {
        if (ev.bucket === 'trad') ev.bucket = 'inheritedPreTaxIRA';
        else if (ev.bucket === 'roth') ev.bucket = 'inheritedRoth';
      }
    }
  }
  // v16: convert growthPct/inflationPct/contribGrowth from number to GrowthRate object.
  if (fromVersion < 16) {
    const incomes = plan.incomeStreams as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(incomes)) {
      for (const s of incomes) {
        if (typeof s.growthPct === 'number') s.growthPct = { mode: 'fixed', rate: s.growthPct };
      }
    }
    const expenses = plan.expenseStreams as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(expenses)) {
      for (const e of expenses) {
        if (typeof e.inflationPct === 'number') e.inflationPct = { mode: 'fixed', rate: e.inflationPct };
      }
    }
    const pf = plan.portfolio as Record<string, unknown> | undefined;
    const pA = pf?.personA as Record<string, unknown> | undefined;
    const pB = pf?.personB as Record<string, unknown> | undefined;
    if (pA && typeof pA.contribGrowth === 'number') pA.contribGrowth = { mode: 'fixed', rate: pA.contribGrowth };
    if (pB && typeof pB.contribGrowth === 'number') pB.contribGrowth = { mode: 'fixed', rate: pB.contribGrowth };
  }
  // v17: add taxableDivYield and taxableQualifiedPct to assumptions.
  if (fromVersion < 17 && plan.assumptions && typeof plan.assumptions === 'object') {
    const asm = plan.assumptions as Record<string, unknown>;
    asm.taxableDivYield    ??= 0;
    asm.taxableQualifiedPct ??= 0.80;
  }
  // v18: remove base* snapshot fields (optimizer results are now ephemeral in useOptimizerStore).
  if (fromVersion < 18) {
    delete plan.baseExpenseStreams;
    delete plan.basePersonA;
    delete plan.basePersonB;
  }
  // v19: add acaStartAgeA / acaStartAgeB (optional; engine falls back to retirement age).
  // v20: add payTaxFromBrokerage (default false — preserves existing behavior).
  if (fromVersion < 20) {
    if (!('payTaxFromBrokerage' in plan)) plan.payTaxFromBrokerage = false;
  }
  // v21: tax-exempt income (MuniBond/VA streams + portfolio exempt yield). Defaults preserve existing behavior.
  if (fromVersion < 21 && plan.assumptions && typeof plan.assumptions === 'object') {
    const asm = plan.assumptions as Record<string, unknown>;
    asm.taxableExemptYield    ??= 0;
    asm.taxableExemptStatePct ??= 1;
  }
  // v22: tax-adjusted balance rates. 22% / 15% are the new modeling defaults; the
  // pre-v22 behavior is exactly 0% / 0% (no tax adjustment).
  if (fromVersion < 22 && plan.assumptions && typeof plan.assumptions === 'object') {
    const asm = plan.assumptions as Record<string, unknown>;
    asm.taxAdjOrdRate  ??= 0.22;
    asm.taxAdjLtcgRate ??= 0.15;
  }
  // v23: dividend payout election. Default 0 = full reinvestment (DRIP), preserving pre-v23 behavior.
  if (fromVersion < 23 && plan.assumptions && typeof plan.assumptions === 'object') {
    const asm = plan.assumptions as Record<string, unknown>;
    asm.taxableDistributePct ??= 0;
  }
  // v24: planToAge → planThroughAge; stopAge → end: EndRule; add survivorPct.
  if (fromVersion < 24) {
    migratePlanToV24(plan);
  }
  // v25: upgrade streams with end.age === planThroughAge to semantic EndRule modes
  // (life / lastSurvivor) so they follow the owner's lifetime rather than a baked-in age.
  if (fromVersion < 25) {
    migratePlanToV25(plan);
  }
  // v27: add per-person spousalContribution / spousalTarget (spousal IRA while the other
  // spouse still works). Both optional; absent === 0 === pre-v27 behavior, so no data
  // rewrite is needed. Version bumped only to record the schema change.
  // v28: add assumptions.legacyTargetTaxAdjReal (after-tax legacy floor for max-spending).
  // Absent === 0 === unconstrained === pre-v28 behavior. No data rewrite needed.
  // v29: stamp inputKey on existing optimizer-authored customPolicy so users aren't gated on
  // first load after the upgrade. Treats already-persisted policies as fresh (mirrors pre-v29 behavior).
  if (fromVersion < 29) {
    const cp = plan.customPolicy as Record<string, unknown> | undefined;
    if (cp && cp.source === 'optimizer' && !cp.inputKey) {
      cp.inputKey = legacyPlanInputKey(plan);
    }
  }
  // v30: equityPct moved out of the plan. It is a Monte Carlo stress-test setting, not plan
  // data, and leaving it in assumptions put it inside planInputKey, where changing the mix
  // would mark an optimizer policy stale. Now a UI preference (lib/mcPrefs.ts). Delete the
  // stale key so it stops riding along in plan exports.
  if (fromVersion < 30) {
    const asm = plan.assumptions as Record<string, unknown> | undefined;
    if (asm && 'equityPct' in asm) delete asm.equityPct;
  }
  // v31: add plan.optimizedBy + plan.mcTuning (strategy provenance: the goal optimizer vs a
  // Monte Carlo robustness run). Existing optimizer-authored policies predate the Monte Carlo
  // apply path, so stamp them as 'optimizer'. Absent === unknown provenance elsewhere.
  if (fromVersion < 31) {
    const cp = plan.customPolicy as Record<string, unknown> | undefined;
    if (cp && cp.source === 'optimizer' && !plan.optimizedBy) plan.optimizedBy = 'optimizer';
  }
  // v32: add optional lumpSumEvents[].ownerStartedRmds (annual RMDs on inherited pre-tax IRAs).
  // Absent === false === pre-v32 behavior, so no data rewrite is needed.
  // v33: stamped a manual-schedule key; superseded by v34, which treats a missing one as current.
}

/** Every migration from `fromVersion` to the current store version, for a persisted plan. */
export function migrateStoredPlan(plan: Record<string, unknown>, fromVersion: number): Record<string, unknown> {
  migrateFlatFields(plan, fromVersion);
  if (fromVersion < 34) migratePlanToV34(plan);
  // v35: flat strategy fields → strategy slots (runs after every flat-shape migration).
  if (fromVersion < 35) return migrateFlatToSaved(plan) as unknown as Record<string, unknown>;
  return plan;
}
