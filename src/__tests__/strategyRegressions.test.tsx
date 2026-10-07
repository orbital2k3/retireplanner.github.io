/** @vitest-environment jsdom */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { samplePlan } from '../schemas/plan';
import type { SavedPlan } from '../schemas/savedPlan';
import type { BlendWindow } from '../engine/blendPolicy';

/** §6.6 One test per past strategy-state fix, named by commit, reproducing the original failure. */

const mem = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, clear: () => mem.clear() },
});
vi.mock('../components/strategy/StrategyCustomizeSheet', () => ({ default: () => null }));

const { usePlanStore } = await import('../store/usePlanStore');
const { useOptimizerStore } = await import('../store/useOptimizerStore');
const { runOptimizer, commitOptimizerPlan } = await import('../store/strategyActions');
const { planStatus, resultStatus, canReOptimize, enginePlan } = await import('../engine/strategy/savedPlan');
const { runProjection } = await import('../engine/projection');
const { exportPlanToJSON, importPlanFromJSON } = await import('../storage/exportImport');
const { sampleSaved, optimizedSaved, staleSaved, fakeResult } = await import('../engine/__testutil__/savedPlans');
const { default: StrategyChooser } = await import('../components/StrategyChooser');
const { default: ConversionDetail } = await import('../components/strategy/ConversionDetail');
const { default: StalePlanBanner } = await import('../components/StalePlanBanner');

const WINDOW: BlendWindow = { fromAge: 59, toAge: 98, pctTaxable: 0.5, pctTraditional: 0.3, pctRoth: 0.2 };

const optimizerOwnsNot = (p: SavedPlan, conversion: Partial<SavedPlan['strategy']['optimizer']['conversion']>): SavedPlan =>
  ({ ...p, strategy: { ...p.strategy, optimizer: { ...p.strategy.optimizer, optimizerDecidesConversions: false, conversion: { ...p.strategy.optimizer.conversion, ...conversion } } } });
const saved = () => usePlanStore.getState().plan;
const end = (p: SavedPlan) => runProjection(enginePlan(p)).endTotalReal;
const load = (p: SavedPlan) => {
  usePlanStore.setState({ plan: p });
  useOptimizerStore.setState({ pendingPlan: null, pendingGoal: null, robustnessPlan: null, result: null });
};

afterEach(cleanup);

