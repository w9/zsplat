import type { OpenDetail } from '../types';
import type { RunningStats } from '../utils/stats';
import { FpsDetailCard } from './FpsDetailCard';
import { BOTTOM_BAR_OFFSET } from './BottomBar';

export function DetailPanels({
  openDetail,
  runningStats,
  onReset,
}: {
  openDetail: OpenDetail;
  runningStats: RunningStats | null;
  onReset: () => void;
}) {
  return (
    <div
      className="absolute left-0 z-10 flex flex-col-reverse gap-2 p-2.5 pl-4 pointer-events-none [&>*]:pointer-events-auto"
      style={{ bottom: BOTTOM_BAR_OFFSET }}
    >
      {openDetail === 'fps' && (
        <FpsDetailCard runningStats={runningStats} onReset={onReset} />
      )}
    </div>
  );
}
