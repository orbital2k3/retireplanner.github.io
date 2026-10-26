import { expect, type Page } from '@playwright/test';
import { planA_simple, planQ_qcdGiver, planR_hsaEarlyRetiree, planS_tipsLadder } from '../src/engine/__golden/plans';
import { optimizeStrategy } from '../src/engine/optimizer';
import { fromFlat, optimizerView, applyResult } from '../src/engine/strategy/savedPlan';
import { PLAN_STORE_KEY, PLAN_STORE_VERSION } from '../src/store/planStoreVersion';
import type { Plan } from '../src/schemas/plan';
import type { SavedPlan } from '../src/schemas/savedPlan';

export const BUILD_OPTIONS = { useNelderMead: true, thorough: true } as const;

let optimizedA: SavedPlan | undefined;
let optimizedABracketFill: SavedPlan | undefined;

/** A flat plan as saved by the app (no result, "Set it myself" active). */
export const saved = (flat: Plan): SavedPlan => fromFlat(flat, false);

/** What Build Plan saves: the optimizer run on the "Optimize for me" view of the plan. */
function buildPlan(flat: Plan): SavedPlan {
  const base = saved(flat);
  return applyResult(base, optimizeStrategy(optimizerView(base), base.strategy.optimizer.goal, BUILD_OPTIONS));
}

/** planA_simple after a max-end-balance optimizer run with the UI's options: the plan Build Plan would save. */
export function optimizedPlanA(): SavedPlan {
  optimizedA ??= buildPlan(planA_simple());
  return structuredClone(optimizedA);
}

/** planA_simple optimized with bracket-fill conversions (ages 63-73) chosen under Optimize for me. */
export function optimizedPlanABracketFill(): SavedPlan {
  if (!optimizedABracketFill) {
    const base = planA_simple();
    optimizedABracketFill = buildPlan({ ...base, conversion: { ...base.conversion, mode: 'bracket-fill', optimize: false, startAge: 63, endAge: 73 } });
  }
  return structuredClone(optimizedABracketFill);
}

/** A couple in their 70s whose giving is paid as QCDs (planQ_qcdGiver). */
export const qcdGiver = (): SavedPlan => saved(planQ_qcdGiver());

/** A 55-year-old early retiree on an ACA plan with a $150k HSA and retirement contributions (planR_hsaEarlyRetiree). */
export const hsaRetiree = (): SavedPlan => saved(planR_hsaEarlyRetiree());

/** A retired couple (60 and 58) with a TIPS ladder in taxable, IRA and Roth accounts (planS_tipsLadder). */
export const tipsRetiree = (): SavedPlan => saved(planS_tipsLadder());

/** Seeds the persisted plan store once per tab, so later reloads keep changes made in the UI. */
export async function seedPlan(page: Page, plan: SavedPlan, displayMode: 'real' | 'nominal' = 'real', version: number = PLAN_STORE_VERSION) {
  const value = JSON.stringify({ state: { plan, displayMode, setupDismissed: true }, version });
  await page.addInitScript(({ key, value }) => {
    if (sessionStorage.getItem('e2e-seeded')) return;
    localStorage.clear();
    localStorage.setItem(key, value);
    sessionStorage.setItem('e2e-seeded', '1');
  }, { key: PLAN_STORE_KEY, value });
}

/** Value of a Plan Summary hero stat on the Dashboard, e.g. "Gross End Balance". */
export function heroStat(page: Page, label: string) {
  return page.getByText(label, { exact: true }).locator('xpath=following-sibling::div[1]');
}

export async function gotoDashboard(page: Page) {
  await page.goto('/#/dashboard');
  await expect(page.getByText('Plan Summary', { exact: true })).toBeVisible();
}
