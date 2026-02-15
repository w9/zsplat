import { useRef, useEffect, useState } from 'react';
import { SplatRenderer } from 'zsplat';
import type { SplatData } from 'zsplat';

/**
 * DEBUG: render a synthetic 10x10x10 grid of Gaussian splats
 * with random color, rotation, and scale to test the rendering pipeline.
 */
export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<SplatRenderer | null>(null);
  const [status, setStatus] = useState('Initializing...');

  useEffect(() => {
    let destroyed = false;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const run = async () => {
      try {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(canvas.clientWidth * dpr);
        canvas.height = Math.floor(canvas.clientHeight * dpr);

        const renderer = new SplatRenderer();
        rendererRef.current = renderer;
        await renderer.init(canvas);
        if (destroyed) { renderer.dispose(); return; }

        const scene = createGridScene(6, 1, 6);
        renderer.setScene(scene);
        renderer.startLoop();

        setStatus(`Grid scene: ${scene.count} splats. Drag to orbit, scroll to zoom.`);
      } catch (err) {
        setStatus(`ERROR: ${err instanceof Error ? err.message : err}`);
        console.error(err);
      }
    };

    run();
    return () => {
      destroyed = true;
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      <div style={{
        position: 'absolute', top: 10, left: 10, right: 10,
        padding: '8px 14px', background: 'rgba(0,0,0,0.75)', borderRadius: 6,
        fontSize: 13, color: '#ccc', fontFamily: 'monospace', zIndex: 10,
      }}>
        {status}
      </div>
    </div>
  );
}

/** Create a 3D grid of Gaussian splats with random properties. */
function createGridScene(nx: number, ny: number, nz: number): SplatData {
  const count = nx * ny * nz;
  const positions = new Float32Array(count * 3);
  const rotations = new Float32Array(count * 4);
  const scales = new Float32Array(count * 3);
  const colors = new Float32Array(count * 4);

  const spacing = 1.0;
  const offsetX = (nx - 1) * spacing * 0.5;
  const offsetY = (ny - 1) * spacing * 0.5;
  const offsetZ = (nz - 1) * spacing * 0.5;

  let rng = 12345; // simple seeded RNG for reproducibility
  const rand = () => {
    rng = (rng * 1103515245 + 12345) & 0x7fffffff;
    return rng / 0x7fffffff;
  };

  let i = 0;
  for (let ix = 0; ix < nx; ix++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let iz = 0; iz < nz; iz++) {
        // Position: centered grid
        positions[i * 3 + 0] = ix * spacing - offsetX;
        positions[i * 3 + 1] = iy * spacing - offsetY;
        positions[i * 3 + 2] = iz * spacing - offsetZ;

        // Random rotation (random unit quaternion)
        const u1 = rand(), u2 = rand(), u3 = rand();
        const sq1 = Math.sqrt(1 - u1);
        const sq2 = Math.sqrt(u1);
        const a1 = 2 * Math.PI * u2;
        const a2 = 2 * Math.PI * u3;
        rotations[i * 4 + 0] = sq1 * Math.sin(a1); // w
        rotations[i * 4 + 1] = sq1 * Math.cos(a1); // x
        rotations[i * 4 + 2] = sq2 * Math.sin(a2); // y
        rotations[i * 4 + 3] = sq2 * Math.cos(a2); // z

        // Random scale: each axis between 0.05 and 0.3
        scales[i * 3 + 0] = 0.05 + rand() * 0.25;
        scales[i * 3 + 1] = 0.05 + rand() * 0.25;
        scales[i * 3 + 2] = 0.05 + rand() * 0.25;

        // Random bright color, full opacity
        colors[i * 4 + 0] = 0.2 + rand() * 0.8;
        colors[i * 4 + 1] = 0.2 + rand() * 0.8;
        colors[i * 4 + 2] = 0.2 + rand() * 0.8;
        colors[i * 4 + 3] = 0.85;

        i++;
      }
    }
  }

  const half = Math.max(offsetX, offsetY, offsetZ) + 0.5;
  return {
    count,
    positions,
    rotations,
    scales,
    colors,
    bounds: {
      min: [-half, -half, -half],
      max: [half, half, half],
    },
  };
}
