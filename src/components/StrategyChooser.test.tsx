/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import type { SavedPlan } from '../schemas/savedPlan';
import { MANUAL_WINDOW } from '../engine/__testutil__/strategyPlans';

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
const { planStatus, resultStatus, enginePlan } = await import('../engine/strategy/savedPlan');
const { runProjection } = await import('../engine/projection');
const { sampleSaved, optimizedSaved, staleSaved } = await import('../engine/__testutil__/savedPlans');
const { default: StrategyChooser } = await import('./StrategyChooser');

type State = 'none' | 'fresh' | 'stale' | 'hand-edited' | 'pending';
function setup(state: State) {
  const handEdited: SavedPlan = (() => {
    const p = sampleSaved();
    return { ...p, strategy: { ...p.strategy, manual: { ...p.strategy.manual, customWindows: [MANUAL_WINDOW] } } };
  })();
  const plans: Record<State, SavedPlan> = {
    none: sampleSaved(),
    fresh: optimizedSaved(),
    stale: staleSaved(),
    'hand-edited': handEdited,
    pending: optimizedSaved(),
  };
  usePlanStore.setState({ plan: plans[state] });
  useOptimizerStore.setState({
    pendingPlan: state === 'pending' ? optimizedSaved(sampleSaved(), 'max-sustainable-spending') : null,
    pendingGoal: state === 'pending' ? 'max-sustainable-spending' : null,
  });
  render(<StrategyChooser />);
}

const tab = (name: 'optimize' | 'manual') =>
  fireEvent.click(screen.getByRole('button', { name: name === 'optimize' ? /Optimize for me/ : /Set it myself/ }));
const reopt = () => screen.getByRole('button', { name: /Re-optimize|Optimizing/ });
const goalPill = (label: string) => screen.getByRole('button', { name: new RegExp(label) });
const saved = () => usePlanStore.getState().plan;
const end = (p: SavedPlan) => runProjection(enginePlan(p)).endTotalReal;

beforeEach(() => runOptimizer.mockClear());
afterEach(cleanup);

describe('§6.7 StrategyChooser: Re-optimize enabled ⇔ no current result for the selected goal', () => {
  // [state, goal pill to click (null = keep), expected enabled]
  const TABLE: Array<[State, string | null, boolean]> = [
    ['none', null, true],
    ['fresh', null, false],
    ['fresh', 'Max Spending', true],
    ['fresh', 'Max End Balance', false],
    ['stale', null, true],
    ['hand-edited', null, true],
    ['pending', null, false],
    // Picking a goal saves it and declines the pending result; the saved Max End Balance result is current.
    ['pending', 'Max End Balance', false],
    ['pending', 'Earliest Retire', true],
  ];
  for (const [state, goal, enabled] of TABLE) {
    it(`${state}${goal ? ` + select ${goal}` : ''} → ${enabled ? 'enabled' : 'disabled'}`, () => {
      setup(state);
      tab('optimize');
      if (goal) fireEvent.click(goalPill(goal));
      expect((reopt() as HTMLButtonElement).disabled).toBe(!enabled);
    });
  }

  it('opens on the saved active tab', () => {
    setup('fresh');
    expect(screen.queryByText(/Withdrawal order/i)).toBeNull();
    cleanup();
    setup('none');
    expect(screen.getByText(/Withdrawal order/i)).toBeTruthy();
  });

  it('the applied goal pill carries the check mark; the selected goal is saved', () => {
    setup('fresh');
    expect(goalPill('Max End Balance').textContent).toContain('✓');
    fireEvent.click(goalPill('Max Spending'));
    expect(saved().strategy.optimizer.goal).toBe('max-sustainable-spending');
    expect(goalPill('Max End Balance').textContent).toContain('✓');
  });
});

