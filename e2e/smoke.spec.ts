import { test, expect, type Page } from '@playwright/test';
import { planA_simple } from '../src/engine/__golden/plans';
import { runProjection } from '../src/engine/projection';
import { enginePlan } from '../src/engine/strategy/savedPlan';
import { fmtM } from '../src/lib/format';
import { PLAN_STORE_KEY } from '../src/store/planStoreVersion';
import type { SavedPlan } from '../src/schemas/savedPlan';
import { optimizedPlanA, optimizedPlanABracketFill, seedPlan, heroStat, gotoDashboard, saved } from './fixtures';
import { exportPlanToJSON } from '../src/storage/exportImport';

// The UI optimizer runs in a Web Worker; max-spending on planA takes ~5s in Node.
const OPTIMIZE_TIMEOUT = 60_000;

async function storedPlan(page: Page): Promise<SavedPlan> {
  const raw = await page.evaluate((key) => localStorage.getItem(key), PLAN_STORE_KEY);
  return JSON.parse(raw!).state.plan;
}

const withGoal = (p: SavedPlan, goal: SavedPlan['strategy']['optimizer']['goal']): SavedPlan =>
  ({ ...p, strategy: { ...p.strategy, optimizer: { ...p.strategy.optimizer, goal } } });

const goalBadge = (page: Page, label: string) => page.locator('.badge', { hasText: `✓ ${label}` });
const pendingBanner = (page: Page) => page.getByText(/result ready/);
const staleBanner = (page: Page) => page.getByText('Your plan changed after the optimizer ran.');

async function reoptimizeFor(page: Page, goal: string) {
  await page.getByRole('button', { name: goal, exact: true }).click();
  await page.getByRole('button', { name: /^↗ Re-optimize/ }).click();
  await expect(pendingBanner(page)).toBeVisible({ timeout: OPTIMIZE_TIMEOUT });
}

