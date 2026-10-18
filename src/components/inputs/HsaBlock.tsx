import { useState } from 'react';
import type { PersonPortfolio } from '../../schemas/plan';
import { NumberInput } from './NumberInput';
import { fmtFull } from '../../lib/format';
import { hsaLimit, HSA_MEDICARE_AGE } from '../../engine/hsa';

/** Health savings account block for one person on the Portfolio panel (mockup M2). Collapsed while the
 *  person has no HSA; every control writes through `onChange`, and zero or default values are stored as
 *  "absent" so a plan that never used the HSA keeps the same saved shape (and the same optimizer key). */

const positive = (v: number): number | undefined => (v > 0 ? v : undefined);

export function HsaBlock({ data, onChange, age, retirementAge, sharedWith }: {
  data: PersonPortfolio;
  onChange: (patch: Partial<PersonPortfolio>) => void;
  /** Age now, used for the catch-up hint. */
  age: number | undefined;
  retirementAge: number;
  /** Spouse's name when both spouses are on family coverage (they share one limit). */
  sharedWith?: string;
}) {
  const [open, setOpen] = useState((data.hsa ?? 0) > 0 || (data.hsaContribution ?? 0) > 0);
  const coverage = data.hsaCoverage ?? 'self';
  const max = hsaLimit(coverage, age ?? 0, 1);
  const contribution = data.hsaContribution ?? 0;
  const catchUp = (age ?? 0) >= 55;

  return (
    <div style={{ border: '1.5px solid var(--success)', borderRadius: 8, padding: '9px 10px', background: '#fbfefc', marginBottom: 12 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{ all: 'unset', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: open ? 8 : 0 }}
      >
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#0f5c3b' }}>
          {open ? '▾' : '▸'} Health savings account (HSA)
        </span>
        {!open && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Optional · add if you have one</span>}
      </button>
      {open && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>HSA balance</label>
            <div className="input-prefix-wrap"><span className="input-prefix">$</span>
              <NumberInput value={data.hsa ?? 0} min={0} style={{ paddingLeft: 22 }} onCommit={(v) => onChange({ hsa: positive(v) })} />
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Annual contribution</label>
            <div className="input-prefix-wrap"><span className="input-prefix">$</span>
              <NumberInput value={contribution} min={0} style={{ paddingLeft: 22 }} onCommit={(v) => onChange({ hsaContribution: positive(v) })} />
            </div>
            <div className="helper-text" style={contribution > max ? { color: 'var(--warning)' } : undefined}>
              {contribution > max
                ? `Above the limit. The plan caps it at ${fmtFull(max)}.`
                : `Max ${fmtFull(max)} (${coverage}${catchUp ? ' + 55+ catch-up' : ''})`}
              {sharedWith && coverage === 'family' ? ` · shared with ${sharedWith}` : ''}
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Coverage</label>
            <div className="toggle-group">
              {(['self', 'family'] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`toggle-opt${coverage === c ? ' active' : ''}`}
                  onClick={() => onChange({ hsaCoverage: c === 'self' ? undefined : c })}
                >
                  {c === 'self' ? 'Self' : 'Family'}
                </button>
              ))}
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Unreimbursed receipts</label>
            <div className="input-prefix-wrap"><span className="input-prefix">$</span>
              <NumberInput value={data.hsaReceipts ?? 0} min={0} style={{ paddingLeft: 22 }} onCommit={(v) => onChange({ hsaReceipts: positive(v) })} />
            </div>
            <div className="helper-text">Past medical bills you paid out of pocket and can still claim tax-free</div>
          </div>
          {retirementAge < HSA_MEDICARE_AGE && (
            <label style={{ gridColumn: 'span 2', display: 'flex', gap: 6, alignItems: 'flex-start', paddingTop: 14, cursor: 'pointer', fontSize: 11.5, color: 'var(--text-secondary)' }}>
              <input
                type="checkbox"
                checked={data.hsaContribInRetirement === true}
                onChange={(e) => onChange({ hsaContribInRetirement: e.target.checked ? true : undefined })}
                style={{ accentColor: 'var(--gold)', width: 13, height: 13, marginTop: 1, flexShrink: 0 }}
              />
              Keep contributing after I retire, on an HSA-eligible plan (for example ACA bronze), until 65. Lowers the income used for your ACA subsidy.
            </label>
          )}
        </div>
      )}
    </div>
  );
}

/** Household policy: from what age the HSA pays medical bills (mockup M2). Shown only when an HSA exists. */
export function HsaPolicyRow({ value, onChange }: { value: number | undefined; onChange: (age: number | undefined) => void }) {
  const current = value ?? HSA_MEDICARE_AGE;
  const ages = Array.from({ length: 21 }, (_, i) => 55 + i);
  return (
    <div style={{ borderTop: '1px solid var(--border)', marginTop: 14, paddingTop: 12, display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 12, alignItems: 'start' }}>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label>HSA pays medical expenses from age</label>
        <select value={current} onChange={(e) => { const v = Number(e.target.value); onChange(v === HSA_MEDICARE_AGE ? undefined : v); }}>
          <option value={0}>Always</option>
          {ages.map((a) => <option key={a} value={a}>{a}{a === HSA_MEDICARE_AGE ? ' (default)' : ''}</option>)}
        </select>
      </div>
      <div className="helper-text" style={{ paddingTop: 18 }}>
        Before that age, medical bills are paid from your other accounts and logged as receipts, so the HSA keeps growing tax-free. Receipts can be claimed later as tax-free cash.
      </div>
    </div>
  );
}
