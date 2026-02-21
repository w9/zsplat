export function LoadingOverlay() {
  return (
    <div className="absolute inset-0 flex flex-col justify-center items-center bg-black/60 backdrop-blur-md z-20">
      <div
        className="w-9 h-9 border-[3px] border-white/15 border-t-white rounded-full animate-zsplat-spin"
        aria-hidden
      />
      <span className="mt-4 text-sm opacity-70">Loading splats...</span>
    </div>
  );
}
