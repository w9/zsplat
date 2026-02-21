import type { SplatStats } from 'zsplat';
import type { OpenDetail } from '../types';
import { fmt, fmtB } from '../utils/format';

const buttonStyle = { padding: '5px 14px' };
const buttonBase =
  'bg-white/10 border border-white/20 rounded-md text-white text-[13px] cursor-pointer font-[inherit]';

export function StatsPanel({
  stats,
  openDetail,
  onOpenDetailChange,
}: {
  stats: SplatStats | null;
  openDetail: OpenDetail;
  onOpenDetailChange: (v: OpenDetail) => void;
}) {
  if (!stats) {
    return (
      <div className="p-2.5 px-4 border-t border-white/[0.08] shrink-0">
        <span className="text-xs opacity-50">No stats</span>
      </div>
    );
  }
  const fpsOpen = openDetail === 'fps';
  return (
    <div className="p-2.5 px-4 border-t border-white/[0.08] shrink-0">
      <div className="flex flex-wrap items-center gap-3 text-xs opacity-90">
        <span>{fmt(stats.numSplats)} splats</span>
        <button
          type="button"
          style={buttonStyle}
          className={`${buttonBase} text-xs ${fpsOpen ? 'bg-sky-500/20 border-sky-500/50 text-sky-300' : ''}`}
          onClick={() => onOpenDetailChange(fpsOpen ? null : 'fps')}
        >
          {stats.fps} fps
        </button>
        {stats.loadTimeMs > 0 && <span>{Math.round(stats.loadTimeMs)} ms load</span>}
        {stats.gpuMemoryBytes > 0 && <span>{fmtB(stats.gpuMemoryBytes)} GPU</span>}
        <span>Hovered: {stats.hoveredSplatIndex != null ? `splat ${stats.hoveredSplatIndex}` : '—'}</span>
      </div>
    </div>
  );
}
