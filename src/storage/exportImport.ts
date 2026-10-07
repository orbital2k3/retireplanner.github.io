import type { Plan } from '../schemas/plan';
import { PlanSchema } from '../schemas/plan';
import { migratePlanToV24, migratePlanToV25, wasLegacyFresh } from '../store/planMigrations';
import { optimizerKey } from '../engine/strategy/optimizerInput';
import { PLAN_STORE_VERSION } from '../store/planStoreVersion';

export interface ExportPayload {
  app: 'retirement-optimizer';
  version: 1;
  exportedAt: string;
  /** Plan store version that wrote the file. Absent on files exported before v34. */
  planVersion?: number;
  plan: Plan;
}

export function exportPlanToJSON(plan: Plan): string {
  const payload: ExportPayload = {
    app: 'retirement-optimizer',
    version: 1,
    exportedAt: new Date().toISOString(),
    planVersion: PLAN_STORE_VERSION,
    plan,
  };
  return JSON.stringify(payload, null, 2);
}

export function downloadPlan(plan: Plan, filename = 'retirement-optimizer-plan.json'): void {
  const json = exportPlanToJSON(plan);
  const a = document.createElement('a');
  a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(json);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export interface ImportResult {
  ok: boolean;
  plan?: Plan;
  error?: string;
}

export function importPlanFromJSON(raw: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'File is not valid JSON.' };
  }
  // Support both wrapped (with metadata) and raw plan shapes
  const candidate = (parsed as { plan?: unknown }).plan ?? parsed;
  const planVersion = (parsed as { planVersion?: unknown }).planVersion;
  if (!candidate || typeof candidate !== 'object') return { ok: false, error: 'File does not contain a plan.' };
  const rawPlan = candidate as Record<string, unknown>;
  // Judge the stored result as the file stores the plan, before migrations or parsing reshape it.
  const policy = rawPlan.customPolicy as { inputKey?: unknown } | undefined;
  const wasFresh = wasLegacyFresh(rawPlan) || (typeof policy?.inputKey === 'string' && policy.inputKey === optimizerKey(rawPlan as unknown as Plan));
  // Old files need the field migrations. Files from v34 on are already current, and re-running
  // v25 on them would rewrite streams that happen to end at a plan-through age.
  if (typeof planVersion !== 'number' || planVersion < 25) {
    migratePlanToV24(rawPlan);
    migratePlanToV25(rawPlan);
  }
  const result = PlanSchema.safeParse(rawPlan);
  if (!result.success) {
    return { ok: false, error: result.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  }
  const plan = result.data;
  // Keep a result that was current in the file current after import.
  if (wasFresh && plan.customPolicy) plan.customPolicy = { ...plan.customPolicy, inputKey: optimizerKey(plan) };
  return { ok: true, plan };
}

export async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsText(file);
  });
}
