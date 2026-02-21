import type { RunningStats } from '../utils/stats';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function FpsDetailCard({
  runningStats,
  onReset,
}: {
  runningStats: RunningStats | null;
  onReset: () => void;
}) {
  return (
    <Card className="bg-card/95 border-border shadow-lg gap-0 py-0">
      <CardContent className="pt-4 pb-2 text-xs text-muted-foreground/90 leading-7">
        {runningStats
          ? `avg ${Math.round(runningStats.avg)} · min ${Math.round(runningStats.min)} · max ${Math.round(runningStats.max)} · p5 ${Math.round(runningStats.p5)} · p25 ${Math.round(runningStats.p25)} · p50 ${Math.round(runningStats.p50)} · p75 ${Math.round(runningStats.p75)} · p95 ${Math.round(runningStats.p95)}`
          : 'No samples yet'}
      </CardContent>
      <CardFooter className="pt-0 pb-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-auto py-1.5 px-3.5 text-[13px] font-[inherit] bg-white/10 border-white/20 text-white hover:bg-white/15 dark:bg-white/10 dark:border-white/20 dark:text-white"
          onClick={onReset}
        >
          Reset
        </Button>
      </CardFooter>
    </Card>
  );
}