test('main pages render without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await seedPlan(page, optimizedPlanA());

  const pages: Array<[string, string]> = [
    ['inputs', 'Personal Details'],
    ['dashboard', 'Plan Summary'],
    ['projections', 'Year-by-Year Detail'],
    ['taxes', 'Your Projected Tax Trajectory'],
    ['montecarlo', 'Historical Sequence Analysis'],
  ];
  for (const [route, marker] of pages) {
    await page.goto(`/#/${route}`);
    await expect(page.getByText(marker, { exact: true }).first(), route).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('Build Plan (max end balance) saves the plan and opens the Dashboard with no pending banner', async ({ page }) => {
  await seedPlan(page, saved(planA_simple()));
  await page.goto('/#/inputs');
  await page.getByRole('button', { name: 'Build Plan →' }).click();
  await page.waitForURL('**/#/dashboard', { timeout: OPTIMIZE_TIMEOUT });

  await expect(goalBadge(page, 'Max End Balance')).toBeVisible();
  await expect(pendingBanner(page)).toHaveCount(0);
  await expect(page.getByText('explain optimization rationale →')).toBeVisible();
  // The worker run must match the Node run that seeds the other tests.
  await expect(heroStat(page, 'Gross End Balance')).toHaveText(fmtM(runProjection(enginePlan(optimizedPlanA())).endTotalReal));
  expect((await storedPlan(page)).strategy.result?.goal).toBe('max-end-balance');
});

test('Re-optimize for max spending, then Apply saves the new strategy', async ({ page }) => {
  await seedPlan(page, optimizedPlanA());
  await gotoDashboard(page);
  await reoptimizeFor(page, 'Max Spending');

  await page.getByRole('button', { name: 'Apply to Plan' }).click();
  await expect(pendingBanner(page)).toHaveCount(0);
  await expect(goalBadge(page, 'Max Spending')).toBeVisible();
  expect((await storedPlan(page)).strategy.result?.goal).toBe('max-sustainable-spending');
});

test('Re-optimize for max spending, then Discard leaves the saved plan unchanged', async ({ page }) => {
  const plan = optimizedPlanA();
  await seedPlan(page, plan);
  await gotoDashboard(page);
  const endBalance = fmtM(runProjection(enginePlan(plan)).endTotalReal);
  await expect(heroStat(page, 'Gross End Balance')).toHaveText(endBalance);
  await reoptimizeFor(page, 'Max Spending');

  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(pendingBanner(page)).toHaveCount(0);
  await expect(goalBadge(page, 'Max End Balance')).toBeVisible();
  await expect(heroStat(page, 'Gross End Balance')).toHaveText(endBalance);
  // The goal pill is a saved setting; Discard / reload drops only the result.
  expect(await storedPlan(page)).toEqual(withGoal(plan, 'max-sustainable-spending'));
});

test("Today's $ / Nominal $ toggle switches the end balance", async ({ page }) => {
  const plan = optimizedPlanA();
  const proj = runProjection(enginePlan(plan));
  expect(fmtM(proj.endTotalNominal)).not.toBe(fmtM(proj.endTotalReal));
  await seedPlan(page, plan);
  await gotoDashboard(page);

  await expect(heroStat(page, 'Gross End Balance')).toHaveText(fmtM(proj.endTotalReal));
  await page.getByRole('radio', { name: 'Nominal $' }).click();
  await expect(heroStat(page, 'Gross End Balance')).toHaveText(fmtM(proj.endTotalNominal));
  await page.getByRole('radio', { name: "Today's $" }).click();
  await expect(heroStat(page, 'Gross End Balance')).toHaveText(fmtM(proj.endTotalReal));
});

async function addIncomeStream(page: Page, amount: number) {
  await page.goto('/#/inputs');
  await page.getByRole('button', { name: '+ Add income stream' }).click();
  const amountInput = page.locator('.income-row').last().locator('.input-prefix-wrap input');
  await amountInput.fill(String(amount));
  await amountInput.blur();
}

test('an income change on Inputs updates the Plan Summary', async ({ page }) => {
  // No optimizer policy, so editing inputs does not gate the Dashboard.
  const base = saved(planA_simple());
  await seedPlan(page, base);
  await addIncomeStream(page, 60_000);
  await page.getByRole('link', { name: 'Dashboard' }).click();

  const edited = await storedPlan(page);
  expect(edited.incomeStreams).toHaveLength(1);
  expect(edited.incomeStreams[0].annualAmount).toBe(60_000);
  const expected = fmtM(runProjection(enginePlan(edited)).endTotalReal);
  expect(expected).not.toBe(fmtM(runProjection(enginePlan(base)).endTotalReal));
  await expect(heroStat(page, 'Gross End Balance')).toHaveText(expected);
});

test('editing an input after optimizing keeps the results pages open with an out-of-date banner', async ({ page }) => {
  await seedPlan(page, optimizedPlanA());
  await addIncomeStream(page, 60_000);
  await page.getByRole('link', { name: 'Dashboard' }).click();

  await expect(staleBanner(page)).toBeVisible();
  await expect(page.getByText('Plan Summary', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Projections' }).click();
  await expect(staleBanner(page)).toBeVisible();
  await expect(page.locator('tbody tr').first()).toBeVisible();
});


test('P5 editing the age window on the Dashboard stays on the page, keeps the charts, and Re-optimize clears the banner', async ({ page }) => {
  const plan = optimizedPlanABracketFill();
  await seedPlan(page, plan);
  await gotoDashboard(page);
  const endBalance = fmtM(runProjection(enginePlan(plan)).endTotalReal);
  await expect(heroStat(page, 'Gross End Balance')).toHaveText(endBalance);

  await page.getByRole('button', { name: 'Edit age window →' }).click();
  const startAge = page.locator('.form-group', { hasText: 'Start Age' }).locator('input');
  await startAge.fill('66');
  await startAge.blur();
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  await expect(page).toHaveURL(/#\/dashboard/);
  expect((await storedPlan(page)).strategy.optimizer.conversion.startAge).toBe(66);
  await expect(staleBanner(page)).toBeVisible();
  await expect(heroStat(page, 'Gross End Balance')).toHaveText(endBalance);
  await page.getByRole('button', { name: /^↗ Re-optimize/ }).click();
  await expect(staleBanner(page)).toHaveCount(0, { timeout: OPTIMIZE_TIMEOUT });
});

test('P9 Set it myself changes the charts at once; switching back restores the optimizer result', async ({ page }) => {
  const plan = optimizedPlanA();
  await seedPlan(page, plan);
  await gotoDashboard(page);
  const optimizedEnd = fmtM(runProjection(enginePlan(plan)).endTotalReal);
  await expect(heroStat(page, 'Gross End Balance')).toHaveText(optimizedEnd);

  await page.getByRole('button', { name: /Set it myself/ }).click();
  await page.getByRole('button', { name: /Roth-first/ }).click();
  const manual = await storedPlan(page);
  expect(manual.strategy).toMatchObject({ active: 'manual', manual: { preset: 'rothfirst' } });
  expect(manual.strategy.result).toEqual(plan.strategy.result);
  await expect(heroStat(page, 'Gross End Balance')).toHaveText(fmtM(runProjection(enginePlan(manual)).endTotalReal));

  await page.getByRole('button', { name: /Optimize for me/ }).click();
  await expect(heroStat(page, 'Gross End Balance')).toHaveText(optimizedEnd);
  await expect(goalBadge(page, 'Max End Balance')).toBeVisible();
  await expect(staleBanner(page)).toHaveCount(0);
});

test('P11 an input change shows the banner on every results page; Re-optimize from one clears it everywhere', async ({ page }) => {
  await seedPlan(page, optimizedPlanA());
  await addIncomeStream(page, 60_000);
  for (const name of ['Dashboard', 'Projections', 'Taxes', 'Monte Carlo']) {
    await page.getByRole('link', { name }).click();
    await expect(staleBanner(page), name).toBeVisible();
  }
  await page.getByRole('button', { name: 'Re-optimize', exact: true }).click();
  await expect(staleBanner(page)).toHaveCount(0, { timeout: OPTIMIZE_TIMEOUT });
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(staleBanner(page)).toHaveCount(0);
});

test('P12 a pending Max Spending result does not survive a reload', async ({ page }) => {
  const plan = optimizedPlanA();
  await seedPlan(page, plan);
  await gotoDashboard(page);
  await reoptimizeFor(page, 'Max Spending');
  await page.reload();
  await expect(page.getByText('Plan Summary', { exact: true })).toBeVisible();
  await expect(pendingBanner(page)).toHaveCount(0);
  // The goal pill is a saved setting; Discard / reload drops only the result.
  expect(await storedPlan(page)).toEqual(withGoal(plan, 'max-sustainable-spending'));
});

test('P16 importing a fresh export shows no out-of-date banner', async ({ page }) => {
  await seedPlan(page, saved(planA_simple()));
  await gotoDashboard(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: 'plan.json', mimeType: 'application/json', buffer: Buffer.from(exportPlanToJSON(optimizedPlanA())),
  });
  await expect(goalBadge(page, 'Max End Balance')).toBeVisible();
  await expect(staleBanner(page)).toHaveCount(0);
});

for (const [label, goal] of [['Max Spending', 'max-sustainable-spending'], ['Earliest Retire', 'min-retirement-age']] as const) {
  test(`P1 Build Plan for ${label} opens the Dashboard with a pending result; Apply saves it`, async ({ page }) => {
    test.setTimeout(2 * OPTIMIZE_TIMEOUT);
    await seedPlan(page, saved(planA_simple()));
    await page.goto('/#/inputs');
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.getByRole('button', { name: 'Build Plan →' }).click();
    await page.waitForURL('**/#/dashboard', { timeout: OPTIMIZE_TIMEOUT });

    await expect(page.getByText(`${label} result ready`)).toBeVisible();
    const before = await storedPlan(page);
    expect(before.strategy.result).toBeUndefined();
    expect(before.strategy.optimizer.goal).toBe(goal);

    await page.getByRole('button', { name: 'Apply to Plan' }).click();
    await expect(pendingBanner(page)).toHaveCount(0);
    await expect(goalBadge(page, label)).toBeVisible();
    await expect(staleBanner(page)).toHaveCount(0);
    expect((await storedPlan(page)).strategy).toMatchObject({ active: 'optimizer', result: { goal } });
  });
}

test('P18 Reset after a pending result leaves no result, no pending result and no banner', async ({ page }) => {
  await seedPlan(page, optimizedPlanA());
  await gotoDashboard(page);
  await reoptimizeFor(page, 'Max Spending');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Reset', exact: true }).first().click();
  await page.waitForURL('**/#/inputs');

  const plan = await storedPlan(page);
  expect(plan.strategy.result).toBeUndefined();
  expect(plan.strategy.active).toBe('manual');
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.getByText('Plan Summary', { exact: true })).toBeVisible();
  await expect(pendingBanner(page)).toHaveCount(0);
  await expect(staleBanner(page)).toHaveCount(0);
});
