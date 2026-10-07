import { useState } from 'react';
import { usePlanStore } from '../store/usePlanStore';
import { LegacyTargetInput } from './inputs/LegacyTargetInput';
import { useOptimizerStore } from '../store/useOptimizerStore';
import { STRATEGIES } from '../engine/strategyPresets';
import { USER_GOALS, type UserGoal } from '../engine/recommender';
import { runOptimizer, discardPending } from '../store/strategyActions';
import { resultStatus, canReOptimize } from '../engine/strategy/savedPlan';
import StrategyCustomizeSheet from './strategy/StrategyCustomizeSheet';
import ConversionPills from './strategy/ConversionPills';
import { pillStyle, selectPillStyle, editLinkStyle } from './strategy/pillStyles';
import Chk from './strategy/Chk';
import { FED_BRACKETS_MFJ, FED_BRACKETS_SINGLE } from '../engine/taxConstants';
import { GOAL_LABELS as GOAL_SHORT_LABELS } from '../engine/goalLabels';

const inlineLabelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1,
  color: 'var(--text-secondary)', flexShrink: 0, whiteSpace: 'nowrap',
};

export default function StrategyChooser() {
  const plan = usePlanStore((s) => s.plan);
  const setActiveStrategy = usePlanStore((s) => s.setActiveStrategy);
  const editManual = usePlanStore((s) => s.editManual);
  const editOptimizer = usePlanStore((s) => s.editOptimizer);
  const setPendingPlan = useOptimizerStore((s) => s.setPendingPlan);
  const setPendingGoal = useOptimizerStore((s) => s.setPendingGoal);
  const pendingPlan = useOptimizerStore((s) => s.pendingPlan);

  const [sheetMode, setSheetMode] = useState<null | 'blend' | 'conversion' | 'chart'>(null);
  const [optimizing, setOptimizing] = useState(false);

  // A pending result (Max Spending / Earliest Retire awaiting Apply) is what the charts show.
  const effectivePlan = pendingPlan ?? plan;
  const { manual } = plan.strategy;
  const result = effectivePlan.strategy.result;
  const approach: 'optimize' | 'manual' = plan.strategy.active === 'optimizer' ? 'optimize' : 'manual';
  const handEdited = manual.customWindows !== undefined;
  const status = resultStatus(effectivePlan);
  const stale = status === 'stale';
  const selectedGoal = effectivePlan.strategy.optimizer.goal;
  const reOptimizeEnabled = !optimizing && canReOptimize(effectivePlan);

  const brackets = plan.personB ? FED_BRACKETS_MFJ : FED_BRACKETS_SINGLE;
  const bracketOptions = brackets.slice(0, 5).map(([top, rate]) => ({
    value: top, label: `${Math.round(rate * 100)}% ($${top.toLocaleString()})`,
  }));
  // "Set it myself" bracket-fill ceiling is capped at the withdrawal bracket-fill ceiling when
  // that withdrawal preset is active: you can't convert above the bracket you're already filling.
  // "Optimize for me" is never restricted: the optimizer searches all brackets freely.
  const convBracketOptionsManual = bracketOptions
    .filter(({ value }) => manual.preset !== 'bracketfill' || value <= manual.withdrawalBracketCeiling);

  /** A saved strategy edit replaces any result still waiting for Apply. */
  const dropPending = () => {
    setPendingPlan(null);
    setPendingGoal(null);
  };

  const runReOptimize = async () => {
    setOptimizing(true);
    try {
      await runOptimizer({ plan });
    } catch (err) {
      console.error('[StrategyChooser] Re-optimize failed:', err);
    } finally {
      setOptimizing(false);
    }
  };

  const switchApproach = (tab: 'optimize' | 'manual') => {
    // The pending result belongs to "Optimize for me"; leaving the tab discards it.
    if (tab === 'manual' && pendingPlan) discardPending();
    setActiveStrategy(tab === 'optimize' ? 'optimizer' : 'manual');
  };

  const selectGoal = (goal: UserGoal) => {
    dropPending();
    editOptimizer({ goal });
  };

  const pickWithdrawal = (preset: typeof STRATEGIES[number]['key'], ceiling?: number) => {
    // Within "Set it myself" the conversion ceiling can't exceed a bracket-fill withdrawal ceiling.
    const conversion = preset === 'bracketfill' && ceiling !== undefined && manual.conversion.bracketCeiling > ceiling
      ? { ...manual.conversion, bracketCeiling: ceiling } : manual.conversion;
    editManual({ preset, customWindows: undefined, conversion, ...(ceiling !== undefined ? { withdrawalBracketCeiling: ceiling } : {}) });
  };

  const conversionRow = (tab: 'optimize' | 'manual') => {
    if (tab === 'manual' && handEdited) {
      return (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Conversions are set per-year in your custom blend.{' '}
          <button style={editLinkStyle} onClick={() => setSheetMode('blend')}>Edit blend →</button>
        </div>
      );
    }
    return tab === 'optimize' ? (
      <ConversionPills variant="optimizer" pending={status !== 'fresh'} ceilingOptions={bracketOptions}
        onBeforeChoose={dropPending} onEdit={() => setSheetMode('conversion')} />
    ) : (
      <ConversionPills variant="manual" ceilingOptions={convBracketOptionsManual}
        onEdit={() => setSheetMode('conversion')} />
    );
  };

  return (
    <>
      <div className="panel" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'stretch' }}>

          {/* Vertical mode tabs */}
          <div style={{ display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border-light)', flexShrink: 0 }}>
            {(['optimize', 'manual'] as const).map((tab) => {
              const active = approach === tab;
              return (
                <button key={tab} onClick={() => switchApproach(tab)} style={{
                  flex: 1, display: 'flex', alignItems: 'center',
                  padding: '0 18px', textAlign: 'left', border: 'none', whiteSpace: 'nowrap',
                  borderLeft: `4px solid ${active ? 'var(--gold)' : 'transparent'}`,
                  borderBottom: tab === 'optimize' ? '1px solid var(--border-light)' : 'none',
                  background: active ? '#fdf3dc' : 'rgba(13,27,46,0.04)',
                  cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: active ? 13.5 : 13, fontWeight: active ? 700 : 400,
                  color: active ? '#7a4f00' : 'rgba(13,27,46,0.35)',
                }}>
                  {tab === 'optimize' ? '⚡ Optimize for me' : '✎ Set it myself'}
                </button>
              );
            })}
          </div>

          {/* Content grid: label col | pills col | actions col */}
          <div style={{
            flex: 1, padding: '12px 14px 12px 16px',
            display: 'grid',
            gridTemplateColumns: 'max-content 1fr auto',
            columnGap: 16, rowGap: 10,
            alignItems: 'start',
          }}>

            {approach === 'optimize' && (<>
              {/* Goal row */}
              <div style={{ ...inlineLabelStyle, paddingTop: 9 }}>Goal</div>
              <div style={{
                display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start',
                // Reserve room for the absolutely-positioned legacy input hanging below the pill.
                paddingBottom: selectedGoal === 'max-sustainable-spending' ? 38 : 0,
              }}>
                {(Object.keys(USER_GOALS) as UserGoal[]).map((key) => {
                  const selected = key === selectedGoal;
                  const applied = result?.goal === key;
                  if (key === 'max-sustainable-spending') {
                    return (
                      <div key={key} style={{ position: 'relative' }}>
                        <button onClick={() => selectGoal(key)} title={USER_GOALS[key].description}
                          style={pillStyle(selected ? 'active' : 'idle')}>
                          {applied && <Chk />}{GOAL_SHORT_LABELS[key]}
                        </button>
                        {selectedGoal === 'max-sustainable-spending' && (
                          <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, whiteSpace: 'nowrap' }}>
                            <LegacyTargetInput />
                          </div>
                        )}
                      </div>
                    );
                  }
                  return (
                    <button key={key} onClick={() => selectGoal(key)} title={USER_GOALS[key].description}
                      style={pillStyle(selected ? 'active' : 'idle')}>
                      {applied && <Chk />}{GOAL_SHORT_LABELS[key]}
                    </button>
                  );
                })}
              </div>
              {/* Re-optimize button */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                <button onClick={runReOptimize} disabled={!reOptimizeEnabled}
                  style={{
                    height: 34, boxSizing: 'border-box', fontSize: 13, fontWeight: 600,
                    padding: '0 14px', borderRadius: 8, border: 'none',
                    background: reOptimizeEnabled ? 'var(--gold)' : 'rgba(13,27,46,0.06)',
                    color: reOptimizeEnabled ? 'var(--navy)' : 'var(--text-muted)',
                    cursor: reOptimizeEnabled ? 'pointer' : 'default', fontFamily: 'inherit', whiteSpace: 'nowrap',
                    display: 'inline-flex', alignItems: 'center', gap: 7,
                  }}>
                  {stale && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--warning)', display: 'inline-block' }} />}
                  {optimizing ? 'Optimizing…' : '↗ Re-optimize'}
                </button>
                {stale && (
                  <div style={{ fontSize: 11, color: 'var(--warning)', fontWeight: 600 }}>Your plan changed. Re-optimize to update the strategy.</div>
                )}
              </div>

              {/* Roth row */}
              <div style={{ ...inlineLabelStyle, paddingTop: 9 }}>Roth conversions</div>
              <div>
                {conversionRow('optimize')}
                {stale && <div style={{ fontSize: 11.5, color: 'var(--warning)', fontWeight: 600, marginTop: 8 }}>Saved. Takes effect when you re-optimize.</div>}
              </div>
              <div style={{ paddingTop: 9, display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={() => setSheetMode('chart')} style={{ ...editLinkStyle, fontSize: 12 }}>📊 Conversions vs RMDs →</button>
              </div>
            </>)}

            {approach === 'manual' && (<>
              {/* Withdrawal order row */}
              <div style={{ ...inlineLabelStyle, paddingTop: 9 }}>Withdrawal order</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {STRATEGIES.map((s) => {
                  const isActive = s.key === manual.preset && !handEdited;
                  if (s.key === 'bracketfill') {
                    return (
                      <select key={s.key} title={s.description}
                        value={isActive ? manual.withdrawalBracketCeiling : ''}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          if (isNaN(val)) return;
                          pickWithdrawal('bracketfill', val);
                        }}
                        style={selectPillStyle(isActive ? 'active' : 'idle')}>
                        <option value="">Bracket-Fill</option>
                        {bracketOptions.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
                      </select>
                    );
                  }
                  return (
                    <button key={s.key} onClick={() => pickWithdrawal(s.key)} title={s.description}
                      style={pillStyle(isActive ? 'active' : 'idle')}>
                      {isActive && <Chk />}{s.shortLabel}
                    </button>
                  );
                })}
                <button onClick={() => setSheetMode('blend')} title="Edit custom withdrawal blend by age window"
                  style={pillStyle(handEdited ? 'active' : 'idle')}>
                  {handEdited && <Chk />}✎ Custom blend
                </button>
              </div>
              <div style={{ paddingTop: 9, display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={() => setSheetMode('chart')} style={{ ...editLinkStyle, fontSize: 12 }}>📊 Conversions vs RMDs →</button>
              </div>

              {/* Roth conversions row */}
              <div>
                <span style={inlineLabelStyle}>Roth conversions</span>
                {!handEdited && <span style={{ display: 'block', fontSize: 10, fontWeight: 500, color: 'var(--text-muted)', marginTop: 2 }}>· instant</span>}
              </div>
              <div>{conversionRow('manual')}</div>
              <div />
            </>)}

            {/* Tax sourcing row: shared across both tabs, always at the bottom */}
            <div style={{ ...inlineLabelStyle, borderTop: '1px solid var(--border-light)', paddingTop: 10, marginTop: 2 }}>Tax payments</div>
            <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: 8, marginTop: 2 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 13, color: 'var(--text-primary)', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={plan.strategy[approach === 'optimize' ? 'optimizer' : 'manual'].payTaxFromBrokerage}
                  onChange={(e) => {
                    if (approach === 'optimize') { dropPending(); editOptimizer({ payTaxFromBrokerage: e.target.checked }); }
                    else editManual({ payTaxFromBrokerage: e.target.checked });
                  }}
                  style={{ accentColor: 'var(--gold)', width: 13, height: 13 }}
                />
                Pay IRA withdrawal taxes from brokerage
              </label>
            </div>
            <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: 8, marginTop: 2 }} />

          </div>
        </div>
      </div>

      <StrategyCustomizeSheet
        open={sheetMode !== null}
        mode={sheetMode ?? 'blend'}
        onClose={() => setSheetMode(null)}
        slot={approach === 'optimize' ? 'optimizer' : 'manual'}
      />
    </>
  );
}
