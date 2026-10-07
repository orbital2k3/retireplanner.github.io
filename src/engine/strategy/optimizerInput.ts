import { z } from 'zod';
import { PlanSchema, defaultPlan, type Plan, type ConversionParams } from '../../schemas/plan';
import { FIELD_REGISTRY, type RegistryEntry } from './fieldRegistry';

/** True when the optimizer searches conversion amounts itself (mode and params are ignored). */
export const optimizerOwnsConversions = (c: ConversionParams): boolean => c.optimize ?? true;

/** Drops zero entries: the engine treats 0 and a missing age the same. */
function nonZeroSchedule(s: Record<string, number> | undefined): Record<string, number> {
  return Object.fromEntries(Object.entries(s ?? {}).filter(([, v]) => v !== 0));
}

/** Conversion settings as the optimizer reads them. When the optimizer owns conversions, the
 *  leftover mode, window and manual schedule are reset so none of them can fire in any year. */
function optimizerConversion(c: ConversionParams): ConversionParams {
  if (optimizerOwnsConversions(c)) return { ...defaultPlan().conversion, optimize: true };
  return { ...c, manualSchedule: nonZeroSchedule(c.manualSchedule) };
}

/** Exactly the plan the optimizer should see: facts and optimizer settings as they are,
 *  "Set it myself" settings reset to neutral defaults, outputs removed. An optimizer-authored
 *  policy is kept as a warm-start seed; a hand-built blend never is. */
export function optimizerInput(plan: Plan): Plan {
  const neutral = defaultPlan() as Record<string, unknown>;
  const out: Record<string, unknown> = { ...plan };
  for (const [key, cls] of Object.entries(FIELD_REGISTRY)) {
    if (cls === 'manualSetting') out[key] = neutral[key];
    else if (cls === 'output') out[key] = undefined;
  }
  out.customPolicy = plan.customPolicy?.source === 'optimizer' ? plan.customPolicy : undefined;
  out.conversion = optimizerConversion(plan.conversion);
  return out as Plan;
}

function unwrap(schema: z.ZodType): z.ZodType {
  let s = schema;
  while (s instanceof z.ZodOptional || s instanceof z.ZodDefault || s instanceof z.ZodNullable) {
    s = s.unwrap() as z.ZodType;
  }
  return s;
}

/** Keeps only the keys the schema knows (retired fields on old saved plans drop out). */
function prune(schema: z.ZodType, value: unknown): unknown {
  if (value === undefined || value === null) return value;
  const s = unwrap(schema);
  if (s instanceof z.ZodObject && typeof value === 'object') {
    const shape = s.shape as Record<string, z.ZodType>;
    const v = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(shape).filter((k) => k in v).map((k) => [k, prune(shape[k], v[k])]));
  }
  if (s instanceof z.ZodArray && Array.isArray(value)) return value.map((x) => prune(s.element as z.ZodType, x));
  return value;
}

/** The parts of the plan the key covers: fact and optimizerSetting fields only. */
function keyView(schema: z.ZodType, entry: RegistryEntry, value: unknown): unknown {
  if (typeof entry === 'string') {
    return entry === 'fact' || entry === 'optimizerSetting' ? prune(schema, value) : undefined;
  }
  if (!value || typeof value !== 'object') return value;
  const shape = (unwrap(schema) as z.ZodObject).shape as Record<string, z.ZodType>;
  const v = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(entry).map((k) => [k, keyView(shape[k], entry[k], v[k])]));
}

/** JSON with object keys sorted at every depth and undefined values dropped. */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      return Object.fromEntries(Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
    }
    return v;
  });
}

/** Stable fingerprint of what the optimizer receives. A stored result is out of date exactly
 *  when its inputKey differs from optimizerKey(plan). The manual schedule counts only when
 *  conversions are user-owned (optimizerInput clears it otherwise). */
export function optimizerKey(plan: Plan): string {
  const input = optimizerInput(plan);
  const shape = PlanSchema.shape as Record<string, z.ZodType>;
  const view = Object.fromEntries(
    Object.entries(FIELD_REGISTRY).map(([k, entry]) => [k, keyView(shape[k], entry, (input as Record<string, unknown>)[k])]),
  );
  return canonicalStringify(view);
}
