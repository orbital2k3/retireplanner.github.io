/** @vitest-environment jsdom */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Plan } from '../schemas/plan';

/** Inputs that must leave the saved plan (and so the optimizer key) alone unless the user changes a value:
 *  the HSA return field (absent = same as pre-tax) and the expense Category select (absent = General). */

const mem = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, clear: () => mem.clear() },
});
vi.mock('../components/strategy/StrategyCustomizeSheet', () => ({ default: () => null }));
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;

const { usePlanStore } = await import('../store/usePlanStore');
const { savedOptimizerKey } = await import('../engine/strategy/savedPlan');
const { sampleSaved } = await import('../engine/__testutil__/savedPlans');
const { samplePlan } = await import('../schemas/plan');
const { default: InputsPage } = await import('./InputsPage');

const saved = () => usePlanStore.getState().plan;
const withHsa = (p: Plan): Plan => ({
  ...p,
  assumptions: { ...p.assumptions, tradReturn: 0.0625 },
  portfolio: { ...p.portfolio, personA: { ...p.portfolio.personA, hsa: 40_000 } },
});
const open = (flat: Plan) => {
  usePlanStore.setState({ plan: sampleSaved(flat) });
  render(<MemoryRouter><InputsPage /></MemoryRouter>);
};
const hsaReturnInput = () => screen.getByText('HSA', { selector: 'label' }).closest('.form-group')!.querySelector('input')!;

beforeEach(() => mem.clear());
afterEach(cleanup);

describe('HSA return field', () => {
  it('tabbing through it writes nothing, so the key and the pre-tax link stay', () => {
    open(withHsa(samplePlan()));
    const key = savedOptimizerKey(saved());
    const input = hsaReturnInput();
    expect(input.value).toBe('6.3');
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(savedOptimizerKey(saved())).toBe(key);
    expect(saved().assumptions.hsaReturn).toBeUndefined();
  });

  it('a value equal to the pre-tax return is stored as absent; any other value is stored', () => {
    const p = withHsa(samplePlan());
    open({ ...p, assumptions: { ...p.assumptions, tradReturn: 0.06 } });
    const input = hsaReturnInput();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.blur(input);
    expect(saved().assumptions.hsaReturn).toBe(0.07);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '6' } });
    fireEvent.blur(input);
    expect(saved().assumptions.hsaReturn).toBeUndefined();
  });
});

describe('expense Category select', () => {
  const firstCategory = () => screen.getAllByRole('combobox').find((s) => [...(s as HTMLSelectElement).options].some((o) => o.value === 'medical')) as HTMLSelectElement;

  it('General is written as absent, so a row switched back keeps its original key', () => {
    open(samplePlan());
    const key = savedOptimizerKey(saved());
    const id = saved().expenseStreams[0].id;
    fireEvent.change(firstCategory(), { target: { value: 'medical' } });
    expect(saved().expenseStreams.find((e) => e.id === id)!.category).toBe('medical');
    fireEvent.change(firstCategory(), { target: { value: 'general' } });
    expect(saved().expenseStreams.find((e) => e.id === id)!.category).toBeUndefined();
    expect(savedOptimizerKey(saved())).toBe(key);
  });

  it('the "Your HSA can pay this" hint shows only when the plan has an HSA', () => {
    const tagMedical = (p: Plan): Plan => ({ ...p, expenseStreams: p.expenseStreams.map((e, k) => (k === 0 ? { ...e, category: 'medical' } : e)) });
    open(tagMedical(samplePlan()));
    expect(screen.queryByText(/Your HSA can pay this tax-free/)).toBeNull();
    cleanup();
    open(tagMedical(withHsa(samplePlan())));
    expect(screen.getByText(/Your HSA can pay this tax-free/)).toBeTruthy();
  });
});
