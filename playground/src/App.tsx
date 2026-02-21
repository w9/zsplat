import { useState, useCallback, useRef, useEffect } from 'react';
import { ZSplat } from 'zsplat';
import type { SplatStats } from 'zsplat';
import type { OpenDetail } from './types';
import { FPS_SAMPLES_CAP, computeRunningStats } from './utils/stats';
import { LeftColumn } from './components/LeftColumn';
import { WelcomeScreen } from './components/WelcomeScreen';
import { LoadingOverlay } from './components/LoadingOverlay';
import { ErrorOverlay } from './components/ErrorOverlay';
import { DragOverlay } from './components/DragOverlay';

export function App() {
  const [src, setSrc] = useState<string | File | null>(null);
  const [stats, setStats] = useState<SplatStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [shEnabled, setShEnabled] = useState(true);
  const [turntable, setTurntable] = useState(false);
  const [openDetail, setOpenDetail] = useState<OpenDetail>(null);
  const [runningStats, setRunningStats] = useState<ReturnType<typeof computeRunningStats>>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fpsSamplesRef = useRef<number[]>([]);
  const openDetailRef = useRef<OpenDetail>(null);
  openDetailRef.current = openDetail;

  const handleFile = useCallback((file: File) => {
    setError(null);
    setLoading(true);
    setStats(null);
    setRunningStats(null);
    fpsSamplesRef.current = [];
    setSrc(file);
  }, []);

  const handleLoad = useCallback((info: { numSplats: number }) => {
    setLoading(false);
    setStats((prev) =>
      prev ? { ...prev, numSplats: info.numSplats } : { numSplats: info.numSplats, loadTimeMs: 0, fps: 0, gpuMemoryBytes: 0 },
    );
  }, []);

  const handleError = useCallback((err: Error) => {
    setLoading(false);
    setError(err.message);
  }, []);

  const handleStats = useCallback((s: SplatStats) => {
    setStats(s);
    if (openDetailRef.current === 'fps' && s.fps > 0) {
      const buf = fpsSamplesRef.current;
      buf.push(s.fps);
      if (buf.length > FPS_SAMPLES_CAP) buf.shift();
    }
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
    const name = file?.name?.toLowerCase() ?? '';
    if (file && (name.endsWith('.ply') || name.endsWith('.spz') || name.endsWith('.rad'))) handleFile(file);
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

  useEffect(() => {
    if (openDetail !== 'fps') return;
    const tick = () => setRunningStats(computeRunningStats(fpsSamplesRef.current));
    tick();
    const interval = setInterval(tick, 500);
    return () => clearInterval(interval);
  }, [openDetail]);

  const handleResetRunningStats = useCallback(() => {
    fpsSamplesRef.current = [];
    setRunningStats(null);
  }, []);

  return (
    <div
      className="w-full h-full flex flex-row overflow-hidden"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".ply,.spz,.rad"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = '';
        }}
      />

      <LeftColumn
        src={src}
        stats={stats}
        openDetail={openDetail}
        runningStats={runningStats}
        setOpenDetail={setOpenDetail}
        handleResetRunningStats={handleResetRunningStats}
        openFilePicker={openFilePicker}
        shEnabled={shEnabled}
        setShEnabled={setShEnabled}
        turntable={turntable}
        setTurntable={setTurntable}
      />

      <div className="flex-1 min-w-0 relative flex flex-col">
        {src ? (
          <ZSplat
            src={src}
            className="w-full h-full block"
            shEnabled={shEnabled}
            turntable={turntable}
            onLoad={handleLoad}
            onError={handleError}
            onStats={handleStats}
          />
        ) : (
          <WelcomeScreen onOpen={openFilePicker} />
        )}

        {loading && <LoadingOverlay />}
        {error && <ErrorOverlay message={error} onBack={() => { setError(null); setSrc(null); }} />}
        {dragging && <DragOverlay />}
        {src && (
          <div className="absolute bottom-3 left-0 right-0 text-center text-[11px] text-muted-foreground pointer-events-none z-10">
            Left drag: rotate · Right drag / Shift+drag: pan · Scroll: zoom
          </div>
        )}
      </div>
    </div>
  );
}
