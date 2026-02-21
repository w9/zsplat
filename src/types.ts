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
  /** SH bands 1-3 coefficients. 45 floats per splat (15 coefficients × 3 channels).
   *  Layout: [R0..R14, G0..G14, B0..B14] per splat. Omit if no SH data. */
  shCoeffs?: Float32Array;   // count * 45
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
  /** Splat index under cursor (from GPU pick). null when no hit or outside canvas. */
  hoveredSplatIndex?: number | null;
}

/** Props for the React <ZSplat> component */
export interface ZSplatProps {
  src: string | File;
  style?: React.CSSProperties;
  className?: string;
  camera?: Partial<CameraState>;
  /** Enable SH bands 1-3 for view-dependent color. Default true. */
  shEnabled?: boolean;
  /** Auto-rotate camera around target (turntable mode). Default false. */
  turntable?: boolean;
  onLoad?: (info: { numSplats: number }) => void;
  onError?: (err: Error) => void;
  onStats?: (stats: SplatStats) => void;
}
