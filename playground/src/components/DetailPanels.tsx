import type { SplatStats } from 'zsplat';
import type { OpenDetail } from '../types';
import type { RunningStats } from '../utils/stats';
import { FpsDetailCard } from './FpsDetailCard';
import { BOTTOM_BAR_OFFSET } from './BottomBar';

export function DetailPanels({
  openDetail,
  stats,
  runningStats,
  onReset,
  onOpenDetailChange,
}: {
  openDetail: OpenDetail;
  stats: SplatStats | null;
  runningStats: RunningStats | null;
  onReset: () => void;
  onOpenDetailChange: (v: OpenDetail) => void;
}) {
  return (
    <div
      className="absolute left-0 z-10 flex flex-col-reverse gap-1.5 p-1.5 pl-3 pointer-events-none [&>*]:pointer-events-auto"
      style={{ bottom: BOTTOM_BAR_OFFSET }}
    >
      {openDetail === 'fps' && (
        <FpsDetailCard
          currentFps={stats?.fps ?? null}
          runningStats={runningStats}
          onReset={onReset}
          onClose={() => onOpenDetailChange(null)}
        />
      )}
    </div>
  );
}