describe('§6.7 StrategyChooser: every control saves to its own slot', () => {
  it('P4 a conversion pick under Optimize for me saves to the optimizer slot, keeps the result and the charts', () => {
    setup('fresh');
    const before = end(saved());
    expect(screen.getByRole('button', { name: /Optimizer decides/ }).textContent).toContain('✓');
    fireEvent.click(screen.getByRole('button', { name: /Fixed Amount/ }));
    expect(saved().strategy.optimizer).toMatchObject({ optimizerDecidesConversions: false, conversion: { mode: 'auto-window' } });
    expect(saved().strategy.manual).toEqual(optimizedSaved().strategy.manual);
    expect(planStatus(saved())).toBe('stale');
    expect(end(saved())).toBe(before);
    expect((reopt() as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/Takes effect when you re-optimize/)).toBeTruthy();
  });

  it('P20 "Optimizer decides" after Manual never fires the remembered schedule', () => {
    setup('none');
    usePlanStore.getState().editOptimizer({ optimizerDecidesConversions: false });
    usePlanStore.getState().setConversion('optimizer', { mode: 'manual', manualSchedule: { '50': 40_000, '70': 40_000 } });
    tab('optimize');
    fireEvent.click(screen.getByRole('button', { name: /Optimizer decides/ }));
    expect(saved().strategy.optimizer.optimizerDecidesConversions).toBe(true);
    expect(runProjection(enginePlan(saved())).lifetimeConversion).toBe(0);
  });

  it('P8 pay-tax-from-brokerage saves to the slot of the open tab', () => {
    setup('fresh');
    const before = saved().strategy.optimizer.payTaxFromBrokerage;
    fireEvent.click(screen.getByRole('checkbox'));
    expect(saved().strategy.optimizer.payTaxFromBrokerage).toBe(!before);
    expect(planStatus(saved())).toBe('stale');
    tab('manual');
    const manualBefore = saved().strategy.manual.payTaxFromBrokerage;
    fireEvent.click(screen.getByRole('checkbox'));
    expect(saved().strategy.manual.payTaxFromBrokerage).toBe(!manualBefore);
    expect(saved().strategy.optimizer.payTaxFromBrokerage).toBe(!before);
  });

  it('a strategy edit drops a result still waiting for Apply', () => {
    setup('pending');
    tab('optimize');
    fireEvent.click(screen.getByRole('button', { name: /Fixed Amount/ }));
    expect(useOptimizerStore.getState().pendingPlan).toBeNull();
  });

  it('P9/P10 a preset under Set it myself changes the charts at once and keeps the optimizer result', () => {
    setup('fresh');
    const optimizedEnd = end(saved());
    tab('manual');
    fireEvent.click(screen.getByRole('button', { name: /Roth-first/ }));
    expect(saved().strategy).toMatchObject({ active: 'manual', manual: { preset: 'rothfirst' } });
    expect(end(saved())).not.toBe(optimizedEnd);
    expect(resultStatus(saved())).toBe('fresh');
    tab('optimize');
    expect(end(saved())).toBe(optimizedEnd);
    expect((reopt() as HTMLButtonElement).disabled).toBe(true);
  });

  it('P10 a conversion pick under Set it myself saves to the manual slot without the optimizer pill', () => {
    setup('none');
    expect(screen.queryByRole('button', { name: /Optimizer decides/ })).toBeNull();
    const row = screen.getByText(/Roth conversions/i).parentElement!.parentElement!;
    fireEvent.click(within(row).getByRole('button', { name: /Fixed Amount/ }));
    expect(saved().strategy.manual.conversion.mode).toBe('auto-window');
    expect(saved().strategy.optimizer.conversion.mode).toBe(sampleSaved().strategy.optimizer.conversion.mode);
  });

  it('lowering the manual withdrawal ceiling caps only the manual conversion ceiling', () => {
    setup('none');
    usePlanStore.getState().setConversion('manual', { bracketCeiling: 403_550 });
    usePlanStore.getState().setConversion('optimizer', { bracketCeiling: 403_550 });
    fireEvent.change(screen.getByTitle(/bracket/i), { target: { value: '100800' } });
    expect(saved().strategy.manual).toMatchObject({ preset: 'bracketfill', withdrawalBracketCeiling: 100_800, conversion: { bracketCeiling: 100_800 } });
    expect(saved().strategy.optimizer.conversion.bracketCeiling).toBe(403_550);
  });

  it('Re-optimize runs the saved plan, whose goal is the selected one', () => {
    setup('fresh');
    fireEvent.click(goalPill('Earliest Retire'));
    fireEvent.click(reopt());
    expect(runOptimizer).toHaveBeenCalledWith(expect.objectContaining({ plan: saved() }));
    expect(saved().strategy.optimizer.goal).toBe('min-retirement-age');
  });
});
