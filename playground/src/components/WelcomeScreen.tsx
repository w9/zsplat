import { Button } from '@/components/ui/button';

export function WelcomeScreen({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="w-full h-full flex flex-col justify-center items-center bg-[radial-gradient(ellipse_at_center,#1a1a2e_0%,#0a0a0f_70%)]">
      <div className="text-5xl font-extrabold tracking-tight mb-2" style={{ letterSpacing: -2 }}>
        ZSplat
      </div>
      <div className="text-sm text-muted-foreground mb-8 max-w-[400px] text-center leading-7">
        WebGPU Gaussian Splat Renderer. Load PLY or SPZ files and explore millions of splats in real time.
      </div>
      <Button
        type="button"
        size="lg"
        className="h-auto py-2.5 px-7 text-[15px] font-semibold rounded-lg bg-blue-500/15 border-blue-400/40 text-blue-200 hover:bg-blue-500/25 dark:bg-blue-500/15 dark:border-blue-400/40 dark:text-blue-200 dark:hover:bg-blue-500/25"
        onClick={onOpen}
      >
        Open PLY, SPZ or RAD
      </Button>
      <div className="mt-4 text-xs text-muted-foreground/70">or drag and drop .ply, .spz or .rad</div>
    </div>
  );
}
