export function WelcomeScreen({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="w-full h-full flex flex-col justify-center items-center bg-[radial-gradient(ellipse_at_center,#1a1a2e_0%,#0a0a0f_70%)]">
      <div className="text-5xl font-extrabold mb-2" style={{ letterSpacing: -2 }}>
        ZSplat
      </div>
      <div className="text-sm opacity-50 mb-8 max-w-[400px] text-center leading-normal">
        WebGPU Gaussian Splat Renderer. Load PLY or SPZ files and explore millions of splats in real time.
      </div>
      {/* welcomeButtonStyle: padding 10px 28px so it wins over * { padding:0 } in index.html */}
      <button
        type="button"
        style={{ padding: '10px 28px' }}
        className="bg-blue-500/15 border border-blue-400/40 rounded-lg text-blue-200 text-[15px] font-semibold cursor-pointer font-[inherit]"
        onClick={onOpen}
      >
        Open PLY, SPZ or RAD
      </button>
      <div className="mt-4 text-xs opacity-30">or drag and drop .ply, .spz or .rad</div>
    </div>
  );
}
