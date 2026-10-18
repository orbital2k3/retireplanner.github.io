/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { samplePlan, type Portfolio, type TipsLadder, type TipsRung } from '../../schemas/plan';
import { TipsLadderCard } from './TipsLadderCard';

afterEach(cleanup);

const YEAR = 2026;
const rung = (over: Partial<TipsRung> = {}): TipsRung => ({
  id: 'r1', maturityYear: 2031, adjustedPrincipal: 48_000, couponRate: 0.0125, account: 'traditional', whose: 'A', ...over,
});
const portfolio = (rungs?: TipsRung[], include?: boolean): Portfolio => {
  const pf = samplePlan().portfolio;
  return rungs ? { ...pf, tipsLadder: { rungs, ...(include === false ? { balancesIncludeLadder: false } : {}) } } : pf;
};
const setup = (pf: Portfolio) => {
  const onChange = vi.fn<(l: TipsLadder | undefined) => void>();
  render(<TipsLadderCard portfolio={pf} nameA="Alex" nameB="Jordan" startYear={YEAR} onChange={onChange} />);
  return onChange;
};

describe('TipsLadderCard', () => {
  it('is just an add link (and a CSV link) until a rung exists', () => {
    const onChange = setup(portfolio());
    expect(screen.getByText('+ Add TIPS ladder')).toBeInTheDocument();
    expect(screen.queryByText('Adj. principal')).toBeNull();
    fireEvent.click(screen.getByText('+ Add TIPS ladder'));
    const ladder = onChange.mock.calls[0][0]!;
    expect(ladder.rungs).toHaveLength(1);
    expect(ladder.rungs[0]).toMatchObject({ maturityYear: YEAR + 1, account: 'taxable', whose: 'Household' });
    expect('balancesIncludeLadder' in ladder).toBe(false);
  });

  it('shows the rung count and total, and the totals by account', () => {
    setup(portfolio([rung(), rung({ id: 'r2', account: 'roth', whose: 'Household', adjustedPrincipal: 2_000 })]));
    expect(screen.getByText(/2 rungs/)).toBeInTheDocument();
    expect(screen.getByText(/\$50,000/)).toBeInTheDocument();
    expect(screen.getByText('In pre-tax')).toBeInTheDocument();
    expect(screen.getByText(/Alex: \$48,000 of \$/)).toBeInTheDocument();
  });

  it('shows the phantom-income note only when a taxable rung exists', () => {
    const { unmount } = render(<TipsLadderCard portfolio={portfolio([rung()])} nameA="Alex" startYear={YEAR} onChange={() => {}} />);
    expect(screen.queryByText(/phantom income/)).toBeNull();
    unmount();
    render(<TipsLadderCard portfolio={portfolio([rung({ account: 'taxable', whose: 'Household' })])} nameA="Alex" startYear={YEAR} onChange={() => {}} />);
    expect(screen.getByText(/phantom income/)).toBeInTheDocument();
    expect(screen.getByText(/Exempt from state tax/)).toBeInTheDocument();
  });

  it('shows an Owner select only for pre-tax rungs', () => {
    setup(portfolio([rung(), rung({ id: 'r2', account: 'taxable', whose: 'Household' })]));
    const rows = document.querySelectorAll('.tips-row');
    expect(rows[1].querySelectorAll('select')).toHaveLength(2);   // header is rows[0]
    expect(rows[2].querySelectorAll('select')).toHaveLength(1);
  });

  it('writes an account change with a sensible owner', () => {
    const onChange = setup(portfolio([rung({ account: 'taxable', whose: 'Household' })]));
    fireEvent.change(document.querySelectorAll('.tips-row')[1].querySelector('select')!, { target: { value: 'traditional' } });
    expect(onChange.mock.calls[0][0]!.rungs[0]).toMatchObject({ account: 'traditional', whose: 'A' });
  });

  it('stores par only when it differs from the principal', () => {
    const onChange = setup(portfolio([rung()]));
    const inputs = document.querySelectorAll('.tips-row')[1].querySelectorAll('input');
    const face = inputs[2];
    fireEvent.change(face, { target: { value: '45000' } });
    expect(onChange.mock.calls.at(-1)![0]!.rungs[0].faceValue).toBe(45_000);
    fireEvent.change(face, { target: { value: '48000' } });
    expect('faceValue' in onChange.mock.calls.at(-1)![0]!.rungs[0] && onChange.mock.calls.at(-1)![0]!.rungs[0].faceValue !== undefined).toBe(false);
  });

  it('flags a ladder bigger than its account and keeps that out of the way when balances exclude it', () => {
    const pf = samplePlan().portfolio;
    const huge = rung({ adjustedPrincipal: pf.personA.traditional + 1 });
    const { unmount } = render(<TipsLadderCard portfolio={portfolio([huge])} nameA="Alex" nameB="Jordan" startYear={YEAR} onChange={() => {}} />);
    expect(screen.getByText(/Pre-tax \(Alex\) rungs total/)).toBeInTheDocument();
    unmount();
    render(<TipsLadderCard portfolio={portfolio([huge], false)} nameA="Alex" nameB="Jordan" startYear={YEAR} onChange={() => {}} />);
    expect(screen.queryByText(/rungs total/)).toBeNull();
    expect(screen.getByText(/extra money on top of your balances/)).toBeInTheDocument();
  });

  it('writes the carve-out flag only when it is switched off', () => {
    const on = setup(portfolio([rung()]));
    fireEvent.click(screen.getByRole('checkbox'));
    expect(on.mock.calls[0][0]).toMatchObject({ balancesIncludeLadder: false });
    cleanup();
    const off = setup(portfolio([rung()], false));
    fireEvent.click(screen.getByRole('checkbox'));
    expect('balancesIncludeLadder' in off.mock.calls[0][0]!).toBe(false);
  });

  it('removing the last rung clears the ladder', () => {
    const onChange = setup(portfolio([rung()]));
    fireEvent.click(screen.getByLabelText('Remove rung'));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('pastes rungs from CSV, keeping good rows and listing bad ones', () => {
    const onChange = setup(portfolio([rung()]));
    fireEvent.click(screen.getByText('Paste from CSV'));
    fireEvent.change(screen.getByLabelText('Paste TIPS rungs'), { target: { value: '2033, 48000, 1.75%, taxable\nnope, 1, 1, taxable' } });
    fireEvent.click(screen.getByText('Add rungs'));
    const next = onChange.mock.calls[0][0]!;
    expect(next.rungs).toHaveLength(2);
    expect(next.rungs[1]).toMatchObject({ maturityYear: 2033, adjustedPrincipal: 48_000, couponRate: 0.0175, account: 'taxable' });
    expect(screen.getByText(/Line 2: Maturity: no year found/)).toBeInTheDocument();
  });
});
