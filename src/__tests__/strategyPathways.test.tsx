/** @vitest-environment jsdom */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SavedPlan } from '../schemas/savedPlan';

/** §6.5 pathway gaps: P7 legacy target, P15 what-if and scenarios, P18 Reset, §6.2 real persist/rehydrate. */

const mem = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, clear: () => mem.clear() },
});
vi.mock('../components/strategy/StrategyCustomizeSheet', () => ({ default: () => null }));
vi.stubGlobal('__APP_VERSION__', 'test');
vi.stubGlobal('__BUILD_DATE__', 'test');
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;

const { usePlanStore } = await import('../store/usePlanStore');
const { useOptimizerStore } = await import('../store/useOptimizerStore');
const { useWhatIfStore, applyWhatIf } = await import('../store/useWhatIfStore');
const { planStatus, resultStatus, canReOptimize, enginePlan } = await import('../engine/strategy/savedPlan');
const { runProjection } = await import('../engine/projection');
const { PLAN_STORE_KEY } = await import('../store/planStoreVersion');
const { sampleSaved, optimizedSaved, staleSaved } = await import('../engine/__testutil__/savedPlans');
const { default: StalePlanBanner } = await import('../components/StalePlanBanner');
const { default: WhatIfBar } = await import('../components/WhatIfBar');
const { default: AppShell } = await import('../components/AppShell');
const { default: StrategyChooser } = await import('../components/StrategyChooser');
const { LegacyTargetInput } = await import('../components/inputs/LegacyTargetInput');

const saved = () => usePlanStore.getState().plan;
const end = (p: SavedPlan) => runProjection(enginePlan(p)).endTotalReal;
const load = (p: SavedPlan) => {
  usePlanStore.setState({ plan: p });
  useOptimizerStore.setState({ pendingPlan: null, pendingGoal: null, robustnessPlan: null, robustnessComparison: null, result: null });
  useWhatIfStore.getState().reset();
};

beforeEach(() => mem.clear());
afterEach(cleanup);

describe('P7 legacy target', () => {
  it('saves to the optimizer slot, marks the result out of date, and leaves the charts alone', () => {
    load(optimizedSaved(sampleSaved(), 'max-sustainable-spending'));
    const before = saved();
    render(<LegacyTargetInput />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '250000' } });

    expect(saved().strategy.optimizer.legacyTargetTaxAdjReal).toBe(250_000);
    expect(saved().strategy.manual).toEqual(before.strategy.manual);
    expect(planStatus(saved())).toBe('stale');
    expect(canReOptimize(saved())).toBe(true);
    expect(end(saved())).toBe(end(before));
    render(<StalePlanBanner />);
    expect(screen.getByText(/plan changed after the optimizer ran/i)).toBeTruthy();
  });

  it('under "Set it myself" the edit changes neither the charts nor the manual slot', () => {
    const p = optimizedSaved();
    load({ ...p, strategy: { ...p.strategy, active: 'manual' } });
    const before = saved();
    render(<LegacyTargetInput />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '100000' } });
    expect(end(saved())).toBe(end(before));
    expect(planStatus(saved())).toBe('none');
    expect(resultStatus(saved())).toBe('stale');
  });
});

describe('P15 what-if sliders and Save as scenario', () => {
  it('never mark the result out of date and never change the saved plan', () => {
    load(optimizedSaved());
    const before = structuredClone(saved());
    const scenarios = usePlanStore.getState().scenarios.length;
    useWhatIfStore.getState().setOverride('retirementAgeA', before.personA.retirementAge + 2);
    useWhatIfStore.getState().setOverride('returnRateDelta', -0.01);
    useWhatIfStore.getState().setOverride('spendingDollars', 150_000);
    render(<WhatIfBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Save as scenario' }));

    expect(usePlanStore.getState().scenarios).toHaveLength(scenarios + 1);
    expect(saved()).toEqual(before);
    expect(planStatus(saved())).toBe('fresh');
    expect(canReOptimize(saved())).toBe(false);
    // The overlay does change what the charts show.
    expect(runProjection(applyWhatIf(enginePlan(saved()), useWhatIfStore.getState())).endTotalReal).not.toBe(end(before));
    render(<StalePlanBanner />);
    expect(screen.queryByText(/plan changed after the optimizer ran/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(useWhatIfStore.getState().active).toBe(false);
    expect(saved()).toEqual(before);
  });
});

describe('P18 Reset', () => {
  it('leaves no result, "Set it myself" active, no banner, and no pending or preview result behind', () => {
    load(staleSaved());
    useOptimizerStore.setState({ pendingPlan: optimizedSaved(sampleSaved(), 'max-sustainable-spending'), pendingGoal: 'max-sustainable-spending', robustnessPlan: optimizedSaved() });
    useWhatIfStore.getState().setOverride('inflation', 0.05);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<MemoryRouter><AppShell /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    expect(planStatus(saved())).toBe('none');
    expect(saved().strategy.active).toBe('manual');
    expect(saved().strategy.result).toBeUndefined();
    expect(useOptimizerStore.getState()).toMatchObject({ pendingPlan: null, pendingGoal: null, robustnessPlan: null });
    expect(useWhatIfStore.getState().active).toBe(false);
    cleanup();
    render(<><StalePlanBanner /><StrategyChooser /></>);
    expect(screen.queryByText(/plan changed after the optimizer ran/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Optimize for me/ }));
    expect((screen.getByRole('button', { name: /Re-optimize|Build/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('§6.2 real zustand persist → rehydrate', () => {
  const cases: Array<[string, () => SavedPlan, ReturnType<typeof planStatus>]> = [
    ['no result', () => sampleSaved(), 'none'],
    ['fresh result', () => optimizedSaved(), 'fresh'],
    ['stale result', () => staleSaved(), 'stale'],
    ['result kept under "Set it myself"', () => { const p = optimizedSaved(); return { ...p, strategy: { ...p.strategy, active: 'manual' } }; }, 'none'],
  ];
  for (const [name, make, status] of cases) {
    it(`${name}: a fresh store load restores the plan and its status`, async () => {
      const plan = make();
      usePlanStore.setState({ plan });
      expect(mem.get(PLAN_STORE_KEY)).toBeTruthy();

      vi.resetModules();
      const { usePlanStore: reloaded } = await import('../store/usePlanStore');
      const { planStatus: ps, resultStatus: rs } = await import('../engine/strategy/savedPlan');
      const back = reloaded.getState().plan;
      expect(back).toEqual(JSON.parse(JSON.stringify(plan)));
      expect(ps(back)).toBe(status);
      expect(rs(back)).toBe(resultStatus(plan));
    });
  }
});
