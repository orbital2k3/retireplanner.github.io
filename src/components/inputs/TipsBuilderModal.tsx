import { useEffect, useMemo, useRef, useState } from 'react';
import type { Portfolio, TipsRung } from '../../schemas/plan';
import { NumberInput } from './NumberInput';
import { fmtFull, fmtK } from '../../lib/format';
import { buildTipsLadder, builderBlocker, builderFundingAvailable, yearAtAge, type BuilderFunding } from '../../engine/tipsBuilder';

/** TIPS ladder builder (mockup M5). Sizes one rung per year for a fixed real income and appends the
 *  rungs to the ladder. The money stays in the funding account's entered balance, and the engine
 *  carves the rungs out of it (balancesIncludeLadder), so nothing else is edited. */

type FundingKey = 'traditional-A' | 'traditional-B' | 'taxable' | 'roth';
const fundingOf = (k: FundingKey): BuilderFunding =>
  k === 'traditional-A' ? { account: 'traditional', whose: 'A' }
    : k === 'traditional-B' ? { account: 'traditional', whose: 'B' }
    : { account: k };

const label: React.CSSProperties = { fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500, marginBottom: 3 };
const hint: React.CSSProperties = { fontSize: 11, color: 'var(--text-muted)', marginTop: 2 };
const tile: React.CSSProperties = { background: 'var(--cream)', borderRadius: 6, padding: '6px 8px' };
/** 2037, 2038, 2039, 2057 -> "2037-2039 and 2057". */
const yearSpans = (years: number[]): string => {
  const spans: string[] = [];
  for (let i = 0; i < years.length;) {
    let j = i;
    while (j + 1 < years.length && years[j + 1] === years[j] + 1) j++;
    spans.push(i === j ? `${years[i]}` : `${years[i]}-${years[j]}`);
    i = j + 1;
  }
  return spans.length <= 1 ? spans.join('') : `${spans.slice(0, -1).join(', ')} and ${spans[spans.length - 1]}`;
};
const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: '.6fr .6fr 1fr 1fr', gap: 6, fontSize: 12 };

