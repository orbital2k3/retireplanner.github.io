/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { optimizerKey } from '../engine/strategy/optimizerInput';
import { samplePlan } from '../schemas/plan';
import type { Plan } from '../schemas/plan';

// Mock the stores so we can control what usePlanStore/useOptimizerStore return
// without needing a real localStorage-backed persist layer in jsdom.
const mockPlan = vi.fn<[], Plan>(() => samplePlan());
const mockPendingPlan = vi.fn<[], Plan | null>(() => null);

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

const BASE_WINDOW = {
  fromAge: 60, toAge: 95, pctTaxable: 0.5, pctTraditional: 0.3, pctRoth: 0.2,
} as const;

const renderBanner = () => render(<StalePlanBanner />);

describe('StalePlanBanner', () => {
  beforeEach(() => {
    mockPlan.mockReturnValue(samplePlan());
    mockPendingPlan.mockReturnValue(null);
  });

  it('renders nothing when policyStatus is none', () => {
    const { container } = renderBanner();
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when policyStatus is fresh', () => {
    const base = samplePlan();
    mockPlan.mockReturnValue({
      ...base,
      customPolicy: { windows: [BASE_WINDOW], source: 'optimizer', inputKey: optimizerKey(base) },
    });
    const { container } = renderBanner();
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when policyStatus is hand-edited', () => {
    mockPlan.mockReturnValue({
      ...samplePlan(),
      customPolicy: { windows: [BASE_WINDOW], source: 'manual' },
    });
    const { container } = renderBanner();
    expect(container.firstChild).toBeNull();
  });

  it('when stale, explains and re-optimizes in place without leaving the page', async () => {
    mockPlan.mockReturnValue({
      ...samplePlan(),
      customPolicy: { windows: [BASE_WINDOW], source: 'optimizer', inputKey: 'old-key' },
      optimizedForGoal: 'max-end-balance',
    });
    renderBanner();
    expect(screen.getByText(/inputs changed after the optimizer ran/i)).toBeTruthy();
    expect(screen.queryByText(/Back to Inputs/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Re-optimize/ }));
    await waitFor(() => expect(runOptimizer).toHaveBeenCalledWith(expect.objectContaining({ goal: 'max-end-balance' })));
  });

  it('renders nothing when pending even if stale key', () => {
    mockPlan.mockReturnValue({
      ...samplePlan(),
      customPolicy: { windows: [BASE_WINDOW], source: 'optimizer', inputKey: 'old-key' },
    });
    mockPendingPlan.mockReturnValue(samplePlan());
    const { container } = renderBanner();
    expect(container.firstChild).toBeNull();
  });
});
