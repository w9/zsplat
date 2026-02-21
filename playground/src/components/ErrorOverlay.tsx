export function ErrorOverlay({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <div className="absolute inset-0 flex flex-col justify-center items-center bg-black/60 backdrop-blur-md z-20">
      <div className="text-red-400 text-base font-semibold">Error</div>
      <div className="mt-2 text-[13px] max-w-[400px] text-center opacity-80">{message}</div>
      <button
        type="button"
        style={{ padding: '5px 14px' }}
        className="bg-white/10 border border-white/20 rounded-md text-white text-[13px] cursor-pointer font-[inherit] mt-4"
        onClick={onBack}
      >
        Back
      </button>
    </div>
  );
}
