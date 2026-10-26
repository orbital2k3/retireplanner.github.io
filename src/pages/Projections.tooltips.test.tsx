/** @vitest-environment jsdom */
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/** M16: a Projections cell tooltip quotes money in the same dollars as the cells (today's or nominal). */

const mem = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, clear: () => mem.clear() },
});
vi.mock('../components/charts/CashFlowsBalanced', () => ({ default: () => null }));
vi.mock('../components/WhatIfBar', () => ({ default: () => null }));
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;

const { pinDate, unpinDate } = await import('../engine/__regression__/snapshotUtil');
pinDate();
afterAll(unpinDate);
const { usePlanStore } = await import('../store/usePlanStore');
const { enginePlan } = await import('../engine/strategy/savedPlan');
const { runProjection } = await import('../engine/projection');
const { sampleSaved } = await import('../engine/__testutil__/savedPlans');
const { planQ_qcdGiver } = await import('../engine/__golden/plans');
const { fmtFull } = await import('../lib/format');
const { default: Projections } = await import('./Projections');

afterEach(cleanup);

describe('Projections tooltips', () => {
  for (const mode of ['real', 'nominal'] as const) {
    it(`the Giving and QCD tooltips use ${mode} dollars, like the cells`, () => {
      const saved = sampleSaved(planQ_qcdGiver());
      usePlanStore.setState({ plan: saved, displayMode: mode });
      const rows = runProjection(enginePlan(saved)).rows;
      const k = rows.findIndex((r) => r.qcd > 0 && r.inflationFactor > 1.2);
      expect(k).toBeGreaterThanOrEqual(0);
      const r = rows[k];
      const $ = (n: number) => fmtFull(mode === 'real' ? n / r.inflationFactor : n);
      render(<MemoryRouter><Projections /></MemoryRouter>);
      const headers = [...document.querySelectorAll('thead th')].map((th) => th.textContent?.trim());
      const cellOf = (label: string) => document.querySelectorAll('tbody tr')[k].querySelectorAll('td')[headers.findIndex((h) => h?.startsWith(label))];
      fireEvent.mouseEnter(cellOf('Giving'));
      expect(screen.getByText(new RegExp(`^${$(r.qcd).replace(/[$]/g, '\\$')} paid from your IRA as a QCD`))).toBeTruthy();
      fireEvent.mouseLeave(cellOf('Giving'));
      fireEvent.mouseEnter(cellOf('QCD'));
      expect(screen.getByText(new RegExp(`${$(r.qcd - r.qcdBeyondRmd).replace(/[$]/g, '\\$')} of it counts toward your RMD`))).toBeTruthy();
    });
  }
});
