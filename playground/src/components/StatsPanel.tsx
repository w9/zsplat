import type { SplatStats } from 'zsplat';
import type { OpenDetail } from '../types';
import { fmt, fmtB } from '../utils/format';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function StatsPanel({
  stats,
  openDetail,
  onOpenDetailChange,
  className,
}: {
  stats: SplatStats | null;
  openDetail: OpenDetail;
  onOpenDetailChange: (v: OpenDetail) => void;
  className?: string;
}) {
  const baseClass = 'p-2.5 px-4 border-t border-border shrink-0';
  if (!stats) {
    return (
      <div className={cn(baseClass, className)}>
        <span className="text-xs text-muted-foreground">No stats</span>
      </div>
    );
  }
  const fpsOpen = openDetail === 'fps';
  return (
    <div className={cn(baseClass, className)}>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground/90">
        <span>{fmt(stats.numSplats)} splats</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            'h-auto py-1.5 px-3.5 text-[13px] font-[inherit] text-xs',
            'bg-white/10 border-white/20 text-white hover:bg-white/15 dark:bg-white/10 dark:border-white/20 dark:text-white',
            fpsOpen && 'bg-sky-500/20 border-sky-500/50 text-sky-300 hover:bg-sky-500/25'
          )}
          onClick={() => onOpenDetailChange(fpsOpen ? null : 'fps')}
        >
          {stats.fps} fps
        </Button>
        {stats.loadTimeMs > 0 && <span>{Math.round(stats.loadTimeMs)} ms load</span>}
        {stats.gpuMemoryBytes > 0 && <span>{fmtB(stats.gpuMemoryBytes)} GPU</span>}
        <span>Hovered: {stats.hoveredSplatIndex != null ? `splat ${stats.hoveredSplatIndex}` : '—'}</span>
      </div>
    </div>
  );
}
