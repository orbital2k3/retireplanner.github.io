import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { PlanSchema } from '../../schemas/plan';
import { FIELD_REGISTRY, SAVED_FIELD_REGISTRY, classifyPath, classifySavedPath, type RegistryEntry } from './fieldRegistry';
import { SavedPlanSchema, type SavedPlan } from '../../schemas/savedPlan';
import { savedOptimizerKey, fromFlat } from './savedPlan';
import { PlanSchema as FlatSchema } from '../../schemas/plan';
import { optimizerKey } from './optimizerInput';
import { richPlan } from '../__testutil__/strategyPlans';

/** Strip optional/default/nullable wrappers to reach the underlying schema. */
function unwrap(schema: z.ZodType): z.ZodType {
  let s = schema;
  while (s instanceof z.ZodOptional || s instanceof z.ZodDefault || s instanceof z.ZodNullable) {
    s = s.unwrap() as z.ZodType;
  }
  return s;
}

/** Paths the schema has that the registry does not classify, and registry keys the schema lacks. */
function registryGaps(schema: z.ZodType, entry: RegistryEntry, path: string[] = []): string[] {
  if (typeof entry === 'string') return [];
  const s = unwrap(schema);
  if (!(s instanceof z.ZodObject)) return [`${path.join('.')}: registry expands a non-object`];
  const shape = s.shape as Record<string, z.ZodType>;
  const gaps: string[] = [];
  for (const key of Object.keys(shape)) {
    if (!(key in entry)) gaps.push(`${[...path, key].join('.')}: unclassified`);
    else gaps.push(...registryGaps(shape[key], entry[key], [...path, key]));
  }
  for (const key of Object.keys(entry)) {
    if (!(key in shape)) gaps.push(`${[...path, key].join('.')}: not in schema`);
  }
  return gaps;
}

type Leaf = { path: string[]; value: string | number | boolean };

function leaves(v: unknown, path: string[] = []): Leaf[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => leaves(x, [...path, String(i)]));
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => leaves(x, [...path, k]));
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return [{ path, value: v }];
  return [];
}

function setPath<T>(obj: T, path: string[], value: unknown): T {
  const copy = structuredClone(obj) as Record<string, unknown>;
  let cur = copy;
  for (const k of path.slice(0, -1)) cur = cur[k] as Record<string, unknown>;
  cur[path[path.length - 1]] = value;
  return copy as T;
}

const mutate = (v: Leaf['value']) => (typeof v === 'number' ? v + 1 : typeof v === 'boolean' ? !v : `${v}_x`);
const SHOULD_CHANGE_KEY = new Set(['fact', 'optimizerSetting']);

describe('§6.1 field registry exhaustiveness', () => {
  it('classifies every key in PlanSchema, recursively', () => {
    expect(registryGaps(PlanSchema, FIELD_REGISTRY)).toEqual([]);
  });

  it('rich fixture reaches every top-level registry key', () => {
    const plan = richPlan();
    const missing = Object.keys(FIELD_REGISTRY).filter((k) => plan[k as keyof typeof plan] === undefined);
    expect(missing).toEqual([]);
  });
});

describe('§6.1 key sensitivity follows the registry', () => {
  const base = richPlan();
  const baseKey = optimizerKey(base);
  const all = leaves(base);

  it('every leaf is classified', () => {
    expect(all.filter((l) => classifyPath(l.path) === undefined).map((l) => l.path.join('.'))).toEqual([]);
  });

  it('fact and optimizer-setting edits change optimizerKey', () => {
    const wrong = all
      .filter((l) => SHOULD_CHANGE_KEY.has(classifyPath(l.path)!))
      .filter((l) => optimizerKey(setPath(base, l.path, mutate(l.value))) === baseKey)
      .map((l) => `${l.path.join('.')} (${classifyPath(l.path)})`);
    expect(wrong).toEqual([]);
  });

  it('manual, output and display edits leave optimizerKey unchanged', () => {
    const wrong = all
      .filter((l) => !SHOULD_CHANGE_KEY.has(classifyPath(l.path)!))
      .filter((l) => optimizerKey(setPath(base, l.path, mutate(l.value))) !== baseKey)
      .map((l) => `${l.path.join('.')} (${classifyPath(l.path)})`);
    expect(wrong).toEqual([]);
  });

  it('removing an array element of a fact list changes optimizerKey', () => {
    for (const k of ['incomeStreams', 'expenseStreams', 'lumpSumEvents'] as const) {
      expect(optimizerKey({ ...base, [k]: base[k].slice(1) }), k).not.toBe(baseKey);
    }
  });
});

describe('§6.1 stored plan (Phase 2 slots)', () => {
  /** richPlan as stored, with the optimizer slot owning a manual schedule so every field counts. */
  const base: SavedPlan = (() => {
    const p = fromFlat(FlatSchema.parse(richPlan()), true);
    return { ...p, strategy: { ...p.strategy, optimizer: { ...p.strategy.optimizer, optimizerDecidesConversions: false } } };
  })();
  const baseKey = savedOptimizerKey(base);
  const all = leaves(base);

  it('classifies every key in SavedPlanSchema, recursively', () => {
    expect(registryGaps(SavedPlanSchema, SAVED_FIELD_REGISTRY)).toEqual([]);
  });

  it('every leaf is classified', () => {
    expect(all.filter((l) => classifySavedPath(l.path) === undefined).map((l) => l.path.join('.'))).toEqual([]);
  });

  it('fact and optimizer-setting edits change the key', () => {
    const wrong = all
      .filter((l) => SHOULD_CHANGE_KEY.has(classifySavedPath(l.path)!))
      .filter((l) => savedOptimizerKey(setPath(base, l.path, mutate(l.value))) === baseKey)
      .map((l) => l.path.join('.'));
    expect(wrong).toEqual([]);
  });

  it('manual, display and output edits leave the key unchanged', () => {
    const wrong = all
      .filter((l) => !SHOULD_CHANGE_KEY.has(classifySavedPath(l.path)!))
      .filter((l) => savedOptimizerKey(setPath(base, l.path, mutate(l.value))) !== baseKey)
      .map((l) => l.path.join('.'));
    expect(wrong).toEqual([]);
  });
});
