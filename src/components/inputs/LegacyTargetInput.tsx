import { usePlanStore } from '../../store/usePlanStore';
import { NumberInput } from './NumberInput';

export function LegacyTargetInput() {
  const legacy = usePlanStore((s) => s.plan.strategy.optimizer.legacyTargetTaxAdjReal);
  const editOptimizer = usePlanStore((s) => s.editOptimizer);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div className="input-prefix-wrap" style={{ width: 148, flexShrink: 0 }}>
        <span className="input-prefix">$</span>
        <NumberInput
          value={legacy}
          digits={0}
          min={0}
          style={{ paddingLeft: 22 }}
          onCommit={(v) => editOptimizer({ legacyTargetTaxAdjReal: Math.max(0, Math.round(v)) })}
        />
      </div>
      <span style={{ fontSize: 11.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
        After-tax legacy floor at plan end · 0 = unconstrained
      </span>
    </div>
  );
}
