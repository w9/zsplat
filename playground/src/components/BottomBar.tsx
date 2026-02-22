import type { SplatStats } from 'zsplat';
import type { OpenDetail } from '../types';
import { StatsPanel } from './StatsPanel';

export const BOTTOM_BAR_OFFSET = 56;
export const TOP_BAR_OFFSET = 52;

export function BottomBar({
  stats,
  openDetail,
  onOpenDetailChange,
  hasScene,
  cameraControlMode = 'orbit',
}: {
  stats: SplatStats | null;
  openDetail: OpenDetail;
  onOpenDetailChange: (v: OpenDetail) => void;
  hasScene: boolean;
  cameraControlMode?: 'orbit' | 'fly';
}) {
  const leftDragHint = cameraControlMode === 'fly' ? 'Left drag: look around' : 'Left drag: orbit';
  return (
    <div
      className="absolute bottom-0 left-0 right-0 z-10 flex flex-row items-center w-full bg-transparent pointer-events-none [&>*]:pointer-events-auto"
      style={{ minHeight: BOTTOM_BAR_OFFSET }}
    >
      <StatsPanel
        stats={stats}
        openDetail={openDetail}
        onOpenDetailChange={onOpenDetailChange}
        className="border-t-0 shrink-0"
      />
      <div className="flex-1 min-w-2" />
      {hasScene && (
        <div className="shrink-0 px-4 text-[11px] text-muted-foreground pointer-events-none">
          {leftDragHint} · Right drag / Shift+drag: pan · Scroll: zoom
        </div>
      )}
    </div>
  );
}
