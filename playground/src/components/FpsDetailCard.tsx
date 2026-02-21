import type { RunningStats } from '../utils/stats';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const FPS_ROW_CLASS = 'flex justify-between gap-4 text-xs leading-6 text-muted-foreground/90';

const buttonClass =
  'h-auto py-1 px-2.5 text-[12px] font-[inherit] bg-white/10 border-white/20 text-white hover:bg-white/15 dark:bg-white/10 dark:border-white/20 dark:text-white';

function copyStatsToClipboard(runningStats: RunningStats | null): void {
  if (!runningStats) return;
  const payload = {
    average: Math.round(runningStats.avg),
    minimum: Math.round(runningStats.min),
    maximum: Math.round(runningStats.max),
    '5th_percentile': Math.round(runningStats.p5),
    '25th_percentile': Math.round(runningStats.p25),
    median: Math.round(runningStats.p50),
    '75th_percentile': Math.round(runningStats.p75),
    '95th_percentile': Math.round(runningStats.p95),
  };
  void navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
}

export function FpsDetailCard({
  currentFps,
  runningStats,
  onReset,
  onClose,
}: {
  currentFps: number | null;
  runningStats: RunningStats | null;
  onReset: () => void;
  onClose?: () => void;
}) {
  return (
    <Card className="flex flex-col rounded-md bg-card/95 border-border shadow-md gap-0 py-0">
      <div className="flex flex-row items-center justify-between min-h-8 px-3 py-1.5 border-b border-border shrink-0">
        <span className="text-xs font-medium text-muted-foreground">FPS</span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-0.5 text-muted-foreground/70 hover:text-muted-foreground text-sm leading-none rounded cursor-pointer font-[inherit]"
            aria-label="Close"
          >
            ×
          </button>
        )}
      </div>
      <CardContent className="pt-2.5 pb-1.5 pl-3 pr-3 text-muted-foreground/90 shrink-0">
        <div className="grid gap-0.5">
          <div className={FPS_ROW_CLASS}>
            <span>FPS</span>
            <span className="tabular-nums">{currentFps != null ? currentFps : '—'}</span>
          </div>
          <div className={FPS_ROW_CLASS}>
            <span>Average</span>
            <span className="tabular-nums">{runningStats != null ? Math.round(runningStats.avg) : '—'}</span>
          </div>
          <div className={FPS_ROW_CLASS}>
            <span>Minimum</span>
            <span className="tabular-nums">{runningStats != null ? Math.round(runningStats.min) : '—'}</span>
          </div>
          <div className={FPS_ROW_CLASS}>
            <span>Maximum</span>
            <span className="tabular-nums">{runningStats != null ? Math.round(runningStats.max) : '—'}</span>
          </div>
          <div className={FPS_ROW_CLASS}>
            <span>5th percentile</span>
            <span className="tabular-nums">{runningStats != null ? Math.round(runningStats.p5) : '—'}</span>
          </div>
          <div className={FPS_ROW_CLASS}>
            <span>25th percentile</span>
            <span className="tabular-nums">{runningStats != null ? Math.round(runningStats.p25) : '—'}</span>
          </div>
          <div className={FPS_ROW_CLASS}>
            <span>Median</span>
            <span className="tabular-nums">{runningStats != null ? Math.round(runningStats.p50) : '—'}</span>
          </div>
          <div className={FPS_ROW_CLASS}>
            <span>75th percentile</span>
            <span className="tabular-nums">{runningStats != null ? Math.round(runningStats.p75) : '—'}</span>
          </div>
          <div className={FPS_ROW_CLASS}>
            <span>95th percentile</span>
            <span className="tabular-nums">{runningStats != null ? Math.round(runningStats.p95) : '—'}</span>
          </div>
        </div>
      </CardContent>
      <CardFooter className="pt-1 pb-2.5 pl-3 pr-3 flex flex-wrap gap-2 shrink-0">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={buttonClass}
          onClick={() => copyStatsToClipboard(runningStats)}
          disabled={!runningStats}
        >
          Copy
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={buttonClass}
          onClick={onReset}
        >
          Reset
        </Button>
      </CardFooter>
    </Card>
  );
}
