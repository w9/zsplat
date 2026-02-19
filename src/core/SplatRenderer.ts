import type { SplatData } from '../types';
import type { Sorter } from './Sorter';
import { WebGPUContext } from './WebGPUContext';
import { RadixSort } from './RadixSort';
import { StableRadixSort } from './StableRadixSort';
import { CpuSort } from './CpuSort';
import { Camera } from './Camera';
import preprocessWGSL from '../shaders/preprocess.wgsl?raw';
import renderWGSL from '../shaders/render.wgsl?raw';

const PREPROCESS_WG_SIZE = 256;
const SPLAT_FLOATS = 12;

export type SortMethod = 'cpu' | 'gpu' | 'gpu-unstable';

/**
 * Main Gaussian Splat renderer.
 * Pipeline: GPU preprocess → sort (CPU or GPU) → GPU render.
 */
export class SplatRenderer {
  private gpu = new WebGPUContext();
  camera: Camera;

  private preprocessPipeline!: GPUComputePipeline;
  private renderPipeline!: GPURenderPipeline;
  private sorter!: Sorter;
  private sortMethod: SortMethod;

  private positionBuf!: GPUBuffer;
  private rotationBuf!: GPUBuffer;
  private scaleBuf!: GPUBuffer;
  private colorBuf!: GPUBuffer;
  private shCoeffsBuf!: GPUBuffer;
  /** Set to false to disable SH bands 1-3 (view-dependent color). */
  shEnabled = true;
  /** Radians per frame for turntable auto-rotate. 0 = off. */
  turntableSpeed = 0;
  private hasSH = false;

  private splatOutBuf!: GPUBuffer;
  private preprocessUniformBuf!: GPUBuffer;

  // Kept for CpuSort
  private cpuPositions: Float32Array | null = null;

  private numSplats = 0;
  private frameId = 0;
  private running = false;
  private onFrame?: () => void;

  constructor(options?: { camera?: Camera; sort?: SortMethod }) {
    this.camera = options?.camera ?? new Camera();
    this.sortMethod = options?.sort ?? 'cpu';
  }

