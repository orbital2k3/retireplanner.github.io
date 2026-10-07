/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { samplePlan, type Plan } from '../schemas/plan';
import type { UserGoal } from '../engine/recommender';
import type { BlendWindow } from '../engine/blendPolicy';

// jsdom here exposes a bare `localStorage`; stub a working one before the persisted store loads.
const mem = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, clear: () => mem.clear() },
});

const runOptimizer = vi.fn(async () => ({ kind: 'applied' }));
vi.mock('../store/strategyActions', async (importActual) => ({ ...(await importActual<object>()), runOptimizer }));
vi.mock('./strategy/StrategyCustomizeSheet', () => ({ default: () => null }));

const { usePlanStore } = await import('../store/usePlanStore');
const { useOptimizerStore } = await import('../store/useOptimizerStore');
const { optimizerKey } = await import('../engine/strategy/optimizerInput');
const { optimizerSettings } = await import('../engine/strategy/resultSettings');
const { policyStatus } = await import('../engine/policyStatus');
const { runProjection } = await import('../engine/projection');
const { default: StrategyChooser } = await import('./StrategyChooser');

const WINDOW: BlendWindow = { fromAge: 59, toAge: 98, pctTaxable: 0.5, pctTraditional: 0.3, pctRoth: 0.2, convAmt: 20_000 };

function optimized(goal: UserGoal, base: Plan = samplePlan()): Plan {
  return {
    ...base,
    customPolicy: { windows: [WINDOW], source: 'optimizer', goal, inputKey: optimizerKey(base), settings: optimizerSettings(base) },
    optimizedForGoal: goal, optimizedBy: 'optimizer',
  };
}

type State = 'none' | 'fresh' | 'stale' | 'hand-edited' | 'pending';
function setup(state: State) {
  const base = samplePlan();
  const plans: Record<State, Plan> = {
    none: base,
    fresh: optimized('max-end-balance'),
    stale: { ...optimized('max-end-balance'), customPolicy: { ...optimized('max-end-balance').customPolicy!, inputKey: 'old' } },
    'hand-edited': { ...base, customPolicy: { windows: [WINDOW], source: 'manual' } },
    pending: optimized('max-end-balance'),
  };
  usePlanStore.setState({ plan: plans[state] });
  useOptimizerStore.setState({
    pendingPlan: state === 'pending' ? optimized('max-sustainable-spending') : null,
    pendingGoal: state === 'pending' ? 'max-sustainable-spending' : null,
  });
  render(<StrategyChooser />);
}

const tab = (name: 'optimize' | 'manual') =>
  fireEvent.click(screen.getByRole('button', { name: name === 'optimize' ? /Optimize for me/ : /Set it myself/ }));
const reopt = () => screen.getByRole('button', { name: /Re-optimize|Optimizing/ });
const goalPill = (label: string) => screen.getByRole('button', { name: new RegExp(label) });
const saved = () => usePlanStore.getState().plan;

beforeEach(() => runOptimizer.mockClear());
afterEach(cleanup);

describe('§6.7 StrategyChooser: Re-optimize enabled ⇔ no current result for the selected goal', () => {
  // [state, goal pill to click (null = keep default), expected enabled]
  const TABLE: Array<[State, string | null, boolean]> = [
    ['none', null, true],
    ['fresh', null, false],
    ['fresh', 'Max Spending', true],
    ['fresh', 'Max End Balance', false],
    ['stale', null, true],
    ['hand-edited', null, true],
    ['pending', null, false],
    ['pending', 'Max End Balance', true],
  ];
  for (const [state, goal, enabled] of TABLE) {
    it(`${state}${goal ? ` + select ${goal}` : ''} → ${enabled ? 'enabled' : 'disabled'}`, () => {
      setup(state);
      tab('optimize');
      if (goal) fireEvent.click(goalPill(goal));
      expect((reopt() as HTMLButtonElement).disabled).toBe(!enabled);
    });
  }

  it('opens on the tab matching the saved strategy', () => {
    setup('fresh');
    expect(screen.queryByText(/Withdrawal order/i)).toBeNull();
    cleanup();
    setup('none');
    expect(screen.getByText(/Withdrawal order/i)).toBeTruthy();
  });

  it('the applied goal pill carries the check mark', () => {
    setup('fresh');
    expect(goalPill('Max End Balance').textContent).toContain('✓');
    expect(goalPill('Max Spending').textContent).not.toContain('✓');
  });
});

describe('§6.7 StrategyChooser: every control saves immediately', () => {
  it('P4 a conversion pick under Optimize for me saves, keeps the result and the charts, and enables Re-optimize', () => {
    setup('fresh');
    const before = runProjection(saved()).endTotalReal;
    expect(screen.getByRole('button', { name: /Optimizer decides/ }).textContent).toContain('✓');
    fireEvent.click(screen.getByRole('button', { name: /Fixed Amount/ }));
    expect(saved().conversion).toMatchObject({ optimize: false, mode: 'auto-window' });
    expect(saved().customPolicy?.source).toBe('optimizer');
    expect(policyStatus(saved())).toBe('stale');
    expect(runProjection(saved()).endTotalReal).toBe(before);
    expect((reopt() as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/Takes effect when you re-optimize/)).toBeTruthy();
  });

  it('P20 "Optimizer decides" after Manual resets the mode', () => {
    setup('none');
    usePlanStore.getState().setConversion({ optimize: false, mode: 'manual', manualSchedule: { '50': 40_000, '70': 40_000 } });
    tab('optimize');
    fireEvent.click(screen.getByRole('button', { name: /Optimizer decides/ }));
    expect(saved().conversion).toMatchObject({ optimize: true, mode: 'off' });
    expect(runProjection(saved()).lifetimeConversion).toBe(0);
  });

  it('P8 pay-tax-from-brokerage saves immediately on either tab', () => {
    setup('fresh');
    const before = saved().payTaxFromBrokerage;
    fireEvent.click(screen.getByRole('checkbox'));
    expect(saved().payTaxFromBrokerage).toBe(!before);
    expect(policyStatus(saved())).toBe('stale');
  });

  it('a strategy edit drops a result still waiting for Apply', () => {
    setup('pending');
    tab('optimize');
    fireEvent.click(screen.getByRole('button', { name: /Fixed Amount/ }));
    expect(useOptimizerStore.getState().pendingPlan).toBeNull();
  });

  it('P10 a withdrawal preset under Set it myself saves and replaces the optimizer result', () => {
    setup('fresh');
    tab('manual');
    fireEvent.click(screen.getByRole('button', { name: /Roth-first/ }));
    expect(saved().withdrawalStrategy).toBe('rothfirst');
    expect(saved().customPolicy).toBeUndefined();
  });

  it('P10 a conversion pick under Set it myself saves without the optimizer pill', () => {
    setup('none');
    expect(screen.queryByRole('button', { name: /Optimizer decides/ })).toBeNull();
    const row = screen.getByText(/Roth conversions/i).parentElement!.parentElement!;
    fireEvent.click(within(row).getByRole('button', { name: /Fixed Amount/ }));
    expect(saved().conversion).toMatchObject({ optimize: false, mode: 'auto-window' });
  });

  it('Re-optimize runs the saved plan with the selected goal', () => {
    setup('fresh');
    fireEvent.click(goalPill('Earliest Retire'));
    fireEvent.click(reopt());
    expect(runOptimizer).toHaveBeenCalledWith(expect.objectContaining({ plan: saved(), goal: 'min-retirement-age' }));
  });
});
