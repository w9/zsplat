import type { SplatStats } from 'zsplat';
import type { OpenDetail } from '../types';
import type { RunningStats } from '../utils/stats';
import { Toolbar } from './Toolbar';
import { FpsDetailCard } from './FpsDetailCard';
import { StatsPanel } from './StatsPanel';

export function LeftColumn({
  src,
  stats,
  openDetail,
  runningStats,
  setOpenDetail,
  handleResetRunningStats,
  openFilePicker,
  shEnabled,
  setShEnabled,
  turntable,
  setTurntable,
}: {
  src: string | File | null;
  stats: SplatStats | null;
  openDetail: OpenDetail;
  runningStats: RunningStats | null;
  setOpenDetail: (v: OpenDetail) => void;
  handleResetRunningStats: () => void;
  openFilePicker: () => void;
  shEnabled: boolean;
  setShEnabled: (v: boolean) => void;
  turntable: boolean;
  setTurntable: (v: boolean) => void;
}) {
  return (
    <div className="w-[260px] min-w-[260px] h-full flex flex-col bg-black/85 border-r border-white/[0.08] shrink-0">
      <Toolbar
        onOpen={openFilePicker}
        hasScene={!!src}
        shEnabled={shEnabled}
        onShChange={setShEnabled}
        turntable={turntable}
        onTurntableChange={setTurntable}
      />
      {openDetail === 'fps' && (
        <div className="flex-1 min-h-0 overflow-auto p-2.5 px-4">
          <FpsDetailCard runningStats={runningStats} onReset={handleResetRunningStats} />
        </div>
      )}
      <StatsPanel stats={stats} openDetail={openDetail} onOpenDetailChange={setOpenDetail} />
    </div>
  );
}