  async init(canvas: HTMLCanvasElement): Promise<void> {
    await this.gpu.init(canvas);
    const device = this.gpu.device;

    this.camera.attach(canvas);
    this.camera.setAspect(canvas.width / canvas.height);

    const preprocessModule = device.createShaderModule({ code: preprocessWGSL });
    this.preprocessPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: preprocessModule, entryPoint: 'main' },
    });

    const renderModule = device.createShaderModule({ code: renderWGSL });
    this.renderPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: renderModule, entryPoint: 'vs_main' },
      fragment: {
        module: renderModule,
        entryPoint: 'fs_main',
        targets: [{
          format: this.gpu.format,
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
    });

    // Uniform: 2*mat4(128) + vec2(8) + u32(4) + u32(4) + vec4(16) = 160 bytes
    this.preprocessUniformBuf = device.createBuffer({
      size: 160,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    switch (this.sortMethod) {
      case 'gpu':          this.sorter = new StableRadixSort(device); break;
      case 'gpu-unstable': this.sorter = new RadixSort(device); break;
      default:             this.sorter = new CpuSort(device); break;
    }
  }

  setScene(data: SplatData): void {
    const device = this.gpu.device;
    this.numSplats = data.count;

    this.positionBuf?.destroy();
    this.rotationBuf?.destroy();
    this.scaleBuf?.destroy();
    this.colorBuf?.destroy();
    this.shCoeffsBuf?.destroy();
    this.splatOutBuf?.destroy();

    this.positionBuf = this.createStorageBuffer(new Float32Array(data.positions));
    this.rotationBuf = this.createStorageBuffer(new Float32Array(data.rotations));
    this.scaleBuf = this.createStorageBuffer(new Float32Array(data.scales));
    this.colorBuf = this.createStorageBuffer(new Float32Array(data.colors));

    // SH coefficients (bands 1-3), or a dummy 1-element buffer if absent
    this.hasSH = !!data.shCoeffs;
    this.shCoeffsBuf = this.createStorageBuffer(
      data.shCoeffs ?? new Float32Array(45),
    );

    this.splatOutBuf = device.createBuffer({
      size: data.count * SPLAT_FLOATS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    this.sorter.ensureCapacity(data.count);

    // CpuSort needs CPU-side positions + view matrix each frame
    this.cpuPositions = new Float32Array(data.positions);
    if (this.sorter instanceof CpuSort) {
      this.sorter.positions = this.cpuPositions;
    }

    this.camera.fitToBounds(data.bounds.min, data.bounds.max);
  }

  resize(width: number, height: number): void {
    this.gpu.canvas.width = width;
    this.gpu.canvas.height = height;
    this.gpu.reconfigure();
    this.camera.setAspect(width / height);
  }

  startLoop(onFrame?: () => void): void {
    this.onFrame = onFrame;
    if (this.running) return;
    this.running = true;
    this.tick();
  }

  stopLoop(): void {
    this.running = false;
    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
      this.frameId = 0;
    }
  }

  renderFrame(): void {
    if (this.numSplats === 0) return;

    const device = this.gpu.device;
    this.camera.turntableSpeed = this.turntableSpeed;
    this.camera.update();

    // Feed CPU sort with current view matrix
    if (this.sorter instanceof CpuSort) {
      this.sorter.viewMatrix = this.camera.viewMatrix;
    }

    // Update preprocess uniforms (160 bytes)
    const uniformData = new ArrayBuffer(160);
    const f32 = new Float32Array(uniformData);
    const u32 = new Uint32Array(uniformData);
    f32.set(this.camera.viewMatrix, 0);       // offset 0:   view (64 bytes)
    f32.set(this.camera.projMatrix, 16);      // offset 64:  proj (64 bytes)
    f32[32] = this.gpu.canvas.width;          // offset 128: viewport.x
    f32[33] = this.gpu.canvas.height;         // offset 132: viewport.y
    u32[34] = this.numSplats;                 // offset 136: numSplats
    u32[35] = (this.hasSH && this.shEnabled) ? 1 : 0; // offset 140: hasSH
    const camPos = this.camera.position;
    f32[36] = camPos[0];                      // offset 144: cameraPos.x
    f32[37] = camPos[1];                      // offset 148: cameraPos.y
    f32[38] = camPos[2];                      // offset 152: cameraPos.z
    f32[39] = 0;                              // offset 156: padding
    device.queue.writeBuffer(this.preprocessUniformBuf, 0, uniformData);

    const encoder = device.createCommandEncoder();

    // ---- 1. Preprocess compute ----
    const sortInputs = this.sorter.getInputBuffers();
    const preprocessBG = device.createBindGroup({
      layout: this.preprocessPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.preprocessUniformBuf } },
        { binding: 1, resource: { buffer: this.positionBuf } },
        { binding: 2, resource: { buffer: this.rotationBuf } },
        { binding: 3, resource: { buffer: this.scaleBuf } },
        { binding: 4, resource: { buffer: this.colorBuf } },
        { binding: 5, resource: { buffer: this.shCoeffsBuf } },
        { binding: 6, resource: { buffer: this.splatOutBuf } },
        { binding: 7, resource: { buffer: sortInputs.keys } },
        { binding: 8, resource: { buffer: sortInputs.values } },
      ],
    });

    const numWGs = Math.ceil(this.numSplats / PREPROCESS_WG_SIZE);
    const cp = encoder.beginComputePass();
    cp.setPipeline(this.preprocessPipeline);
    cp.setBindGroup(0, preprocessBG);
    cp.dispatchWorkgroups(numWGs);
    cp.end();

    // ---- 2. Sort (GPU or CPU — same interface) ----
    const sortedValuesBuf = this.sorter.sort(encoder, this.numSplats);

    // ---- 3. Render ----
    const renderBG = device.createBindGroup({
      layout: this.renderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.splatOutBuf } },
        { binding: 1, resource: { buffer: sortedValuesBuf } },
      ],
    });

    const rp = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.gpu.context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    rp.setPipeline(this.renderPipeline);
    rp.setBindGroup(0, renderBG);
    rp.draw(6, this.numSplats, 0, 0);
    rp.end();

    device.queue.submit([encoder.finish()]);
  }

  dispose(): void {
    this.stopLoop();
    this.camera.detach();
    this.positionBuf?.destroy();
    this.rotationBuf?.destroy();
    this.scaleBuf?.destroy();
    this.colorBuf?.destroy();
    this.shCoeffsBuf?.destroy();
    this.splatOutBuf?.destroy();
    this.preprocessUniformBuf?.destroy();
    this.sorter?.destroy();
    this.gpu.dispose();
  }

  private tick = (): void => {
    if (!this.running) return;
    this.renderFrame();
    this.onFrame?.();
    this.frameId = requestAnimationFrame(this.tick);
  };

  private createStorageBuffer(data: Float32Array): GPUBuffer {
    const device = this.gpu.device;
    const buffer = device.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, data.byteLength);
    return buffer;
  }
}
