/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { samplePlan, type Portfolio, type TipsLadder, type TipsRung } from '../../schemas/plan';
import { TipsLadderCard } from './TipsLadderCard';

afterEach(cleanup);

const YEAR = 2026;
const existing: TipsRung = { id: 'r1', maturityYear: 2040, adjustedPrincipal: 20_000, couponRate: 0.01, account: 'roth', whose: 'Household' };
const portfolio = (over: Partial<Portfolio> = {}): Portfolio => ({ ...samplePlan().portfolio, ...over });
const setup = (pf: Portfolio, ageA: number | null = 60) => {
  const onChange = vi.fn<(l: TipsLadder | undefined) => void>();
  render(<TipsLadderCard portfolio={pf} nameA="Alex" nameB="Jordan" startYear={YEAR} ageA={ageA ?? undefined} retireAgeA={62} onChange={onChange} />);
  return onChange;
};
const addButton = () => screen.getByRole('button', { name: /^Add \d+ rungs? to ladder$/ });

describe('TipsBuilderModal (TB-2)', () => {
  it('is offered only when the age is known, in both card states', () => {
    setup(portfolio(), null);
    expect(screen.queryByText('Build a ladder…')).toBeNull();
    cleanup();
    setup(portfolio());
    expect(screen.getByText('Build a ladder…')).toBeInTheDocument();
    cleanup();
    setup(portfolio({ tipsLadder: { rungs: [existing] } }));
    expect(screen.getByText('Build a ladder…')).toBeInTheDocument();
  });

  it('previews rungs from the retirement age, then appends them to the existing rungs', () => {
    const onChange = setup(portfolio({ tipsLadder: { rungs: [existing] } }));
    fireEvent.click(screen.getByText('Build a ladder…'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // Default: $40,000 a year from 62 through 69 (8 rungs), first maturity 2028.
    expect(addButton()).toHaveTextContent('Add 8 rungs to ladder');
    expect(screen.getByText('2028')).toBeInTheDocument();
    fireEvent.click(addButton());
    const ladder = onChange.mock.calls[0][0]!;
    expect(ladder.rungs).toHaveLength(9);
    expect(ladder.rungs[0]).toBe(existing);
    expect(ladder.rungs.slice(1).map((r) => r.maturityYear)).toEqual([2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035]);
    expect(ladder.rungs.slice(1).every((r) => r.account === 'traditional' && r.whose === 'A' && r.couponRate === 0.019)).toBe(true);
    expect('balancesIncludeLadder' in ladder).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('disables the add button when the cost exceeds the funding account', () => {
    const pf = portfolio();
    const onChange = setup({ ...pf, personA: { ...pf.personA, roth: 50_000 }, personB: pf.personB && { ...pf.personB, roth: 0 } });
    fireEvent.click(screen.getByText('Build a ladder…'));
    fireEvent.change(screen.getByLabelText('Buy with money from'), { target: { value: 'roth' } });
    expect(screen.getByText(/but the account has \$50,000 left/)).toBeInTheDocument();
    expect(addButton()).toBeDisabled();
    fireEvent.click(addButton());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('refuses to buy from a balance when the ladder is set as extra money on top', () => {
    setup(portfolio({ tipsLadder: { rungs: [existing], balancesIncludeLadder: false } }));
    fireEvent.click(screen.getByText('Build a ladder…'));
    expect(within(screen.getByRole('dialog')).getByText(/on top of your balances/)).toBeInTheDocument();
    expect(addButton()).toBeDisabled();
  });

  it('is a modal dialog: focus moves in, Tab stays in, the backdrop does not discard it, and focus returns on close', () => {
    setup(portfolio());
    const opener = screen.getByText('Build a ladder…');
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.contains(document.activeElement)).toBe(true);
    const focusables = [...dialog.querySelectorAll<HTMLElement>('input, select, button:not([disabled])')];
    focusables[focusables.length - 1].focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(document.activeElement).toBe(focusables[0]);
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(focusables[focusables.length - 1]);
    fireEvent.click(dialog.parentElement!);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByText('Build a ladder…'));
  });

  it('notes the years with no TIPS to buy and buys no rung in them', () => {
    const onChange = setup(portfolio({ personA: { ...samplePlan().portfolio.personA, taxable: 5_000_000 } }));
    fireEvent.click(screen.getByText('Build a ladder…'));
    const dialog = screen.getByRole('dialog');
    const [, from, through] = within(dialog).getAllByRole('textbox');
    // ageA 60 in 2026: 70 -> 2036, 74 -> 2040
    for (const [input, v] of [[through, '74'], [from, '70']] as const) {
      fireEvent.focus(input); fireEvent.change(input, { target: { value: v } }); fireEvent.blur(input);
    }
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'taxable' } });
    expect(within(dialog).getByText(/No TIPS mature in 2037-2039 yet/)).toBeInTheDocument();
    fireEvent.click(addButton());
    expect(onChange.mock.calls[0][0]!.rungs.map((r) => r.maturityYear)).toEqual([2036, 2040]);
  });
});
