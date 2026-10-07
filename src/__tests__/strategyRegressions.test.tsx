/** @vitest-environment jsdom */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { samplePlan, type Plan } from '../schemas/plan';
import type { OptimizeResult } from '../engine/optimizer';
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
const { runOptimizer, commitOptimizerPlan, canReOptimize } = await import('../store/strategyActions');
const { optimizerKey } = await import('../engine/strategy/optimizerInput');
const { optimizerSettings } = await import('../engine/strategy/resultSettings');
const { policyStatus } = await import('../engine/policyStatus');
const { runProjection } = await import('../engine/projection');
const { exportPlanToJSON, importPlanFromJSON } = await import('../storage/exportImport');
const { default: StrategyChooser } = await import('../components/StrategyChooser');
const { default: ConversionDetail } = await import('../components/strategy/ConversionDetail');
const { default: StalePlanBanner } = await import('../components/StalePlanBanner');

const WINDOW: BlendWindow = { fromAge: 59, toAge: 98, pctTaxable: 0.5, pctTraditional: 0.3, pctRoth: 0.2 };

/** An optimizer result over `base` (conversions user-owned unless `ownsConv`). */
function optimized(base: Plan, ownsConv = false): Plan {
  const window = ownsConv ? { ...WINDOW, convAmt: 20_000 } : WINDOW;
  return {
    ...base,
    customPolicy: { windows: [window], source: 'optimizer', goal: 'max-end-balance', inputKey: optimizerKey(base), settings: optimizerSettings(base) },
    optimizedForGoal: 'max-end-balance', optimizedBy: 'optimizer',
  };
}
const withConv = (p: Plan, c: Partial<Plan['conversion']>): Plan => ({ ...p, conversion: { ...p.conversion, ...c } });
const saved = () => usePlanStore.getState().plan;
const load = (p: Plan) => {
  usePlanStore.setState({ plan: p });
  useOptimizerStore.setState({ pendingPlan: null, pendingGoal: null, robustnessPlan: null, result: null });
};

afterEach(cleanup);