describe('§6.6 strategy regressions', () => {
  it('e44613e: hand-editing the blend after optimizing shows the blend and offers Re-optimize on return', () => {
    load(optimizedSaved(sampleSaved(), 'max-end-balance', [{ ...WINDOW, convAmt: 20_000 }]));
    usePlanStore.getState().editManual({ customWindows: [WINDOW] });
    usePlanStore.getState().setActiveStrategy('manual');
    expect(planStatus(saved())).toBe('hand-edited');
    render(<StrategyChooser />);
    expect(screen.getByRole('button', { name: /Custom blend/ }).textContent).toContain('✓');
    // The optimizer result is kept (Phase 2), so returning finds it current.
    fireEvent.click(screen.getByRole('button', { name: /Optimize for me/ }));
    expect(planStatus(saved())).toBe('fresh');
  });

  it('ad952aa: under Set it myself, the conversion ceiling cannot exceed a bracket-fill withdrawal ceiling', () => {
    const p = sampleSaved({ ...samplePlan(), withdrawalStrategy: 'bracketfill', withdrawalBracketCeiling: 100_800, conversion: { ...samplePlan().conversion, mode: 'bracket-fill', optimize: false, bracketCeiling: 100_800 } });
    load(p);
    render(<StrategyChooser />);
    const select = screen.getByRole('combobox', { name: /Bracket-Fill conversion ceiling/ }) as HTMLSelectElement;
    expect(Math.max(...[...select.options].map((o) => Number(o.value)).filter(Boolean))).toBe(100_800);
  });

  it('62364fd: applying an Earliest Retire result leaves it current (key taken from the applied plan)', async () => {
    load(sampleSaved());
    const out = await runOptimizer({ plan: saved(), goal: 'min-retirement-age' }, async (plan) =>
      fakeResult('min-retirement-age', [{ ...WINDOW, fromAge: 50 }], { solvedRetirementAge: plan.personA.retirementAge - 2 }));
    expect(out.kind).toBe('pending');
    commitOptimizerPlan(useOptimizerStore.getState().pendingPlan!);
    expect(saved().personA.retirementAge).toBe(samplePlan().personA.retirementAge - 2);
    expect(planStatus(saved())).toBe('fresh');
  });

  it('414e3a1: a remembered manual schedule never fires while the optimizer decides conversions', () => {
    const retire = samplePlan().personA.retirementAge;
    const p = optimizedSaved(sampleSaved(), 'max-end-balance', [{ ...WINDOW, convAmt: 20_000 }]);
    const leftover: SavedPlan = { ...p, strategy: { ...p.strategy, optimizer: { ...p.strategy.optimizer, conversion: { ...p.strategy.optimizer.conversion, mode: 'manual', manualSchedule: { [retire - 4]: 200_000, [retire - 3]: 200_000 } } } } };
    const rows = runProjection(enginePlan(leftover)).rows;
    expect(rows.filter((r) => r.ageA < retire).every((r) => r.rothConv === 0)).toBe(true);
    expect(resultStatus(leftover)).toBe('fresh');
  });

  it('fafdfe8: editing the conversion details from the Dashboard saves in place and keeps the charts', () => {
    load(optimizedSaved(optimizerOwnsNot(sampleSaved(), { mode: 'bracket-fill' })));
    const before = end(saved());
    render(<ConversionDetail slot="optimizer" />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '211400' } });
    expect(saved().strategy.optimizer.conversion.bracketCeiling).toBe(211_400);
    expect(planStatus(saved())).toBe('stale');
    expect(end(saved())).toBe(before);
  });

  it('a45303e: the Optimize for me sheet offers every bracket even with a bracket-fill withdrawal preset', () => {
    const p = sampleSaved({ ...samplePlan(), withdrawalStrategy: 'bracketfill', withdrawalBracketCeiling: 100_800 });
    load(optimizerOwnsNot(p, { mode: 'bracket-fill' }));
    render(<ConversionDetail slot="optimizer" />);
    expect((screen.getByRole('combobox') as HTMLSelectElement).options.length).toBe(5);
  });

  it('f14e80a: typing manual amounts while optimized keeps the charts and never gates the page', () => {
    load(optimizedSaved(optimizerOwnsNot(sampleSaved(), { mode: 'manual', manualSchedule: { '65': 30_000 } })));
    const before = end(saved());
    for (const v of [4, 40, 400, 40_000]) usePlanStore.getState().setConversion('optimizer', { manualSchedule: { '65': 30_000, '66': v } });
    expect(end(saved())).toBe(before);
    render(<StalePlanBanner />);
    expect(screen.getByText(/plan changed after the optimizer ran/i)).toBeTruthy();
  });

  it('2c8a4e5: editing manual amounts marks the result out of date so Re-optimize turns on', () => {
    load(optimizedSaved(optimizerOwnsNot(sampleSaved(), { mode: 'manual', manualSchedule: { '65': 30_000 } })));
    expect(planStatus(saved())).toBe('fresh');
    usePlanStore.getState().setConversion('optimizer', { manualSchedule: { '65': 35_000 } });
    expect(planStatus(saved())).toBe('stale');
    expect(canReOptimize(saved())).toBe(true);
  });

  it('2026-10-06 import fingerprint: a current export stays current after import despite reordered and retired fields', () => {
    const file = JSON.parse(exportPlanToJSON(optimizedSaved()));
    file.plan = { ...file.plan, personA: { ...file.plan.personA, passingAge: 98 }, assumptions: { equityPct: 0.6, ...file.plan.assumptions } };
    expect(planStatus(importPlanFromJSON(JSON.stringify(file)).plan!)).toBe('fresh');
  });

  it('2026-10-06 results-page gate: a stale result shows a banner with Re-optimize, never a redirect', () => {
    load(staleSaved());
    render(<StalePlanBanner />);
    expect(screen.getByRole('button', { name: /Re-optimize/ })).toBeTruthy();
    expect(screen.queryByText(/Back to Inputs/i)).toBeNull();
  });
});
