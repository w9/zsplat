import { Button } from '@/components/ui/button';

export function ErrorOverlay({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <div className="absolute inset-0 flex flex-col justify-center items-center bg-black/60 backdrop-blur-md z-20">
      <div className="text-destructive text-base font-semibold">Error</div>
      <div className="mt-2 text-[13px] max-w-[400px] text-center text-muted-foreground/80 leading-7">
        {message}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-6 h-auto py-1.5 px-3.5 text-[13px] font-[inherit] bg-white/10 border-white/20 text-white hover:bg-white/15 dark:bg-white/10 dark:border-white/20 dark:text-white"
        onClick={onBack}
      >
        Back
      </Button>
    </div>
  );
}
