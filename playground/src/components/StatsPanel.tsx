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
  const statClass = 'min-w-0 text-xs text-muted-foreground/90 tabular-nums truncate block';
  return (
    <div className={cn(baseClass, className)}>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground/90">
        <span className={cn(statClass, 'w-[5.5rem]')}>{fmt(stats.numSplats)} splats</span>
        {stats.loadTimeMs > 0 && (
          <span className={cn(statClass, 'w-[5rem]')}>{Math.round(stats.loadTimeMs)} ms load</span>
        )}
        {stats.gpuMemoryBytes > 0 && (
          <span className={cn(statClass, 'w-[4.5rem]')}>{fmtB(stats.gpuMemoryBytes)} GPU</span>
        )}
        {!fpsOpen && (
          <Button
            type="button"
            variant="link"
            className={cn(statClass, 'w-[4rem] h-auto p-0 font-normal underline-offset-2 hover:underline hover:text-foreground')}
            onClick={() => onOpenDetailChange('fps')}
          >
            {stats.fps} fps
          </Button>
        )}
        <span className={cn(statClass, 'w-[7rem]')}>
          Hovered: {stats.hoveredSplatIndex != null ? `splat ${stats.hoveredSplatIndex}` : '—'}
        </span>
      </div>
    </div>
  );
}
