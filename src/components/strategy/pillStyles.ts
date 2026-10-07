import type React from 'react';

/** idle: not chosen. active: chosen and in effect. pending: chosen, takes effect on Re-optimize. */
export type PillState = 'idle' | 'active' | 'pending';
const PILL_BORDER: Record<PillState, string> = {
  idle: '1px solid var(--border-light)', active: '2px solid var(--gold)', pending: '2px solid var(--warning)',
};
const PILL_BG: Record<PillState, string> = {
  idle: '#fff', active: 'rgba(201,168,76,0.08)', pending: 'var(--warning-light)',
};
const PILL_COLOR: Record<PillState, string> = {
  idle: 'var(--text-secondary)', active: '#7a5c10', pending: '#8a4a08',
};

// Pills and pill-styled selects share a fixed height so they align on one row.
export const pillStyle = (state: PillState): React.CSSProperties => ({
  height: 34, boxSizing: 'border-box', padding: '0 13px',
  fontSize: 13, fontWeight: 600, borderRadius: 999,
  border: PILL_BORDER[state], background: PILL_BG[state], color: PILL_COLOR[state],
  cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
  display: 'inline-flex', alignItems: 'center', gap: 5,
});
export const selectPillStyle = (state: PillState): React.CSSProperties => ({
  height: 34, boxSizing: 'border-box', padding: '0 8px 0 12px',
  fontSize: 13, fontWeight: 600, borderRadius: 999,
  border: PILL_BORDER[state], background: PILL_BG[state], color: state === 'idle' ? 'var(--text-primary)' : PILL_COLOR[state],
  cursor: 'pointer', fontFamily: 'inherit',
  // Override the design system's global `select { width: 100% }`.
  width: 'fit-content', minWidth: 0,
});

export const editLinkStyle: React.CSSProperties = {
  border: 'none', background: 'transparent', color: 'var(--gold)', cursor: 'pointer',
  fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600, padding: '0 2px', whiteSpace: 'nowrap',
};
