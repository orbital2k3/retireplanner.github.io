/** @vitest-environment jsdom */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { Plan } from '../schemas/plan';
import type { MonteCarloOptions } from '../engine/monteCarlo';

/** The with/without-ladder comparison: a worker error is caught and shown, never an unhandled rejection. */

const mem = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, clear: () => mem.clear() },
});
vi.mock('../components/charts/MonteCarloFan', () => ({ default: () => null }));
vi.mock('../components/charts/HistoricalCohortChart', () => ({ default: () => null }));

const { runMonteCarlo } = await import('../engine/monteCarlo');
const { pinDate } = await import('../engine/__regression__/snapshotUtil');
pinDate();
let failCompare = true;
const worker = {
  monteCarlo: vi.fn(async (plan: Plan, opts: MonteCarloOptions) => {
    // The comparison is the run on the plan without its ladder.
    if (failCompare && !plan.portfolio.tipsLadder) throw new Error('worker crashed');
    return runMonteCarlo(plan, { ...opts, trials: 20 });
  }),
  historicalSweep: vi.fn(),
  optimize: vi.fn(),
};
vi.mock('../engine/workerClient', () => ({ getEngineWorker: () => worker, disposeEngineWorker: () => {} }));

const { usePlanStore } = await import('../store/usePlanStore');
const { useOptimizerStore } = await import('../store/useOptimizerStore');
const { sampleSaved } = await import('../engine/__testutil__/savedPlans');
const { planS_tipsLadder } = await import('../engine/__golden/plans');
const { default: MonteCarlo } = await import('./MonteCarlo');

beforeEach(() => {
  mem.clear();
  usePlanStore.setState({ plan: sampleSaved(planS_tipsLadder()) });
  useOptimizerStore.getState().clearMcResults();
});
afterEach(cleanup);

describe('Monte Carlo: with vs without the TIPS ladder', () => {
  it('shows an error and keeps the Compare button when the comparison run fails', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      failCompare = true;
      render(<MonteCarlo />);
      fireEvent.click(screen.getByRole('button', { name: /Run Simulation/ }));
      const compare = await screen.findByRole('button', { name: 'Compare' });
      fireEvent.click(compare);
      expect(await screen.findByRole('alert')).toHaveTextContent('The comparison could not be run');
      await waitFor(() => expect(screen.getByRole('button', { name: 'Compare' })).not.toBeDisabled());
      failCompare = false;
      fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
      await screen.findByRole('table', { name: 'With vs without the TIPS ladder' });
      expect(screen.queryByRole('alert')).toBeNull();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
