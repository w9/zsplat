import type { SplatData, SplatStats } from 'zsplat';
import type { OpenDetail } from '../types';
import type { RunningStats } from '../utils/stats';
import { FpsDetailCard } from './FpsDetailCard';
import { HoverDetailCard } from './HoverDetailCard';
import { BOTTOM_BAR_OFFSET } from './BottomBar';

export type DetailPanelsProps = {
  openDetail: OpenDetail;
  stats: SplatStats | null;
  runningStats: RunningStats | null;
  hoverEnabled: boolean;
  splatData: SplatData | null;
  onReset: () => void;
  onOpenDetailChange: (v: OpenDetail) => void;
};

export function DetailPanels({
  openDetail,
  stats,
  runningStats,
  hoverEnabled,
  splatData,
  onReset,
  onOpenDetailChange,
}: DetailPanelsProps) {
  return (
    <div
      className="absolute left-0 z-10 flex flex-col-reverse gap-1.5 p-1.5 pl-3 pointer-events-none [&>*]:pointer-events-auto"
      style={{ bottom: BOTTOM_BAR_OFFSET }}
    >
      {hoverEnabled && (
        <HoverDetailCard
          hoveredSplatIndex={stats?.hoveredSplatIndex ?? null}
          splatData={splatData}
        />
      )}
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