export function TipsBuilderModal({ portfolio, nameA, nameB, ageA, startYear, defaultFromAge, ssClaimAgeA, onAdd, onClose }: {
  portfolio: Portfolio;
  nameA: string;
  nameB?: string;
  /** Person A's age in the plan's start year (the engine's convention: start year minus birth year). */
  ageA: number;
  startYear: number;
  defaultFromAge: number;
  /** Person A's Social Security claim age, for the bridge hint. */
  ssClaimAgeA?: number;
  onAdd: (rungs: TipsRung[]) => void;
  onClose: () => void;
}) {
  // Modal focus: move focus into the dialog on open, keep Tab inside it, and give it back to whatever had
  // it (the "Build a ladder…" button) on close. Escape closes.
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const focusables = () => [...(dialogRef.current?.querySelectorAll<HTMLElement>('input, select, button:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])];
    focusables().find((el) => el.tagName !== 'BUTTON')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { closeRef.current(); return; }
      if (e.key !== 'Tab') return;
      const els = focusables();
      if (els.length === 0) return;
      const first = els[0], last = els[els.length - 1];
      const inside = dialogRef.current?.contains(document.activeElement) ?? false;
      if (e.shiftKey && (document.activeElement === first || !inside)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); opener?.focus?.(); };
  }, []);

  const [income, setIncome] = useState(40_000);
  const [fromAge, setFromAge] = useState(Math.max(ageA, defaultFromAge));
  const [throughAge, setThroughAge] = useState(Math.max(ageA, defaultFromAge) + 7);
  const [yieldPct, setYieldPct] = useState(0.019);
  const [fundingKey, setFundingKey] = useState<FundingKey>(portfolio.personA.traditional > 0 ? 'traditional-A' : 'taxable');
  const funding = fundingOf(fundingKey);

  const built = useMemo(() => buildTipsLadder({
    incomeReal: income, realYield: yieldPct, funding: fundingOf(fundingKey), startYear,
    fromYear: yearAtAge(fromAge, ageA, startYear), throughYear: yearAtAge(throughAge, ageA, startYear),
  }), [income, yieldPct, fundingKey, startYear, fromAge, throughAge, ageA]);

  const before = builderFundingAvailable(portfolio, funding, startYear);
  const blocker = built.rungs.length > 0 ? builderBlocker(portfolio, funding, built.cost, startYear) : null;
  const sourceName = fundingKey === 'traditional-A' ? `${nameA} pre-tax`
    : fundingKey === 'traditional-B' ? `${nameB ?? 'Person B'} pre-tax`
    : fundingKey === 'taxable' ? 'Taxable' : 'Roth';
  const n = built.rungs.length;
  // fmtK renders 0 as an em dash, which reads as "unknown" here; the balance really is $0.
  const after = Math.max(0, before) - built.cost;
  const kOrZero = (v: number) => (Math.abs(v) < 500 ? '$0' : fmtK(v));
  const existing = portfolio.tipsLadder?.rungs.length ?? 0;

  return (
    // The backdrop does not close the dialog: a stray click (or a drag that ends outside) would discard the
    // inputs. Cancel, × and Escape close it.
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(13,27,46,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Build a TIPS ladder"
        style={{ background: '#fff', borderRadius: 14, maxWidth: 560, width: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: 'var(--shadow-lg)' }}
      >
        <div style={{ background: 'var(--gold-pale)', padding: '8px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, fontWeight: 500, letterSpacing: 0.6 }}>
          <span>BUILD A TIPS LADDER</span>
          <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', fontSize: 20, color: 'var(--text-muted)', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: '12px 14px 0' }}>
          <div className="helper-text" style={{ marginTop: 0, marginBottom: 10 }}>
            Plan new bonds that pay the income you choose. The preview starts from example values; change any input and it updates.
            Nothing is added until you click Add at the bottom. The rungs then appear on the TIPS card, where you can edit or remove them.
            {existing > 0 && ` Your ladder already has ${existing} ${existing === 1 ? 'rung' : 'rungs'}; these are added alongside.`}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 8 }}>
            <div>
              <div style={label}>Income per year (today's $)</div>
              <div className="input-prefix-wrap"><span className="input-prefix">$</span>
                <NumberInput value={income} min={0} style={{ fontSize: 13, paddingLeft: 22 }} onCommit={(v) => setIncome(Math.max(0, v))} />
              </div>
            </div>
            <div>
              <div style={label}>From age</div>
              <NumberInput value={fromAge} digits={0} min={ageA} max={120} style={{ fontSize: 13 }} onCommit={(v) => setFromAge(Math.round(v))} />
              <div style={hint}>{nameA}'s age</div>
            </div>
            <div>
              <div style={label}>Through age</div>
              <NumberInput value={throughAge} digits={0} min={ageA} max={120} style={{ fontSize: 13 }} onCommit={(v) => setThroughAge(Math.round(v))} />
              {ssClaimAgeA !== undefined && ssClaimAgeA > fromAge && <div style={hint}>Bridge to Social Security at {ssClaimAgeA}</div>}
            </div>
            <div>
              <div style={label}>Real yield</div>
              <div className="input-suffix-wrap">
                <NumberInput value={yieldPct} scale={100} digits={2} min={0} max={0.1} style={{ fontSize: 13 }} onCommit={(v) => setYieldPct(Math.max(0, v))} />
                <span className="input-suffix">%</span>
              </div>
              <div style={hint}>From TreasuryDirect or your broker</div>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <div style={label}>Buy with money from</div>
              <select value={fundingKey} style={{ fontSize: 13, width: '100%' }} onChange={(e) => setFundingKey(e.target.value as FundingKey)} aria-label="Buy with money from">
                <option value="traditional-A">Pre-tax · {nameA}</option>
                {portfolio.personB && <option value="traditional-B">Pre-tax · {nameB ?? 'Person B'}</option>}
                <option value="taxable">Taxable</option>
                <option value="roth">Roth</option>
              </select>
            </div>
          </div>

          <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: 1, color: 'var(--text-muted)', margin: '10px 0 4px' }}>PREVIEW · NOT ADDED YET</div>
          {n === 0 ? (
            <div className="helper-text">No rungs for these inputs.</div>
          ) : (
            <>
              <div style={{ ...grid4, fontWeight: 500, color: 'var(--text-secondary)', borderBottom: '2px solid var(--border-light)', paddingBottom: 3 }}>
                <div>Year</div><div>Age</div><div>Rung principal</div><div>Pays (today's $)</div>
              </div>
              <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                {built.rows.map((r) => (
                  <div key={r.year} style={{ ...grid4, padding: '3px 0' }}>
                    <div>{r.year}</div><div>{ageA + (r.year - startYear)}</div><div>{fmtFull(r.principal)}</div><div>{fmtFull(r.paysReal)}</div>
                  </div>
                ))}
              </div>
              <div className="helper-text" style={{ marginTop: 4 }}>
                Each rung is bought at par with a coupon equal to the real yield.{built.rows[0].year > startYear && ' The rungs also pay coupons in the years before the first one matures.'}
                Projections in today's dollars show each payment about one year of inflation higher, because the plan values bond payments at the year's end.
              </div>
              {built.unissued.length > 0 && (
                <div className="plan-warning warn" style={{ marginTop: 6 }}>
                  No TIPS mature in {yearSpans(built.unissued)} yet, so those years get no rung, only the later rungs' coupons. A common fix is to buy more of the nearest bonds on either side and hold the extra until then.
                </div>
              )}
            </>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
            <div style={tile}>
              <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>Cost today</div>
              <div style={{ fontWeight: 500, fontSize: 14 }} data-testid="tips-builder-cost">{fmtFull(built.cost)}</div>
            </div>
            <div style={tile}>
              <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>Comes out of</div>
              <div style={{ fontWeight: 500, fontSize: 14 }}>{sourceName}: {kOrZero(Math.max(0, before))} → {after >= 0 ? kOrZero(after) : `short by ${fmtFull(-after)}`}</div>
            </div>
          </div>
          <div className="helper-text" style={{ marginTop: 4 }}>
            The money stays in your balance on the Portfolio panel; the plan sets these bonds apart from it.
          </div>
        </div>

        {/* Footer stays in view while the dialog scrolls, so the Add button and why it is off are never hidden. */}
        <div style={{ position: 'sticky', bottom: 0, background: '#fff', borderTop: '1px solid var(--border-light)', padding: '10px 14px 12px', marginTop: 12 }}>
          {blocker && <div className="plan-warning error" style={{ marginBottom: 8 }}>{blocker}</div>}
          {n === 0 && <div className="helper-text" style={{ marginTop: 0, marginBottom: 8 }}>Nothing to add yet: pick an income above $0 and a through age no earlier than the from age.</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" onClick={onClose} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '5px 12px', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 12 }}>Cancel</button>
            <button
              type="button"
              disabled={n === 0 || blocker !== null}
              onClick={() => { onAdd(built.rungs); onClose(); }}
              style={{ border: 'none', borderRadius: 6, padding: '5px 12px', background: 'var(--navy)', color: '#fff', cursor: n === 0 || blocker ? 'not-allowed' : 'pointer', fontSize: 12, opacity: n === 0 || blocker ? 0.5 : 1 }}
            >
              Add {n} {n === 1 ? 'rung' : 'rungs'} to ladder
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
