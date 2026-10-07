import { useState } from 'react';
import { usePlanStore } from '../store/usePlanStore';
import { useOptimizerStore } from '../store/useOptimizerStore';
import { runOptimizer } from '../store/strategyActions';
import { planStatus } from '../engine/strategy/savedPlan';

/**
 * Non-blocking notice for result pages when the plan's facts or "Optimize for me" settings changed
 * after the optimizer ran. The page keeps rendering the current facts under the earlier strategy.
 */
export default function StalePlanBanner() {
  const plan = usePlanStore((s) => s.plan);
  const pendingPlan = useOptimizerStore((s) => s.pendingPlan);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (pendingPlan !== null || planStatus(plan) !== 'stale') return null;
  // Re-run the goal the stale result was built for.
  const goal = plan.strategy.result!.goal;

  const reoptimize = async () => {
    setProgress(0);
    setError(null);
    try {
      await runOptimizer({ plan, goal, onProgress: (frac) => setProgress(frac) });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProgress(null);
    }
  };

  const running = progress !== null;
  return (
    <div style={{
      background: '#fff8e1', border: '1px solid #f59e0b', borderRadius: 8,
      padding: '10px 14px', margin: '12px 24px 0', color: '#78350f',
      display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: 16 }}>⚠</span>
      <div style={{ flex: 1, minWidth: 240, fontSize: 13, lineHeight: 1.5 }}>
        <strong>Your plan changed after the optimizer ran.</strong>{' '}
        The results below still use the strategy the optimizer picked earlier.
        Re-optimize to pick a strategy for your plan as it is now.
        {error && <div style={{ color: '#c0392b', marginTop: 4 }}>Re-optimize failed: {error}</div>}
      </div>
      <button className="btn btn-primary" onClick={reoptimize} disabled={running}>
        {running ? `Optimizing… ${Math.round((progress ?? 0) * 100)}%` : 'Re-optimize'}
      </button>
    </div>
  );
}
