import type { Plan } from '../schemas/plan';
import { PlanSchema } from '../schemas/plan';
import { migratePlanToV24, migratePlanToV25 } from '../store/planMigrations';
import { planInputKey } from '../engine/planInputKey';

export interface ExportPayload {
  app: 'retirement-optimizer';
  version: 1;
  exportedAt: string;
  plan: Plan;
}

export function exportPlanToJSON(plan: Plan): string {
  const payload: ExportPayload = {
    app: 'retirement-optimizer',
    version: 1,
    exportedAt: new Date().toISOString(),
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
  // Fingerprint as the file stores the plan, before migrations or parsing reshape it.
  const fileKey = candidate && typeof candidate === 'object' ? planInputKey(candidate as Plan) : null;
  // Run all migrations before Zod parsing (safe to apply to any version — each is idempotent).
  if (candidate && typeof candidate === 'object') {
    migratePlanToV24(candidate as Record<string, unknown>);
    migratePlanToV25(candidate as Record<string, unknown>);
  }
  const result = PlanSchema.safeParse(candidate);
  if (!result.success) {
    return { ok: false, error: result.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  }
  const plan = result.data;
  // Parsing reorders keys and drops retired fields, which changes the fingerprint string. Keep a
  // policy that was current in the file current after import.
  const policy = plan.customPolicy;
  if (policy?.inputKey != null && policy.inputKey === fileKey) {
    plan.customPolicy = { ...policy, inputKey: planInputKey(plan) };
  }
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
