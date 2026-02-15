import type { SplatData } from '../types';
import { WebGPUContext } from './WebGPUContext';
import { RadixSort } from './RadixSort';
import { Camera } from './Camera';
import preprocessWGSL from '../shaders/preprocess.wgsl?raw';
import renderWGSL from '../shaders/render.wgsl?raw';

const PREPROCESS_WG_SIZE = 256;
const SPLAT_FLOATS = 12; // floats per preprocessed splat

/**
 * Main Gaussian Splat renderer.
 * Orchestrates GPU pipelines: preprocess → sort → render.
 */
export class SplatRenderer {
  private gpu = new WebGPUContext();
  camera: Camera;

  // Pipelines
  private preprocessPipeline!: GPUComputePipeline;
  private renderPipeline!: GPURenderPipeline;
  private sorter!: RadixSort;

  // GPU buffers — input splat data
  private positionBuf!: GPUBuffer;
  private rotationBuf!: GPUBuffer;
  private scaleBuf!: GPUBuffer;
  private colorBuf!: GPUBuffer;

  // GPU buffers — preprocessed output
  private splatOutBuf!: GPUBuffer;

  // Uniform buffer for preprocess
  private preprocessUniformBuf!: GPUBuffer;

  // State
  private numSplats = 0;
  private frameId = 0;
  private running = false;
  private onFrame?: () => void;

  constructor(camera?: Camera) {
    this.camera = camera ?? new Camera();
  }

  async init(canvas: HTMLCanvasElement): Promise<void> {
    await this.gpu.init(canvas);
    const device = this.gpu.device;

    this.camera.attach(canvas);
    this.camera.setAspect(canvas.width / canvas.height);

    // Create compute pipeline for preprocessing
    const preprocessModule = device.createShaderModule({ code: preprocessWGSL });
    this.preprocessPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: preprocessModule, entryPoint: 'main' },
    });

    // Create render pipeline
    const renderModule = device.createShaderModule({ code: renderWGSL });
    this.renderPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: renderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: renderModule,
        entryPoint: 'fs_main',
        targets: [
          {
            format: this.gpu.format,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          },
        ],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none',
      },
      // No depth test — rely on sort order
    });

    // Uniform buffer for preprocess (view + proj + viewport + numSplats)
    // 2 * mat4x4 (128) + vec2 (8) + u32 (4) + pad (4) = 144 bytes
    this.preprocessUniformBuf = device.createBuffer({
      size: 144,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create radix sort
    this.sorter = new RadixSort(device);
  }

  /** Upload decompressed splat data to the GPU. */
  setScene(data: SplatData): void {
    const device = this.gpu.device;
    this.numSplats = data.count;

    // Destroy old buffers
    this.positionBuf?.destroy();
    this.rotationBuf?.destroy();
    this.scaleBuf?.destroy();
    this.colorBuf?.destroy();
    this.splatOutBuf?.destroy();

    // Upload input data
    this.positionBuf = this.createStorageBuffer(new Float32Array(data.positions));
    this.rotationBuf = this.createStorageBuffer(new Float32Array(data.rotations));
    this.scaleBuf = this.createStorageBuffer(new Float32Array(data.scales));
    this.colorBuf = this.createStorageBuffer(new Float32Array(data.colors));

    // Preprocessed output buffer
    this.splatOutBuf = device.createBuffer({
      size: data.count * SPLAT_FLOATS * 4,
      usage: GPUBufferUsage.STORAGE,
    });

    // Ensure sort buffers are large enough
    this.sorter.ensureCapacity(data.count);

    // Fit camera to scene
    this.camera.fitToBounds(data.bounds.min, data.bounds.max);
  }

  resize(width: number, height: number): void {
    this.gpu.canvas.width = width;
    this.gpu.canvas.height = height;
    this.gpu.reconfigure();
    this.camera.setAspect(width / height);
  }

  /** Start the render loop. */
  startLoop(onFrame?: () => void): void {
    this.onFrame = onFrame;
    if (this.running) return;
    this.running = true;
    this.tick();
  }

  /** Stop the render loop. */
  stopLoop(): void {
    this.running = false;
    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
      this.frameId = 0;
    }
  }

  /** Single frame render. */
  renderFrame(): void {
    if (this.numSplats === 0) return;

    const device = this.gpu.device;
    this.camera.update();

    // Update preprocess uniforms
    const uniformData = new ArrayBuffer(144);
    const f32 = new Float32Array(uniformData);
    const u32 = new Uint32Array(uniformData);

    f32.set(this.camera.viewMatrix, 0);       // offset 0:  view (64 bytes)
    f32.set(this.camera.projMatrix, 16);      // offset 64: proj (64 bytes)
    f32[32] = this.gpu.canvas.width;          // offset 128: viewport.x
    f32[33] = this.gpu.canvas.height;         // offset 132: viewport.y
    u32[34] = this.numSplats;                 // offset 136: numSplats
    u32[35] = 0;                              // offset 140: padding

    device.queue.writeBuffer(this.preprocessUniformBuf, 0, uniformData);

    const encoder = device.createCommandEncoder();

    // ---- 1. Preprocess compute pass ----
    const sortInputs = this.sorter.getInputBuffers();

    const preprocessBG = device.createBindGroup({
      layout: this.preprocessPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.preprocessUniformBuf } },
        { binding: 1, resource: { buffer: this.positionBuf } },
        { binding: 2, resource: { buffer: this.rotationBuf } },
        { binding: 3, resource: { buffer: this.scaleBuf } },
        { binding: 4, resource: { buffer: this.colorBuf } },
        { binding: 5, resource: { buffer: this.splatOutBuf } },
        { binding: 6, resource: { buffer: sortInputs.keys } },
        { binding: 7, resource: { buffer: sortInputs.values } },
      ],
    });

    const numWGs = Math.ceil(this.numSplats / PREPROCESS_WG_SIZE);
    const computePass = encoder.beginComputePass();
    computePass.setPipeline(this.preprocessPipeline);
    computePass.setBindGroup(0, preprocessBG);
    computePass.dispatchWorkgroups(numWGs);
    computePass.end();

    // ---- 2. Radix sort ----
    const sortedValuesBuf = this.sorter.sort(encoder, this.numSplats);

    // ---- 3. Render pass ----
    const textureView = this.gpu.context.getCurrentTexture().createView();
    const renderBG = device.createBindGroup({
      layout: this.renderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.splatOutBuf } },
        { binding: 1, resource: { buffer: sortedValuesBuf } },
      ],
    });

    const renderPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    renderPass.setPipeline(this.renderPipeline);
    renderPass.setBindGroup(0, renderBG);
    renderPass.draw(6, this.numSplats, 0, 0);
    renderPass.end();

    device.queue.submit([encoder.finish()]);
  }

  dispose(): void {
    this.stopLoop();
    this.camera.detach();
    this.positionBuf?.destroy();
    this.rotationBuf?.destroy();
    this.scaleBuf?.destroy();
    this.colorBuf?.destroy();
    this.splatOutBuf?.destroy();
    this.preprocessUniformBuf?.destroy();
    this.sorter?.destroy();
    this.gpu.dispose();
  }

  // ---- private ----

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
