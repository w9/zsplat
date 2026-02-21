export function DragOverlay() {
  return (
    <div className="absolute inset-0 flex flex-col justify-center items-center bg-sky-500/10 border-[3px] border-dashed border-sky-400/50 z-30">
      <div className="text-xl font-semibold">Drop .ply, .spz or .rad here</div>
    </div>
  );
}
