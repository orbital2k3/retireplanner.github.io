import { useState } from 'react';
import type { Portfolio, TipsLadder, TipsRung } from '../../schemas/plan';
import { NumberInput } from './NumberInput';
import { fmtFull } from '../../lib/format';
import { parseTipsCsv, type TipsCsvError } from '../../engine/tipsCsv';
import { ladderInBalances, tipsLadderIssues } from '../../engine/tipsValidation';

/** TIPS ladder card on the Portfolio panel (mockup M3). Until a rung exists it is a single "+ Add TIPS
 *  ladder" link. Every edit writes through `onChange`; an emptied ladder is stored as absent, and the
 *  "balances include the ladder" flag is stored only when it is switched off. */

const headerStyle: React.CSSProperties = { fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', whiteSpace: 'nowrap' };
const smallBtn: React.CSSProperties = { border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px', fontSize: 11, background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' };
const ACCOUNT_LABEL: Record<TipsRung['account'], string> = { taxable: 'Taxable', traditional: 'Pre-tax', roth: 'Roth' };

const normalize = (rungs: TipsRung[], include: boolean): TipsLadder | undefined =>
  rungs.length === 0 ? undefined : { rungs, ...(include ? {} : { balancesIncludeLadder: false }) };

const newRung = (year: number): TipsRung => ({
  id: `tips-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
  maturityYear: year, adjustedPrincipal: 10_000, couponRate: 0.01, account: 'taxable', whose: 'Household',
});

export function TipsLadderCard({ portfolio, nameA, nameB, startYear, onChange }: {
  portfolio: Portfolio;
  nameA: string;
  nameB?: string;
  startYear: number;
  onChange: (ladder: TipsLadder | undefined) => void;
}) {
  const ladder = portfolio.tipsLadder;
  const rungs = ladder?.rungs ?? [];
  const include = ladderInBalances(portfolio);
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [csvErrors, setCsvErrors] = useState<TipsCsvError[]>([]);

  const write = (next: TipsRung[], inc = include) => onChange(normalize(next, inc));
  const update = (id: string, patch: Partial<TipsRung>) => write(rungs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  if (rungs.length === 0 && !csvOpen) {
    return (
      <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        <button className="add-row-btn" onClick={() => write([newRung(startYear + 1)])}>+ Add TIPS ladder</button>
        <button
          type="button"
          onClick={() => setCsvOpen(true)}
          style={{ background: 'transparent', border: 'none', padding: 0, marginLeft: 14, cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)', textDecoration: 'underline', textUnderlineOffset: 2 }}
        >
          Paste from CSV
        </button>
        <div className="helper-text">Treasury inflation-protected bonds you hold to maturity. Each rung pays a fixed real amount in its year, whatever markets do.</div>
      </div>
    );
  }

  const issues = tipsLadderIssues(portfolio, startYear, { a: nameA, b: nameB });
  const live = rungs.filter((r) => r.maturityYear >= startYear);
  const sum = (pick: (r: TipsRung) => boolean) => live.filter(pick).reduce((s, r) => s + r.adjustedPrincipal, 0);
  const total = live.reduce((s, r) => s + r.adjustedPrincipal, 0);
  const a = portfolio.personA, b = portfolio.personB;
  const preA = sum((r) => r.account === 'traditional' && r.whose !== 'B');
  const preB = sum((r) => r.account === 'traditional' && r.whose === 'B');
  const taxable = sum((r) => r.account === 'taxable');
  const roth = sum((r) => r.account === 'roth');
  const hasTaxable = rungs.some((r) => r.account === 'taxable');
  const of = (balance: number) => (include ? ` of ${fmtFull(balance)}` : '');

  const importCsv = () => {
    const res = parseTipsCsv(csvText, { a: nameA, b: nameB });
    setCsvErrors(res.errors);
    if (res.rungs.length > 0) {
      write([...rungs, ...res.rungs]);
      if (res.errors.length === 0) { setCsvOpen(false); setCsvText(''); }
    }
  };

  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
        <div className="subsection-label" style={{ margin: 0 }}>
          TIPS ladder <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--text-muted)' }}>· {rungs.length} {rungs.length === 1 ? 'rung' : 'rungs'} · {fmtFull(total)}</span>
        </div>
        <button type="button" style={smallBtn} onClick={() => setCsvOpen((o) => !o)}>
          Paste from CSV
        </button>
      </div>
      <div className="helper-text" style={{ marginBottom: 8 }}>
        Treasury inflation-protected bonds you hold to maturity. Each rung pays a fixed real amount in its year, whatever markets do.
      </div>

      {csvOpen && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, marginBottom: 10, background: 'var(--cream)' }}>
          <div className="helper-text" style={{ marginBottom: 6 }}>
            One rung per line: maturity, adjusted principal, coupon, account (taxable, pre-tax or Roth), owner (pre-tax only), par (optional). Paste straight from a spreadsheet or use commas.
          </div>
          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            rows={5}
            placeholder={'2031, 48000, 1.25%, pre-tax, ' + nameA + ', 45000\n2033, 48000, 1.75%, taxable'}
            style={{ width: '100%', fontFamily: 'monospace', fontSize: 12, boxSizing: 'border-box' }}
            aria-label="Paste TIPS rungs"
          />
          {csvErrors.length > 0 && (
            <div className="plan-warning error" style={{ marginTop: 6 }}>
              {csvErrors.map((e) => <div key={e.line}>Line {e.line}: {e.message}</div>)}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" style={{ ...smallBtn, background: 'var(--navy)', color: '#fff', borderColor: 'var(--navy)', padding: '4px 12px', fontSize: 12, opacity: csvText.trim() === '' ? 0.5 : 1 }} disabled={csvText.trim() === ''} onClick={importCsv}>Add rungs</button>
            <button type="button" style={{ ...smallBtn, padding: '4px 12px', fontSize: 12 }} onClick={() => { setCsvOpen(false); setCsvErrors([]); }}>Cancel</button>
          </div>
        </div>
      )}

      {rungs.length > 0 && (
        <div className="stream-rows-scroll">
          <div className="stream-row tips-row" style={{ padding: '6px 0', borderBottom: '2px solid var(--border-light)' }}>
            <div style={headerStyle}>Matures</div>
            <div style={headerStyle}>Adj. principal</div>
            <div style={headerStyle}>Face (par)</div>
            <div style={headerStyle}>Coupon</div>
            <div style={headerStyle}>Account</div>
            <div style={headerStyle}>Whose</div>
            <div></div>
          </div>
          {rungs.map((r) => (
            <div key={r.id} className="stream-row tips-row">
              <NumberInput value={r.maturityYear} digits={0} min={1990} max={2200} style={{ fontSize: 13 }} onCommit={(v) => update(r.id, { maturityYear: Math.round(v) })} />
              <div className="input-prefix-wrap"><span className="input-prefix">$</span>
                <NumberInput value={r.adjustedPrincipal} min={1} style={{ fontSize: 13, paddingLeft: 22 }} onCommit={(v) => { if (v > 0) update(r.id, { adjustedPrincipal: v }); }} />
              </div>
              <div className="input-prefix-wrap" title="Par value. Sets the floor if prices fall. Leave equal to the principal if you are unsure.">
                <span className="input-prefix">$</span>
                <NumberInput
                  value={r.faceValue ?? r.adjustedPrincipal} min={1} style={{ fontSize: 13, paddingLeft: 22 }}
                  onCommit={(v) => update(r.id, { faceValue: v > 0 && v !== r.adjustedPrincipal ? v : undefined })}
                />
              </div>
              <div className="input-suffix-wrap">
                <NumberInput value={r.couponRate} scale={100} digits={3} min={0} max={20} style={{ fontSize: 13 }} onCommit={(v) => update(r.id, { couponRate: v })} />
                <span className="input-suffix">%</span>
              </div>
              <select
                value={r.account}
                style={{ fontSize: 13, ...(r.account === 'taxable' ? { borderColor: '#b8620a' } : {}) }}
                onChange={(e) => {
                  const account = e.target.value as TipsRung['account'];
                  update(r.id, { account, whose: account === 'traditional' ? (r.whose === 'Household' ? 'A' : r.whose) : 'Household' });
                }}
              >
                {(Object.keys(ACCOUNT_LABEL) as TipsRung['account'][]).map((k) => <option key={k} value={k}>{ACCOUNT_LABEL[k]}</option>)}
              </select>
              {r.account === 'traditional' ? (
                <select value={r.whose === 'B' ? 'B' : 'A'} style={{ fontSize: 13 }} onChange={(e) => update(r.id, { whose: e.target.value as 'A' | 'B' })}>
                  <option value="A">{nameA}</option>
                  {b && <option value="B">{nameB ?? 'Person B'}</option>}
                </select>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Household</div>
              )}
              <button className="remove-btn" aria-label="Remove rung" onClick={() => write(rungs.filter((x) => x.id !== r.id))}>×</button>
            </div>
          ))}
        </div>
      )}

      {hasTaxable && (
        <div style={{ fontSize: 11, color: '#7a5c10', background: 'rgba(201,168,76,0.12)', borderRadius: 5, padding: '4px 7px', margin: '4px 0 6px' }}>
          Taxable rungs owe federal tax each year on the inflation increase even though you get no cash until maturity ("phantom income"). An IRA is often a better home. Exempt from state tax. The plan counts this income from the first year either of you has retired.
        </div>
      )}
      <button className="add-row-btn" onClick={() => write([...rungs, { ...newRung(Math.max(startYear + 1, (rungs[rungs.length - 1]?.maturityYear ?? startYear) + 1)), account: 'taxable' }])}>+ Add rung</button>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, fontSize: 11 }}>
        <div style={{ background: 'var(--cream)', borderRadius: 6, padding: '6px 8px' }}>
          <div style={{ color: 'var(--text-muted)' }}>In pre-tax</div>
          <div style={{ fontWeight: 500, fontSize: 13 }}>{fmtFull(preA + preB)}</div>
          <div style={{ color: 'var(--text-muted)' }}>
            {preA > 0 && <div>{nameA}: {fmtFull(preA)}{of(a.traditional)}</div>}
            {preB > 0 && b && <div>{nameB ?? 'Person B'}: {fmtFull(preB)}{of(b.traditional)}</div>}
          </div>
        </div>
        <div style={{ background: 'var(--cream)', borderRadius: 6, padding: '6px 8px' }}>
          <div style={{ color: 'var(--text-muted)' }}>In taxable</div>
          <div style={{ fontWeight: 500, fontSize: 13 }}>{fmtFull(taxable)}</div>
          <div style={{ color: 'var(--text-muted)' }}>{include && taxable > 0 ? `of ${fmtFull(a.taxable + (b?.taxable ?? 0))}` : ''}</div>
        </div>
        <div style={{ background: 'var(--cream)', borderRadius: 6, padding: '6px 8px' }}>
          <div style={{ color: 'var(--text-muted)' }}>In Roth</div>
          <div style={{ fontWeight: 500, fontSize: 13 }}>{fmtFull(roth)}</div>
          <div style={{ color: 'var(--text-muted)' }}>{include && roth > 0 ? `of ${fmtFull(a.roth + (b?.roth ?? 0))}` : ''}</div>
        </div>
      </div>

      <label style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 8, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={include}
          onChange={(e) => write(rungs, e.target.checked)}
          style={{ accentColor: 'var(--gold)', width: 13, height: 13, marginTop: 1, flexShrink: 0 }}
        />
        <span>
          My account balances above already include these bonds. We'll set the ladder apart from them so nothing is counted twice.
          {!include && <span style={{ color: 'var(--text-muted)' }}> Unticked: the bonds are treated as extra money on top of your balances.</span>}
        </span>
      </label>

      {issues.length > 0 && (
        <div className="plan-warnings-strip" style={{ marginTop: 8, marginBottom: 0 }}>
          {issues.map((i, k) => (
            <div key={k} className={`plan-warning ${i.code === 'overflow' ? 'error' : 'warn'}`}>{i.message}</div>
          ))}
        </div>
      )}
    </div>
  );
}
