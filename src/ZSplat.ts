import { WebGpuSplatRenderer } from "./renderer/WebGpuSplatRenderer";
import { loadCompressedPly } from "./ply/CompressedPlyLoader";
import { Mat4, mat4Create, mat4LookAt, mat4Multiply, mat4Perspective } from "./math/mat4";

export type ZSplatCamera = {
  eye: [number, number, number];
  target: [number, number, number];
  up?: [number, number, number];
  fovY?: number;
  near?: number;
  far?: number;
};

export type ZSplatOptions = {
  sizeScale?: number;
  backgroundColor?: [number, number, number, number];
};

export type ZSplatStats = {
  splatCount: number;
  lastLoadMs: number;
};

const DEFAULT_UP: [number, number, number] = [0, 1, 0];

export class ZSplat {
  private renderer: WebGpuSplatRenderer;
  private canvas: HTMLCanvasElement | null = null;
  private view = mat4Create();
  private proj = mat4Create();
  private viewProj = mat4Create();
  private camera: ZSplatCamera = {
    eye: [0, 0, 3],
    target: [0, 0, 0],
    up: DEFAULT_UP,
    fovY: Math.PI / 3,
    near: 0.01,
    far: 1000
  };
  private sizeScale: number;
  private stats: ZSplatStats = {
    splatCount: 0,
    lastLoadMs: 0
  };

  constructor(options: ZSplatOptions = {}) {
    this.sizeScale = options.sizeScale ?? 1.0;
    this.renderer = new WebGpuSplatRenderer({
      sizeScale: this.sizeScale,
      backgroundColor: options.backgroundColor
    });
  }

  async init(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    await this.renderer.init(canvas);
    this.resize();
  }

  async loadPly(buffer: ArrayBuffer) {
    const start = performance.now();
    const data = loadCompressedPly(buffer);
    this.stats.splatCount = data.count;
    this.renderer.uploadSplats(data);
    this.setCamera(this.defaultCameraFromBounds(data.bounds));
    this.stats.lastLoadMs = performance.now() - start;
  }

  setCamera(camera: ZSplatCamera) {
    this.camera = {
      ...camera,
      up: camera.up ?? DEFAULT_UP,
      fovY: camera.fovY ?? this.camera.fovY,
      near: camera.near ?? this.camera.near,
      far: camera.far ?? this.camera.far
    };
    this.updateViewProjection();
  }

  getCamera() {
    return { ...this.camera };
  }

  resize() {
    if (!this.canvas) {
      return;
    }
    const { clientWidth, clientHeight } = this.canvas;
    const width = Math.max(1, Math.floor(clientWidth * window.devicePixelRatio));
    const height = Math.max(1, Math.floor(clientHeight * window.devicePixelRatio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.updateViewProjection();
    this.renderer.resize(width, height);
  }

  render() {
    this.renderer.render(this.viewProj);
  }

  getStats(): ZSplatStats {
    return { ...this.stats };
  }

  dispose() {
    this.renderer.dispose();
  }

  private updateViewProjection() {
    if (!this.canvas) {
      return;
    }
    const aspect = this.canvas.width / this.canvas.height;
    mat4LookAt(this.view, this.camera.eye, this.camera.target, this.camera.up ?? DEFAULT_UP);
    mat4Perspective(this.proj, this.camera.fovY ?? Math.PI / 3, aspect, this.camera.near ?? 0.01, this.camera.far ?? 1000);
    mat4Multiply(this.viewProj, this.proj, this.view);
  }

  private defaultCameraFromBounds(bounds: { min: [number, number, number]; max: [number, number, number] }): ZSplatCamera {
    const center: [number, number, number] = [
      (bounds.min[0] + bounds.max[0]) * 0.5,
      (bounds.min[1] + bounds.max[1]) * 0.5,
      (bounds.min[2] + bounds.max[2]) * 0.5
    ];
    const extent: [number, number, number] = [
      bounds.max[0] - bounds.min[0],
      bounds.max[1] - bounds.min[1],
      bounds.max[2] - bounds.min[2]
    ];
    const radius = Math.max(extent[0], extent[1], extent[2]) * 0.6 + 0.01;
    return {
      eye: [center[0], center[1], center[2] + radius * 2.5],
      target: center,
      up: DEFAULT_UP,
      near: Math.max(0.01, radius / 100),
      far: radius * 20,
      fovY: Math.PI / 3
    };
  }
}
