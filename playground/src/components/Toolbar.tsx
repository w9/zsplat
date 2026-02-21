import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function Toolbar({
  onOpen,
  hasScene,
  shEnabled,
  onShChange,
  turntable,
  onTurntableChange,
}: {
  onOpen: () => void;
  hasScene: boolean;
  shEnabled: boolean;
  onShChange: (v: boolean) => void;
  turntable: boolean;
  onTurntableChange: (v: boolean) => void;
}) {
  return (
    <div className="p-2.5 px-4 flex flex-wrap items-center gap-3 shrink-0">
      <span className="font-bold text-base tracking-tight">ZSplat</span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn(
          'h-auto py-1.5 px-3.5 text-[13px] font-[inherit]',
          'bg-white/10 border-white/20 text-white hover:bg-white/15 hover:text-white dark:bg-white/10 dark:border-white/20 dark:text-white dark:hover:bg-white/15'
        )}
        onClick={onOpen}
      >
        Open PLY/SPZ/RAD
      </Button>
      <span className="text-[11px] text-muted-foreground">Ctrl+O</span>
      {hasScene && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            'h-auto py-1.5 px-3.5 text-[13px] font-[inherit]',
            shEnabled
              ? 'bg-green-500/15 border-green-500/40 text-green-400 hover:bg-green-500/20'
              : 'bg-red-500/15 border-red-500/40 text-red-400 hover:bg-red-500/20'
          )}
          onClick={() => onShChange(!shEnabled)}
        >
          SH {shEnabled ? 'ON' : 'OFF'}
        </Button>
      )}
      {hasScene && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            'h-auto py-1.5 px-3.5 text-[13px] font-[inherit]',
            turntable && 'bg-sky-500/20 border-sky-500/50 text-sky-300 hover:bg-sky-500/25'
          )}
          onClick={() => onTurntableChange(!turntable)}
        >
          Turntable {turntable ? 'ON' : 'OFF'}
        </Button>
      )}
    </div>
  );
}
