/** Parsed PLY element */
export interface PlyProperty {
  name: string;
  type: string;
  byteSize: number;
}

export interface PlyElement {
  name: string;
  count: number;
  properties: PlyProperty[];
}

export interface PlyFile {
  format: string;
  elements: PlyElement[];
  headerByteLength: number;
  comment: string;
}

/** Decompressed/loaded splat data ready for GPU upload */
export interface SplatData {
  count: number;
  positions: Float32Array;   // count * 3  (x, y, z)
  rotations: Float32Array;   // count * 4  (qw, qx, qy, qz)
  scales: Float32Array;      // count * 3  (sx, sy, sz) — already exp'd
  colors: Float32Array;      // count * 4  (r, g, b, a)  — 0..1 linear
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
  };
}

/** Camera state */
export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  up?: [number, number, number];
  fov?: number;   // vertical FOV in degrees
  near?: number;
  far?: number;
}

/** Options for the SplatRenderer */
export interface RendererOptions {
  canvas: HTMLCanvasElement;
  antialias?: boolean;
}

/** Stats reported after loading / per frame */
export interface SplatStats {
  numSplats: number;
  loadTimeMs: number;
  fps: number;
  gpuMemoryBytes: number;
}

/** Props for the React <ZSplat> component */
export interface ZSplatProps {
  src: string | File;
  style?: React.CSSProperties;
  className?: string;
  camera?: Partial<CameraState>;
  onLoad?: (info: { numSplats: number }) => void;
  onError?: (err: Error) => void;
  onStats?: (stats: SplatStats) => void;
}
