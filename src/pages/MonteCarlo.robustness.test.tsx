/** @vitest-environment jsdom */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import type { Plan } from '../schemas/plan';
import type { SavedPlan } from '../schemas/savedPlan';
import type { MonteCarloOptions } from '../engine/monteCarlo';

/** P14: Monte Carlo robustness preview → Apply sets the provenance badge → the next goal run resets it. */

const mem = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, clear: () => mem.clear() },
});
vi.mock('../components/charts/MonteCarloFan', () => ({ default: () => null }));
vi.mock('../components/charts/HistoricalCohortChart', () => ({ default: () => null }));

const { runMonteCarlo } = await import('../engine/monteCarlo');
const { fakeResult, optimizedSaved, sampleSaved } = await import('../engine/__testutil__/savedPlans');

// The robustness run scores "before" low and every later simulation high, so the gain is worth applying.
let optimized = false;
const worker = {
  monteCarlo: vi.fn(async (plan: Plan, opts: MonteCarloOptions) => ({ ...runMonteCarlo(plan, { ...opts, trials: 40 }), successRate: optimized ? 0.92 : 0.6 })),
  historicalSweep: vi.fn(),
  optimize: vi.fn(async (_plan: Plan, goal: Parameters<typeof fakeResult>[0]) => { optimized = true; return fakeResult(goal, [{ fromAge: 55, toAge: 98, pctTaxable: 0.2, pctTraditional: 0.6, pctRoth: 0.2 }]); }),
};
vi.mock('../engine/workerClient', () => ({ getEngineWorker: () => worker, disposeEngineWorker: () => {} }));

const { usePlanStore } = await import('../store/usePlanStore');
const { useOptimizerStore } = await import('../store/useOptimizerStore');
const { runOptimizer } = await import('../store/strategyActions');
const { planStatus } = await import('../engine/strategy/savedPlan');
const { default: MonteCarlo } = await import('./MonteCarlo');

const saved = () => usePlanStore.getState().plan;
/** The provenance badge next to Run Simulation. */
const tunedBadge = () => [...document.querySelectorAll('.badge')].find((b) => /Monte Carlo tuned/.test(b.textContent ?? '')) ?? null;

async function previewRobustness() {
  render(<MonteCarlo />);
  fireEvent.click(screen.getByRole('button', { name: /Run Simulation/ }));
  const optimizeBtn = screen.getByRole('button', { name: /Optimize for Robustness/ });
  await waitFor(() => expect((optimizeBtn as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(optimizeBtn);
  await screen.findByRole('button', { name: 'Apply to Plan' });
}

beforeEach(() => {
  optimized = false;
  usePlanStore.setState({ plan: optimizedSaved(sampleSaved()) });
  useOptimizerStore.setState({ pendingPlan: null, pendingGoal: null, result: null });
  useOptimizerStore.getState().clearMcResults();
});
afterEach(cleanup);

describe('P14 Monte Carlo robustness', () => {
  it('Apply saves the preview with Monte Carlo provenance; the next goal run resets it', async () => {
    await previewRobustness();
    expect(saved().strategy.result?.optimizedBy).toBe('optimizer');
    expect(tunedBadge()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Apply to Plan' }));
    expect(saved().strategy.result).toMatchObject({ optimizedBy: 'monte-carlo', mcTuning: { before: 0.6, after: 0.92 } });
    expect(planStatus(saved())).toBe('fresh');
    expect(useOptimizerStore.getState().robustnessPlan).toBeNull();
    expect(tunedBadge()).toBeTruthy();

    await runOptimizer({ plan: saved(), goal: 'max-end-balance' });
    expect(saved().strategy.result?.optimizedBy).toBe('optimizer');
    expect(saved().strategy.result?.mcTuning).toBeUndefined();
    await waitFor(() => expect(tunedBadge()).toBeNull());
  });

  it('Discard leaves the saved plan unchanged', async () => {
    const before = saved();
    await previewRobustness();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(saved()).toBe(before as SavedPlan);
    expect(useOptimizerStore.getState().robustnessPlan).toBeNull();
    expect(screen.queryByRole('button', { name: 'Apply to Plan' })).toBeNull();
  });
});
