/* Inline padding so * { padding:0 } in index.html doesn't strip it */
const buttonStyle = { padding: '5px 14px' };
const buttonBase =
  'bg-white/10 border border-white/20 rounded-md text-white text-[13px] cursor-pointer font-[inherit]';

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
    <div className="p-2.5 px-4 flex flex-wrap items-center gap-3 border-b border-white/[0.08] shrink-0">
      <span className="font-bold text-base tracking-tight">ZSplat</span>
      <button type="button" style={buttonStyle} className={buttonBase} onClick={onOpen}>
        Open PLY/SPZ/RAD
      </button>
      <span className="text-[11px] opacity-40">Ctrl+O</span>
      {hasScene && (
        <button
          type="button"
          style={buttonStyle}
          className={`${buttonBase} ${shEnabled ? 'bg-green-500/15 border-green-500/40 text-green-400' : 'bg-red-500/15 border-red-500/40 text-red-400'}`}
          onClick={() => onShChange(!shEnabled)}
        >
          SH {shEnabled ? 'ON' : 'OFF'}
        </button>
      )}
      {hasScene && (
        <button
          type="button"
          style={buttonStyle}
          className={`${buttonBase} ${turntable ? 'bg-sky-500/20 border-sky-500/50 text-sky-300' : ''}`}
          onClick={() => onTurntableChange(!turntable)}
        >
          Turntable {turntable ? 'ON' : 'OFF'}
        </button>
      )}
    </div>
  );
}
