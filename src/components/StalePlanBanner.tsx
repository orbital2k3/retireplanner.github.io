import { useState } from 'react';
import * as Comlink from 'comlink';
import { usePlanStore } from '../store/usePlanStore';
import { useOptimizerStore } from '../store/useOptimizerStore';
import { policyStatus } from '../engine/policyStatus';
import { getEngineWorker } from '../engine/workerClient';
import { applyResultToPlan } from '../engine/applyOptimizerResult';
import type { UserGoal } from '../engine/recommender';

/**
 * Non-blocking notice for result pages when inputs changed after the optimizer ran.
 * The page keeps rendering projections of the current inputs under the earlier strategy.
 */
export default function StalePlanBanner() {
  const plan = usePlanStore((s) => s.plan);
  const applyOptimizerResult = usePlanStore((s) => s.applyOptimizerResult);
  const pendingPlan = useOptimizerStore((s) => s.pendingPlan);
  const setOptimizerResult = useOptimizerStore((s) => s.setResult);
  const setPendingPlan = useOptimizerStore((s) => s.setPendingPlan);
  const setPendingGoal = useOptimizerStore((s) => s.setPendingGoal);
  const setRobustnessPlan = useOptimizerStore((s) => s.setRobustnessPlan);
  const setRobustnessComparison = useOptimizerStore((s) => s.setRobustnessComparison);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (pendingPlan !== null || policyStatus(plan) !== 'stale') return null;
  const goal = (plan.optimizedForGoal ?? 'max-end-balance') as UserGoal;

  const reoptimize = async () => {
    setProgress(0);
    setError(null);
    setRobustnessPlan(null);
    setRobustnessComparison(null);
    try {
      const onProgress = Comlink.proxy((frac: number) => setProgress(frac));
      const result = await getEngineWorker().optimize(plan, goal, { useNelderMead: true, thorough: true }, onProgress);
      const appliedPlan = applyResultToPlan(plan, result);
      setOptimizerResult(result);
      if (goal === 'max-sustainable-spending' || goal === 'min-retirement-age') {
        setPendingPlan(appliedPlan);
        setPendingGoal(goal);
      } else {
        applyOptimizerResult(appliedPlan);
      }
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
        <strong>Your inputs changed after the optimizer ran.</strong>{' '}
        The results below use your new inputs with the strategy picked for your earlier ones.
        Re-optimize to pick a strategy that fits your current plan.
        {error && <div style={{ color: '#c0392b', marginTop: 4 }}>Re-optimize failed: {error}</div>}
      </div>
      <button className="btn btn-primary" onClick={reoptimize} disabled={running}>
        {running ? `Optimizing… ${Math.round((progress ?? 0) * 100)}%` : 'Re-optimize'}
      </button>
    </div>
  );
}
