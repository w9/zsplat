import type { SplatData, SplatStats } from '../types';
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
const PICK_READBACK_BYTES_PER_ROW = 256; // WebGPU requires bytesPerRow multiple of 256
const PICK_NO_HIT = 0xffffffff;

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
  private pickPipeline!: GPURenderPipeline;
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
  /** Called when pick readback completes; merges into stats (e.g. hoveredSplatIndex). */
  private onStatsPartial?: (partial: Partial<SplatStats>) => void;

  private pickTexture: GPUTexture | null = null;
  private pickTextureWidth = 0;
  private pickTextureHeight = 0;
  private readbackBuf!: GPUBuffer;
  private readbackPending = false;
  private pickX = -1;
  private pickY = -1;
  private onPointerMoveBound = this.handlePointerMove.bind(this);

  private _pickEnabled = false;
  /** When false, no pick pass or texture; pointer move does not update pick. Default false. */
  get pickEnabled(): boolean {
    return this._pickEnabled;
  }
  set pickEnabled(value: boolean) {
    if (this._pickEnabled === value) return;
    this._pickEnabled = value;
    if (!value) {
      this.pickX = -1;
      this.onStatsPartial?.({ hoveredSplatIndex: null });
    }
  }

  constructor(options?: { camera?: Camera; sort?: SortMethod }) {
    this.camera = options?.camera ?? new Camera();
    this.sortMethod = options?.sort ?? 'cpu';
  }

  setCameraControlMode(mode: 'orbit' | 'fly'): void {
    this.camera.setControlMode(mode);
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

    this.pickPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: renderModule, entryPoint: 'vs_main' },
      fragment: {
        module: renderModule,
        entryPoint: 'fs_pick',
        targets: [{ format: 'r32uint' }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
    });

    this.readbackBuf = device.createBuffer({
      size: PICK_READBACK_BYTES_PER_ROW,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    this.gpu.canvas.addEventListener('pointermove', this.onPointerMoveBound);

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

  startLoop(onFrame?: () => void, onStatsPartial?: (partial: Partial<SplatStats>) => void): void {
    this.onFrame = onFrame;
    this.onStatsPartial = onStatsPartial;
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

    // ---- 4. Pick pass (splat index into R32Uint texture) ----
    let didCopy = false;
    if (this._pickEnabled) this.ensurePickTexture();
    if (this.pickTexture && this.pickX >= 0 && !this.readbackPending) {
      const pickBG = device.createBindGroup({
        layout: this.pickPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.splatOutBuf } },
          { binding: 1, resource: { buffer: sortedValuesBuf } },
        ],
      });
      const pickRp = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.pickTexture.createView(),
          clearValue: { r: PICK_NO_HIT, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      pickRp.setPipeline(this.pickPipeline);
      pickRp.setBindGroup(0, pickBG);
      pickRp.draw(6, this.numSplats, 0, 0);
      pickRp.end();

      encoder.copyTextureToBuffer(
        { texture: this.pickTexture, origin: [this.pickX, this.pickY, 0] },
        {
          buffer: this.readbackBuf,
          bytesPerRow: PICK_READBACK_BYTES_PER_ROW,
          rowsPerImage: 1,
        },
        { width: 1, height: 1, depthOrArrayLayers: 1 },
      );
      this.readbackPending = true;
      didCopy = true;
    }

    device.queue.submit([encoder.finish()]);

    if (didCopy) {
      this.readbackBuf.mapAsync(GPUMapMode.READ).then(() => {
        const idx = new Uint32Array(this.readbackBuf.getMappedRange(0, 4))[0];
        this.readbackBuf.unmap();
        this.readbackPending = false;
        const hoveredSplatIndex = idx === PICK_NO_HIT ? null : idx;
        this.onStatsPartial?.({ hoveredSplatIndex });
      });
    }
  }

  dispose(): void {
    this.stopLoop();
    this.gpu.canvas.removeEventListener('pointermove', this.onPointerMoveBound);
    this.camera.detach();
    this.pickTexture?.destroy();
    this.pickTexture = null;
    this.readbackBuf?.destroy();
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

  private handlePointerMove(e: PointerEvent): void {
    if (!this._pickEnabled) {
      this.pickX = -1;
      return;
    }
    const canvas = this.gpu.canvas;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      this.pickX = -1;
      return;
    }
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    if (x >= 0 && x < canvas.width && y >= 0 && y < canvas.height) {
      this.pickX = Math.min(Math.floor(x), canvas.width - 1);
      this.pickY = Math.min(Math.floor(y), canvas.height - 1);
    } else {
      this.pickX = -1;
    }
  }

  private ensurePickTexture(): void {
    const w = this.gpu.canvas.width;
    const h = this.gpu.canvas.height;
    if (this.pickTexture && this.pickTextureWidth === w && this.pickTextureHeight === h) return;
    this.pickTexture?.destroy();
    this.pickTextureWidth = w;
    this.pickTextureHeight = h;
    this.pickTexture = this.gpu.device.createTexture({
      size: [w, h, 1],
      format: 'r32uint',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
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
