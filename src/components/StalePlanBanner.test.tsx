/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { SavedPlan } from '../schemas/savedPlan';
import { sampleSaved, optimizedSaved, staleSaved } from '../engine/__testutil__/savedPlans';

// Mock the stores so we can control what usePlanStore/useOptimizerStore return
// without needing a real localStorage-backed persist layer in jsdom.
const mockPlan = vi.fn<[], SavedPlan>(() => sampleSaved());
const mockPendingPlan = vi.fn<[], SavedPlan | null>(() => null);

const runOptimizer = vi.fn(async () => ({ kind: 'applied' }));
vi.mock('../store/usePlanStore', () => ({
  usePlanStore: (selector: (s: object) => unknown) => selector({ plan: mockPlan() }),
}));
vi.mock('../store/useOptimizerStore', () => ({
  useOptimizerStore: (selector: (s: object) => unknown) => selector({ pendingPlan: mockPendingPlan() }),
}));
vi.mock('../store/strategyActions', () => ({ runOptimizer }));

// Import after mocks are set up
const { default: StalePlanBanner } = await import('./StalePlanBanner');

const renderBanner = () => render(<StalePlanBanner />);
const withActive = (p: SavedPlan, active: 'manual' | 'optimizer'): SavedPlan => ({ ...p, strategy: { ...p.strategy, active } });

describe('StalePlanBanner', () => {
  beforeEach(() => {
    mockPlan.mockReturnValue(sampleSaved());
    mockPendingPlan.mockReturnValue(null);
  });

  it('renders nothing when there is no result', () => {
    expect(renderBanner().container.firstChild).toBeNull();
  });

  it('renders nothing when the result is fresh', () => {
    mockPlan.mockReturnValue(optimizedSaved());
    expect(renderBanner().container.firstChild).toBeNull();
  });

  it('renders nothing while "Set it myself" is active, even with a stale result kept', () => {
    mockPlan.mockReturnValue(withActive(staleSaved(), 'manual'));
    expect(renderBanner().container.firstChild).toBeNull();
  });

  it('when stale, explains and re-optimizes in place without leaving the page', async () => {
    mockPlan.mockReturnValue(staleSaved());
    renderBanner();
    expect(screen.getByText(/inputs changed after the optimizer ran/i)).toBeTruthy();
    expect(screen.queryByText(/Back to Inputs/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Re-optimize/ }));
    await waitFor(() => expect(runOptimizer).toHaveBeenCalledWith(expect.objectContaining({ goal: 'max-end-balance' })));
  });

  it('renders nothing when pending even if stale', () => {
    mockPlan.mockReturnValue(staleSaved());
    mockPendingPlan.mockReturnValue(optimizedSaved());
    expect(renderBanner().container.firstChild).toBeNull();
  });
});
