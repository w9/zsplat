import { useState, useCallback, useRef, useEffect } from 'react';
import { ZSplat } from 'zsplat';
import type { SplatStats } from 'zsplat';

export function App() {
  const [src, setSrc] = useState<string | File | null>(null);
  const [stats, setStats] = useState<SplatStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((file: File) => {
    setError(null);
    setLoading(true);
    setStats(null);
    setSrc(file);
  }, []);

  const handleLoad = useCallback((info: { numSplats: number }) => {
    setLoading(false);
    setStats((prev) => prev ? { ...prev, numSplats: info.numSplats } : {
      numSplats: info.numSplats, loadTimeMs: 0, fps: 0, gpuMemoryBytes: 0,
    });
  }, []);

  const handleError = useCallback((err: Error) => {
    setLoading(false);
    setError(err.message);
  }, []);

  const handleStats = useCallback((s: SplatStats) => {
    setStats(s);
  }, []);

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget === e.target) setDragging(false);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.ply')) handleFile(file);
  }, [handleFile]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'o' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        fileInputRef.current?.click();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const fileInput = (
    <input ref={fileInputRef} type="file" accept=".ply" style={{ display: 'none' }}
      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
  );

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}
      onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      {fileInput}

      {src ? (
        <ZSplat src={src} style={{ width: '100%', height: '100%', display: 'block' }}
          onLoad={handleLoad} onError={handleError} onStats={handleStats} />
      ) : (
        <div style={welcomeStyle}>
          <div style={{ fontSize: 48, fontWeight: 800, letterSpacing: -2, marginBottom: 8 }}>ZSplat</div>
          <div style={{ fontSize: 14, opacity: 0.5, marginBottom: 32, maxWidth: 400, textAlign: 'center', lineHeight: 1.5 }}>
            WebGPU Gaussian Splat Renderer. Load any PLY file and explore millions of splats in real time.
          </div>
          <button style={welcomeButtonStyle} onClick={openFilePicker}>Open a .ply file</button>
          <div style={{ marginTop: 16, fontSize: 12, opacity: 0.3 }}>or drag and drop anywhere</div>
        </div>
      )}

      <div style={topBarStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: -0.5 }}>ZSplat</span>
          <button style={buttonStyle} onClick={openFilePicker}>Open PLY</button>
          <span style={{ fontSize: 11, opacity: 0.4 }}>Ctrl+O</span>
        </div>
        {stats && (
          <div style={{ display: 'flex', gap: 16, fontSize: 12, opacity: 0.8 }}>
            <span>{fmt(stats.numSplats)} splats</span>
            <span>{stats.fps} fps</span>
            {stats.loadTimeMs > 0 && <span>{Math.round(stats.loadTimeMs)} ms load</span>}
            {stats.gpuMemoryBytes > 0 && <span>{fmtB(stats.gpuMemoryBytes)} GPU</span>}
          </div>
        )}
      </div>

      {loading && <div style={overlayStyle}><div style={spinnerStyle} /><span style={{ marginTop: 16, fontSize: 14, opacity: 0.7 }}>Loading splats...</span></div>}
      {error && <div style={overlayStyle}>
        <div style={{ color: '#ff6b6b', fontSize: 16, fontWeight: 600 }}>Error</div>
        <div style={{ marginTop: 8, fontSize: 13, maxWidth: 400, textAlign: 'center', opacity: 0.8 }}>{error}</div>
        <button style={{ ...buttonStyle, marginTop: 16 }} onClick={() => { setError(null); setSrc(null); }}>Back</button>
      </div>}
      {dragging && <div style={dragOverlayStyle}><div style={{ fontSize: 20, fontWeight: 600 }}>Drop .ply file here</div></div>}
      {src && <div style={hintStyle}>Left drag: rotate · Right drag / Shift+drag: pan · Scroll: zoom</div>}
      <style>{`@keyframes zsplat-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const topBarStyle: React.CSSProperties = { position: 'absolute', top: 0, left: 0, right: 0, padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0) 100%)', pointerEvents: 'auto', zIndex: 10 };
const buttonStyle: React.CSSProperties = { background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6, padding: '5px 14px', color: '#fff', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' };
const welcomeStyle: React.CSSProperties = { width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', background: 'radial-gradient(ellipse at center, #1a1a2e 0%, #0a0a0f 70%)' };
const welcomeButtonStyle: React.CSSProperties = { background: 'rgba(100,140,255,0.15)', border: '1px solid rgba(100,140,255,0.4)', borderRadius: 8, padding: '10px 28px', color: '#8ab4ff', fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
const overlayStyle: React.CSSProperties = { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', zIndex: 20 };
const dragOverlayStyle: React.CSSProperties = { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', background: 'rgba(60,120,255,0.12)', border: '3px dashed rgba(100,160,255,0.5)', zIndex: 30 };
const spinnerStyle: React.CSSProperties = { width: 36, height: 36, border: '3px solid rgba(255,255,255,0.15)', borderTopColor: '#fff', borderRadius: '50%', animation: 'zsplat-spin 0.8s linear infinite' };
const hintStyle: React.CSSProperties = { position: 'absolute', bottom: 12, left: 0, right: 0, textAlign: 'center', fontSize: 11, opacity: 0.3, pointerEvents: 'none', zIndex: 10 };

function fmt(n: number): string { return n >= 1e6 ? (n/1e6).toFixed(2)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'K' : String(n); }
function fmtB(b: number): string { return b >= 1073741824 ? (b/1073741824).toFixed(1)+' GB' : b >= 1048576 ? (b/1048576).toFixed(0)+' MB' : b >= 1024 ? (b/1024).toFixed(0)+' KB' : b+' B'; }
