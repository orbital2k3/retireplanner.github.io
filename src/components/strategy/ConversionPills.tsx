import type React from 'react';
import { usePlanStore } from '../../store/usePlanStore';
import { chooseConversion, type ConversionChoice } from '../../store/strategyActions';
import type { ConversionParams } from '../../schemas/plan';
import type { ConversionSettings } from '../../schemas/savedPlan';
import { pillStyle, selectPillStyle, editLinkStyle, type PillState } from './pillStyles';
import Chk from './Chk';

type ConvMode = ConversionParams['mode'];
const CONV_LABELS: Record<ConvMode, string> = {
  'off': 'None',
  'bracket-fill': 'Bracket-Fill',
  'auto-window': 'Fixed Amount',
  'manual': 'Manual',
};

/** Roth conversion pills, shared by the Inputs page and the Dashboard strategy panel. Every pill
 *  saves immediately and shows the saved setting.
 *  - optimizer: edits the "Optimize for me" settings and shows "Optimizer decides".
 *  - manual: edits the "Set it myself" settings; no optimizer pill.
 *  `pending` marks the chosen pill amber (saved, takes effect on Re-optimize). */
export default function ConversionPills({ variant, pending = false, ceilingOptions, onBeforeChoose, onEdit }: {
  variant: 'optimizer' | 'manual';
  pending?: boolean;
  ceilingOptions: { value: number; label: string }[];
  onBeforeChoose?: () => void;
  onEdit: () => void;
}) {
  const conv = usePlanStore((s) => s.plan.strategy[variant].conversion);
  const optimizeOn = usePlanStore((s) => variant === 'optimizer' && s.plan.strategy.optimizer.optimizerDecidesConversions);
  const isSel = (m: ConvMode) => !optimizeOn && conv.mode === m;
  const stateOf = (sel: boolean): PillState => (sel ? (pending ? 'pending' : 'active') : 'idle');
  const choose = (choice: ConversionChoice, extra?: Partial<ConversionSettings>) => {
    onBeforeChoose?.();
    chooseConversion(variant, choice, extra);
  };

  const col = (key: string, pill: React.ReactNode, link?: React.ReactNode) => (
    <div key={key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3 }}>{pill}{link}</div>
  );
  const editLink = (label: string) => <button style={editLinkStyle} onClick={onEdit}>{label} →</button>;
  const modePill = (m: ConvMode) => {
    const st = stateOf(isSel(m));
    return <button onClick={() => choose(m)} style={pillStyle(st)}>{st === 'active' && <Chk />}{CONV_LABELS[m]}</button>;
  };
  const optSt = stateOf(optimizeOn);

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
      {variant === 'optimizer' && col('auto',
        <button onClick={() => choose('optimizer')} title="The optimizer searches conversion amounts for you" style={pillStyle(optSt)}>
          {optSt === 'active' && <Chk />}🎯 Optimizer decides
        </button>,
      )}
      {col('off', modePill('off'))}
      {col('bracket-fill',
        <select
          value={isSel('bracket-fill') ? conv.bracketCeiling : ''}
          onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) choose('bracket-fill', { bracketCeiling: v }); }}
          style={selectPillStyle(stateOf(isSel('bracket-fill')))}
          aria-label="Bracket-Fill conversion ceiling"
        >
          <option value="">Bracket-Fill</option>
          {ceilingOptions.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
        </select>,
        isSel('bracket-fill') ? editLink('Edit age window') : undefined,
      )}
      {col('auto-window', modePill('auto-window'), isSel('auto-window') ? editLink('Edit details') : undefined)}
      {col('manual', modePill('manual'), isSel('manual') ? editLink('Edit details') : undefined)}
    </div>
  );
}
