import { useState, useCallback, useRef, useEffect } from 'react';
import { ZSplat } from 'zsplat';
import type { SplatData, SplatStats, SortMethod } from 'zsplat';
import type { OpenDetail } from './types';
import { FPS_SAMPLES_CAP, computeRunningStats } from './utils/stats';
import { TopBar } from './components/TopBar';
import { BottomBar } from './components/BottomBar';
import { DetailPanels } from './components/DetailPanels';
import { WelcomeScreen } from './components/WelcomeScreen';
import { LoadingOverlay } from './components/LoadingOverlay';
import { ErrorOverlay } from './components/ErrorOverlay';
import { DragOverlay } from './components/DragOverlay';

type HmrSavedState = {
  src: string | File | null;
  stats: SplatStats | null;
  shEnabled: boolean;
  turntable: boolean;
};

const hmrState: HmrSavedState = {
  src: null,
  stats: null,
  shEnabled: true,
  turntable: false,
};

const HMR_DEBUG = import.meta.env.DEV && typeof window !== 'undefined';

if (import.meta.hot) {
  import.meta.hot.dispose((data: { savedState?: HmrSavedState }) => {
    data.savedState = { ...hmrState };
    if (HMR_DEBUG) {
      console.log('[HMR] dispose: saving state', {
        hasSrc: hmrState.src != null,
        srcType: hmrState.src instanceof File ? 'File' : typeof hmrState.src,
        shEnabled: hmrState.shEnabled,
        turntable: hmrState.turntable,
      });
    }
  });
}

function getSavedState(): HmrSavedState | undefined {
  const saved = import.meta.hot?.data?.savedState as HmrSavedState | undefined;
  if (HMR_DEBUG && saved) {
    console.log('[HMR] getSavedState: restoring', {
      hasSrc: saved.src != null,
      srcType: saved.src instanceof File ? 'File' : typeof saved.src,
    });
  }
  return saved;
}

export function App() {
  const [src, setSrc] = useState<string | File | null>(() => getSavedState()?.src ?? null);
  const [stats, setStats] = useState<SplatStats | null>(() => getSavedState()?.stats ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [shEnabled, setShEnabled] = useState(() => getSavedState()?.shEnabled ?? true);
  const [turntable, setTurntable] = useState(() => getSavedState()?.turntable ?? false);
  const [hoverEnabled, setHoverEnabled] = useState(false);
  const [cameraControlMode, setCameraControlMode] = useState<'orbit' | 'fly'>('orbit');
  const [sortMode, setSortMode] = useState<SortMethod>('gpu-subgroup');
  const [splatData, setSplatData] = useState<SplatData | null>(null);
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
    setSplatData(null);
    setRunningStats(null);
    fpsSamplesRef.current = [];
    setSrc(file);
  }, []);

  const handleLoad = useCallback((info: { numSplats: number; splatData?: SplatData }) => {
    setLoading(false);
    setSplatData(info.splatData ?? null);
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
    if (file && (name.endsWith('.ply') || name.endsWith('.spz'))) handleFile(file);
  }, [handleFile]);

  useEffect(() => {
    hmrState.src = src;
    hmrState.stats = stats;
    hmrState.shEnabled = shEnabled;
    hmrState.turntable = turntable;
  }, [src, stats, shEnabled, turntable]);

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
      className="w-screen h-screen relative overflow-hidden"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".ply,.spz"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = '';
        }}
      />

      <div className="absolute inset-0 w-full h-full">
        {src ? (
          <ZSplat
            src={src}
            className="w-full h-full block"
            shEnabled={shEnabled}
            turntable={turntable}
            hoverEnabled={hoverEnabled}
            cameraControlMode={cameraControlMode}
            sortMethod={sortMode}
            onLoad={handleLoad}
            onError={handleError}
            onStats={handleStats}
          />
        ) : (
          <WelcomeScreen onOpen={openFilePicker} />
        )}
      </div>

      <TopBar
        onOpen={openFilePicker}
        hasScene={!!src}
        shEnabled={shEnabled}
        onShChange={setShEnabled}
        turntable={turntable}
        onTurntableChange={setTurntable}
        hoverEnabled={hoverEnabled}
        onHoverChange={setHoverEnabled}
        cameraControlMode={cameraControlMode}
        onCameraControlModeChange={setCameraControlMode}
        sortMode={sortMode}
        onSortModeChange={setSortMode}
      />

      <BottomBar
        stats={stats}
        openDetail={openDetail}
        onOpenDetailChange={setOpenDetail}
        hasScene={!!src}
        cameraControlMode={cameraControlMode}
      />

      <DetailPanels
        openDetail={openDetail}
        stats={stats}
        runningStats={runningStats}
        hoverEnabled={hoverEnabled}
        splatData={splatData}
        onReset={handleResetRunningStats}
        onOpenDetailChange={setOpenDetail}
        onCloseHover={() => setHoverEnabled(false)}
      />

      {loading && <LoadingOverlay />}
      {error && <ErrorOverlay message={error} onBack={() => { setError(null); setSrc(null); }} />}
      {dragging && <DragOverlay />}
    </div>
  );
}
