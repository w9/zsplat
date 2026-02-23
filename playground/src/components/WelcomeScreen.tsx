import { Button } from '@/components/ui/button';

export function WelcomeScreen({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="w-full h-full flex flex-col justify-center items-center bg-[radial-gradient(ellipse_at_center,#1a1a2e_0%,#0a0a0f_70%)]">
      <div className="text-5xl font-extrabold tracking-tight mb-2" style={{ letterSpacing: -2 }}>
        ZSplat
      </div>
      <div className="text-sm text-muted-foreground max-w-[500px] text-center leading-7">
        3DGS rendering accelerated by WebGPU radix sort (and nothing else)
      </div>
        <Button
          type="button"
          size="lg"
          className="mt-5 h-auto py-2.5 px-7 text-[15px] font-semibold rounded-lg"
          onClick={onOpen}
        >
          Open PLY or SPZ
        </Button>
      <div className="mt-3 text-xs text-muted-foreground/70">or drag and drop</div>
    </div>
  );
}
