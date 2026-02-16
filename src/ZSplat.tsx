import { useEffect, useRef, useCallback } from 'react';
import type { ZSplatProps, SplatData, SplatStats } from './types';
import { SplatRenderer } from './core/SplatRenderer';
import { Camera } from './core/Camera';
import { parsePlyHeader, isCompressedPly } from './loaders/ply-parser';
import { loadCompressedPly } from './loaders/compressed-ply-loader';
import { loadStandardPly } from './loaders/standard-ply-loader';

/**
 * React component that renders 3D Gaussian Splats via WebGPU.
 *
 * ```tsx
 * <ZSplat src="scene.compressed.ply" style={{ width: '100%', height: '100vh' }} />
 * ```
 */
export function ZSplat({ src, style, className, camera, onLoad, onError, onStats }: ZSplatProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<SplatRenderer | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const statsRef = useRef<SplatStats>({ numSplats: 0, loadTimeMs: 0, fps: 0, gpuMemoryBytes: 0 });
  const frameTimesRef = useRef<number[]>([]);

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

        const renderer = new SplatRenderer({ camera: cam, sort: 'gpu' });
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

        // Load the PLY
        const loadStart = performance.now();
        const buffer = await loadSource(src);

        if (destroyed) {
          renderer.dispose();
          return;
        }

        const splatData = parseSplatData(buffer);

        renderer.setScene(splatData);

        const loadTime = performance.now() - loadStart;
        statsRef.current.numSplats = splatData.count;
        statsRef.current.loadTimeMs = loadTime;
        statsRef.current.gpuMemoryBytes = estimateGpuMemory(splatData.count);

        onLoad?.({ numSplats: splatData.count });

        // Start render loop with FPS tracking
        renderer.startLoop(() => {
          const now = performance.now();
          const times = frameTimesRef.current;
          times.push(now);
          // Keep last 60 frames
          while (times.length > 60) times.shift();
          if (times.length >= 2) {
            const elapsed = times[times.length - 1] - times[0];
            statsRef.current.fps = Math.round(((times.length - 1) / elapsed) * 1000);
          }
          onStats?.({ ...statsRef.current });
        });

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
  }, [src]);

  return <canvas ref={canvasRef} className={className} style={style} />;
}

// ---- helpers ----

async function loadSource(src: string | File): Promise<ArrayBuffer> {
  if (src instanceof File) {
    return src.arrayBuffer();
  }
  const resp = await fetch(src);
  if (!resp.ok) throw new Error(`Failed to fetch ${src}: ${resp.status}`);
  return resp.arrayBuffer();
}

function parseSplatData(buffer: ArrayBuffer): SplatData {
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
