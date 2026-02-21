import type { SplatData, SplatStats } from 'zsplat';
import type { OpenDetail } from '../types';
import type { RunningStats } from '../utils/stats';
import { DetailPanelWrapper } from './DetailPanelWrapper';
import { FpsDetailCard } from './FpsDetailCard';
import { HoverDetailCard } from './HoverDetailCard';

export type DetailPanelsProps = {
  openDetail: OpenDetail;
  stats: SplatStats | null;
  runningStats: RunningStats | null;
  hoverEnabled: boolean;
  splatData: SplatData | null;
  onReset: () => void;
  onOpenDetailChange: (v: OpenDetail) => void;
  onCloseHover?: () => void;
};

export function DetailPanels({
  openDetail,
  stats,
  runningStats,
  hoverEnabled,
  splatData,
  onReset,
  onOpenDetailChange,
  onCloseHover,
}: DetailPanelsProps) {
  return (
    <>
      {hoverEnabled && (
        <DetailPanelWrapper
          title="Hover"
          anchor="top"
          anchorIndex={0}
          onClose={onCloseHover}
          initialWidth={320}
          initialHeight={186}
        >
          <HoverDetailCard
            hoveredSplatIndex={stats?.hoveredSplatIndex ?? null}
            splatData={splatData}
          />
        </DetailPanelWrapper>
      )}
      {openDetail === 'fps' && (
        <DetailPanelWrapper
          title="FPS"
          anchor="bottom"
          anchorIndex={0}
          onClose={() => onOpenDetailChange(null)}
        >
          <FpsDetailCard
            currentFps={stats?.fps ?? null}
            runningStats={runningStats}
            onReset={onReset}
          />
        </DetailPanelWrapper>
      )}
    </>
  );
}
