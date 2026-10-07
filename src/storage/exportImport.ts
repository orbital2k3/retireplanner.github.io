import { SavedPlanSchema, type SavedPlan } from '../schemas/savedPlan';
import { PlanSchema } from '../schemas/plan';
import { migrateFlatFields, wasLegacyFresh, wasV34Fresh } from '../store/planMigrations';
import { savedOptimizerKey, fromFlat } from '../engine/strategy/savedPlan';
import { PLAN_STORE_VERSION } from '../store/planStoreVersion';

export interface ExportPayload {
  app: 'retirement-optimizer';
  version: 1;
  exportedAt: string;
  /** Plan store version that wrote the file. Absent on files exported before v34. */
  planVersion?: number;
  plan: SavedPlan;
}

export function exportPlanToJSON(plan: SavedPlan): string {
  const payload: ExportPayload = {
    app: 'retirement-optimizer',
    version: 1,
    exportedAt: new Date().toISOString(),
    planVersion: PLAN_STORE_VERSION,
    plan,
  };
  return JSON.stringify(payload, null, 2);
}

export function downloadPlan(plan: SavedPlan, filename = 'retirement-optimizer-plan.json'): void {
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
  plan?: SavedPlan;
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
  const issues = (e: { issues: { path: PropertyKey[]; message: string }[] }) =>
    ({ ok: false, error: e.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });

  // v35+ files store strategy slots.
  if ('strategy' in rawPlan) {
    const r = rawPlan.strategy as { result?: { inputKey?: unknown } } | undefined;
    // Judge the stored result as the file stores the plan, before parsing reshapes it.
    const wasFresh = typeof r?.result?.inputKey === 'string' && r.result.inputKey === savedOptimizerKey(rawPlan as unknown as SavedPlan);
    const result = SavedPlanSchema.safeParse(rawPlan);
    if (!result.success) return issues(result.error);
    const plan = result.data;
    if (wasFresh && plan.strategy.result) plan.strategy.result.inputKey = savedOptimizerKey(plan);
    return { ok: true, plan };
  }

  // Older files store the flat plan. Judge freshness as stored, before migrations reshape it.
  const wasFresh = wasLegacyFresh(rawPlan) || wasV34Fresh(rawPlan);
  // Same field migrations as the store. Files before v34 carry no version, so all steps run;
  // each is guarded by shape, so a step that already applied leaves the plan alone.
  migrateFlatFields(rawPlan, typeof planVersion === 'number' ? planVersion : 0);
  const flat = PlanSchema.safeParse(rawPlan);
  if (!flat.success) return issues(flat.error);
  return { ok: true, plan: fromFlat(flat.data, wasFresh) };
}

export async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsText(file);
  });
}
