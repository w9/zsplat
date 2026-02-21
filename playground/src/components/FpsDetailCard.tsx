import type { RunningStats } from '../utils/stats';

export function FpsDetailCard({
  runningStats,
  onReset,
}: {
  runningStats: RunningStats | null;
  onReset: () => void;
}) {
  return (
    <div className="bg-black/60 border border-white/[0.15] rounded-lg p-3 px-4 shadow-lg">
      <div className="text-xs opacity-90 mb-2">
        {runningStats
          ? `avg ${Math.round(runningStats.avg)} · min ${Math.round(runningStats.min)} · max ${Math.round(runningStats.max)} · p5 ${Math.round(runningStats.p5)} · p25 ${Math.round(runningStats.p25)} · p50 ${Math.round(runningStats.p50)} · p75 ${Math.round(runningStats.p75)} · p95 ${Math.round(runningStats.p95)}`
          : 'No samples yet'}
      </div>
      <button
        type="button"
        style={{ padding: '5px 14px' }}
        className="bg-white/10 border border-white/20 rounded-md text-white text-[13px] cursor-pointer font-[inherit]"
        onClick={onReset}
      >
        Reset
      </button>
    </div>
  );
}
