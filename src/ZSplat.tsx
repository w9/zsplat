import { useEffect, useRef, useCallback } from 'react';
import type { ZSplatProps, SplatData, SplatStats } from './types';
import { SplatRenderer } from './core/SplatRenderer';
import { Camera } from './core/Camera';
import { parsePlyHeader, isCompressedPly } from './loaders/ply-parser';
import { loadCompressedPly } from './loaders/compressed-ply-loader';
import { loadStandardPly } from './loaders/standard-ply-loader';
import { loadSog, isSogFile } from './loaders/sog-loader';
import { loadSpz, isSpzFile } from './loaders/spz-loader';
// import { loadRad, isRadFile } from './loaders/rad-loader';

/**
 * React component that renders 3D Gaussian Splats via WebGPU.
 *
 * ```tsx
 * <ZSplat src="scene.compressed.ply" style={{ width: '100%', height: '100vh' }} />
 * ```
 */
const TURNTABLE_SPEED = 0.004; // radians per frame (~full rotation in ~25s at 60fps)

export function ZSplat({ src, style, className, camera, shEnabled = true, turntable = false, hoverEnabled = false, cameraControlMode = 'orbit', sortMethod = 'gpu-subgroup', onLoad, onError, onStats }: ZSplatProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<SplatRenderer | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const statsRef = useRef<SplatStats>({ numSplats: 0, loadTimeMs: 0, fps: 0, gpuMemoryBytes: 0 });
  const frameTimesRef = useRef<number[]>([]);

  // Sync shEnabled prop to renderer
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.shEnabled = shEnabled;
    }
  }, [shEnabled]);

  // Sync turntable prop to renderer
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.turntableSpeed = turntable ? TURNTABLE_SPEED : 0;
    }
  }, [turntable]);

  // Sync hoverEnabled prop to renderer (pick pass disabled when false)
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.pickEnabled = hoverEnabled;
    }
  }, [hoverEnabled]);

  // Sync camera control mode (orbit vs fly)
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setCameraControlMode(cameraControlMode);
    }
  }, [cameraControlMode]);

  const handleError = useCallback(
    (err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error('[ZSplat]', error);
      onError?.(error);
    },
    [onError],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let destroyed = false;

    const init = async () => {
      try {
        const cam = new Camera({
          position: camera?.position,
          target: camera?.target,
          fov: camera?.fov,
          near: camera?.near,
          far: camera?.far,
        });

        const renderer = new SplatRenderer({ camera: cam, sort: sortMethod });
        renderer.turntableSpeed = turntable ? TURNTABLE_SPEED : 0;
        renderer.shEnabled = shEnabled;
        rendererRef.current = renderer;

        // Size the canvas to CSS layout dimensions
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
        canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr));

        await renderer.init(canvas);

        if (destroyed) {
          renderer.dispose();
          return;
        }

        // Load splat data (PLY or SOG)
        const loadStart = performance.now();
        const splatData = await loadSplatData(src);

        if (destroyed) {
          renderer.dispose();
          return;
        }

        renderer.setScene(splatData);

        const loadTime = performance.now() - loadStart;
        statsRef.current.numSplats = splatData.count;
        statsRef.current.loadTimeMs = loadTime;
        statsRef.current.gpuMemoryBytes = estimateGpuMemory(splatData.count);

        onLoad?.({ numSplats: splatData.count, splatData });

        // Start render loop with FPS tracking and pick readback stats (e.g. hoveredSplatIndex)
        renderer.startLoop(
          () => {
            const now = performance.now();
            const times = frameTimesRef.current;
            times.push(now);
            while (times.length > 60) times.shift();
            if (times.length >= 2) {
              const elapsed = times[times.length - 1] - times[0];
              statsRef.current.fps = Math.round(((times.length - 1) / elapsed) * 1000);
            }
            onStats?.({ ...statsRef.current });
          },
          (partial) => {
            statsRef.current = { ...statsRef.current, ...partial };
            onStats?.(statsRef.current);
          },
        );
        renderer.pickEnabled = hoverEnabled;

        // Set up resize observer
        const ro = new ResizeObserver(() => {
          if (destroyed) return;
          const dpr = window.devicePixelRatio || 1;
          const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
          const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
          renderer.resize(w, h);
        });
        ro.observe(canvas);
        roRef.current = ro;
      } catch (err) {
        handleError(err);
      }
    };

    init();

    return () => {
      destroyed = true;
      roRef.current?.disconnect();
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, sortMethod]);

  return <canvas ref={canvasRef} className={className} style={style} />;
}

// ---- helpers ----

async function loadSplatData(src: string | File): Promise<SplatData> {
  // SOG format (meta.json URL)
  if (typeof src === 'string' && isSogFile(src)) {
    return loadSog(src);
  }

  let buffer: ArrayBuffer;
  const fileLike =
    src instanceof File ||
    (typeof src === 'object' && src !== null && typeof (src as File).arrayBuffer === 'function');
  if (fileLike) {
    buffer = await (src as File).arrayBuffer();
  } else {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10 * 60 * 1000); // 10 min for large files
    try {
      const resp = await fetch(src, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!resp.ok) throw new Error(`Failed to fetch ${src}: ${resp.status}`);
      buffer = await resp.arrayBuffer();
    } catch (e) {
      clearTimeout(timeoutId);
      const isBlob = typeof src === 'string' && src.startsWith('blob:');
      const hint = isBlob
        ? ' Pass the File object from the file picker instead of URL.createObjectURL(file).'
        : ' For large files (e.g. >100MB), open via the file picker and pass the File directly.';
      const msg =
        e instanceof Error && e.name === 'AbortError'
          ? `Request timed out loading ${src}.${hint}`
          : e instanceof Error
            ? `${e.message}.${hint}`
            : 'Failed to load file.';
      throw new Error(msg);
    }
  }

  const name = fileLike ? (src as File).name : (src as string);
  if (isSpzFile(name)) {
    return loadSpz(buffer);
  }
  const ply = parsePlyHeader(buffer);
  if (isCompressedPly(ply)) {
    return loadCompressedPly(buffer, ply);
  }
  return loadStandardPly(buffer, ply);
}

function estimateGpuMemory(n: number): number {
  // positions(N*3*4) + rotations(N*4*4) + scales(N*3*4) + colors(N*4*4)
  // + splatOut(N*12*4) + sort buffers(N*4*4)
  return n * (12 + 16 + 12 + 16 + 48 + 16);
}