describe('§6.6 strategy regressions', () => {
  it('e44613e: hand-editing the blend after optimizing drops the goal check mark and enables Re-optimize', () => {
    load(optimized(samplePlan(), true));
    usePlanStore.getState().setCustomPolicy({ windows: [WINDOW], source: 'manual' });
    expect(saved().optimizedForGoal).toBeUndefined();
    expect(canReOptimize(policyStatus(saved()), null, undefined)).toBe(true);
    render(<StrategyChooser />);
    fireEvent.click(screen.getByRole('button', { name: /Optimize for me/ }));
    expect(screen.getByRole('button', { name: /Max End Balance/ }).textContent).not.toContain('✓');
    expect((screen.getByRole('button', { name: /Re-optimize/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('ad952aa: under Set it myself, the conversion ceiling cannot exceed a bracket-fill withdrawal ceiling', () => {
    const p: Plan = { ...samplePlan(), withdrawalStrategy: 'bracketfill', withdrawalBracketCeiling: 100_800 };
    load(withConv(p, { optimize: false, mode: 'bracket-fill', bracketCeiling: 100_800 }));
    render(<StrategyChooser />);
    const select = screen.getByRole('combobox', { name: /Bracket-Fill conversion ceiling/ }) as HTMLSelectElement;
    const values = [...select.options].map((o) => Number(o.value)).filter(Boolean);
    expect(Math.max(...values)).toBe(100_800);
  });

  it('62364fd: applying an Earliest Retire result leaves it current (key taken from the applied plan)', async () => {
    load(samplePlan());
    const fake = async (plan: Plan) => ({
      goal: 'min-retirement-age',
      policy: { windows: [{ ...WINDOW, fromAge: 50 }], source: 'optimizer' },
      solvedRetirementAge: plan.personA.retirementAge - 2,
    }) as unknown as OptimizeResult;
    const out = await runOptimizer({ plan: saved(), goal: 'min-retirement-age' }, fake);
    expect(out.kind).toBe('pending');
    commitOptimizerPlan(useOptimizerStore.getState().pendingPlan!);
    expect(saved().personA.retirementAge).toBe(samplePlan().personA.retirementAge - 2);
    expect(policyStatus(saved())).toBe('fresh');
  });

  it('414e3a1: a manual schedule left over from Manual never fires once the optimizer owns conversions', () => {
    const p = samplePlan();
    const retire = p.personA.retirementAge;
    const leftover = withConv(p, { mode: 'manual', optimize: true, manualSchedule: { [retire - 4]: 200_000, [retire - 3]: 200_000 } });
    const rows = runProjection(optimized(leftover, true)).rows;
    expect(rows.filter((r) => r.ageA < retire).every((r) => r.rothConv === 0)).toBe(true);
  });

  it('fafdfe8: editing the conversion details from the Dashboard saves in place and keeps the charts', () => {
    const base = withConv(samplePlan(), { optimize: false, mode: 'bracket-fill' });
    const p = optimized(base);
    load(p);
    const before = runProjection(saved()).endTotalReal;
    render(<ConversionDetail unrestrictedCeiling />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '211400' } });
    expect(saved().conversion.bracketCeiling).toBe(211_400);
    expect(policyStatus(saved())).toBe('stale');
    expect(runProjection(saved()).endTotalReal).toBe(before);
  });

  it('a45303e: the Optimize for me sheet offers every bracket even with a bracket-fill withdrawal preset', () => {
    const p: Plan = { ...samplePlan(), withdrawalStrategy: 'bracketfill', withdrawalBracketCeiling: 100_800 };
    load(withConv(p, { optimize: false, mode: 'bracket-fill' }));
    render(<ConversionDetail unrestrictedCeiling />);
    expect((screen.getByRole('combobox') as HTMLSelectElement).options.length).toBe(5);
  });

  it('f14e80a: typing manual amounts while optimized keeps the charts and never gates the page', () => {
    const p = optimized(withConv(samplePlan(), { optimize: false, mode: 'manual', manualSchedule: { '65': 30_000 } }));
    load(p);
    const before = runProjection(saved()).endTotalReal;
    for (const v of [4, 40, 400, 40_000]) usePlanStore.getState().setConversion({ manualSchedule: { '65': 30_000, '66': v } });
    expect(runProjection(saved()).endTotalReal).toBe(before);
    render(<StalePlanBanner />);
    expect(screen.getByText(/inputs changed after the optimizer ran/i)).toBeTruthy();
  });

  it('2c8a4e5: editing manual amounts marks the result out of date so Re-optimize turns on', () => {
    load(optimized(withConv(samplePlan(), { optimize: false, mode: 'manual', manualSchedule: { '65': 30_000 } })));
    expect(policyStatus(saved())).toBe('fresh');
    usePlanStore.getState().setConversion({ manualSchedule: { '65': 35_000 } });
    expect(policyStatus(saved())).toBe('stale');
    expect(canReOptimize(policyStatus(saved()), 'max-end-balance', 'max-end-balance')).toBe(true);
  });

  it('2026-10-06 import fingerprint: a current export stays current after import despite reordered and retired fields', () => {
    const p = optimized(samplePlan(), true);
    const file = JSON.parse(exportPlanToJSON(p));
    file.plan = { ...file.plan, personA: { ...file.plan.personA, passingAge: 98 }, assumptions: { equityPct: 0.6, ...file.plan.assumptions } };
    expect(policyStatus(importPlanFromJSON(JSON.stringify(file)).plan!)).toBe('fresh');
  });

  it('2026-10-06 results-page gate: a stale result shows a banner with Re-optimize, never a redirect', () => {
    load({ ...optimized(samplePlan(), true), customPolicy: { ...optimized(samplePlan(), true).customPolicy!, inputKey: 'old' } });
    render(<StalePlanBanner />);
    expect(screen.getByRole('button', { name: /Re-optimize/ })).toBeTruthy();
    expect(screen.queryByText(/Back to Inputs/i)).toBeNull();
  });
});
