import type { Sorter } from './Sorter';
import radixSortWGSL from '../shaders/radixSort.wgsl?raw';

const WG_SIZE = 256;
const ELEMENTS_PER_THREAD = 16;
const TILE_SIZE = WG_SIZE * ELEMENTS_PER_THREAD; // 4096
const RADIX = 256;
const NUM_PASSES = 4;

/**
 * GPU Radix Sort using WebGPU compute shaders.
 * Sorts uint32 key-value pairs in 4 passes of 8 bits each.
 */
export class RadixSort implements Sorter {
  private device: GPUDevice;
  private histogramPipeline!: GPUComputePipeline;
  private prefixSumPipeline!: GPUComputePipeline;
  private scatterPipeline!: GPUComputePipeline;

  // Double-buffered key/value arrays
  private keysA!: GPUBuffer;
  private valsA!: GPUBuffer;
  private keysB!: GPUBuffer;
  private valsB!: GPUBuffer;
  private histogramBuf!: GPUBuffer;

  // One uniform buffer per pass so writeBuffer calls don't clobber each other
  private passUniformBufs: GPUBuffer[] = [];

  private capacity = 0;

  constructor(device: GPUDevice) {
    this.device = device;
    this.createPipelines();
  }

  private createPipelines() {
    const module = this.device.createShaderModule({ code: radixSortWGSL });

    this.histogramPipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'histogram' },
    });

    this.prefixSumPipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'prefixSum' },
    });

    this.scatterPipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'scatter' },
    });

    // Pre-create one uniform buffer per pass
    for (let i = 0; i < NUM_PASSES; i++) {
      this.passUniformBufs.push(
        this.device.createBuffer({
          size: 16,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }),
      );
    }
  }

  ensureCapacity(n: number): void {
    if (n <= this.capacity) return;

    this.keysA?.destroy();
    this.valsA?.destroy();
    this.keysB?.destroy();
    this.valsB?.destroy();
    this.histogramBuf?.destroy();

    this.capacity = n;
    const numWGs = Math.ceil(n / TILE_SIZE);

    const bufSize = n * 4;
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;

    this.keysA = this.device.createBuffer({ size: bufSize, usage });
    this.valsA = this.device.createBuffer({ size: bufSize, usage });
    this.keysB = this.device.createBuffer({ size: bufSize, usage });
    this.valsB = this.device.createBuffer({ size: bufSize, usage });

    this.histogramBuf = this.device.createBuffer({
      size: RADIX * numWGs * 4,
      usage: GPUBufferUsage.STORAGE,
    });
  }

  getInputBuffers(): { keys: GPUBuffer; values: GPUBuffer } {
    return { keys: this.keysA, values: this.valsA };
  }

  /** After sort(), returns the buffer containing sorted keys (same side as sorted values). */
  getSortedKeysBuffer(): GPUBuffer {
    // After 4 passes (even), result is back in keysA
    return this.keysA;
  }

  /**
   * Encode sort commands into the given command encoder.
   * Returns the buffer containing sorted values (splat indices).
   */
  sort(encoder: GPUCommandEncoder, numElements: number): GPUBuffer {
    const numWGs = Math.ceil(numElements / TILE_SIZE);

    // Write ALL per-pass uniforms up front — each to its OWN buffer
    // so later writeBuffer calls don't overwrite earlier ones.
    for (let pass = 0; pass < NUM_PASSES; pass++) {
      const data = new Uint32Array([numElements, pass * 8, numWGs, pass === 0 ? 1 : 0]);
      this.device.queue.writeBuffer(this.passUniformBufs[pass], 0, data);
    }

    let readKeys = this.keysA;
    let readVals = this.valsA;
    let writeKeys = this.keysB;
    let writeVals = this.valsB;

    for (let pass = 0; pass < NUM_PASSES; pass++) {
      const uBuf = this.passUniformBufs[pass];

      // --- Histogram ---
      const histBG = this.device.createBindGroup({
        layout: this.histogramPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uBuf } },
          { binding: 1, resource: { buffer: readKeys } },
          { binding: 5, resource: { buffer: this.histogramBuf } },
        ],
      });
      const hp = encoder.beginComputePass();
      hp.setPipeline(this.histogramPipeline);
      hp.setBindGroup(0, histBG);
      hp.dispatchWorkgroups(numWGs);
      hp.end();

      // --- Prefix sum ---
      const prefixBG = this.device.createBindGroup({
        layout: this.prefixSumPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uBuf } },
          { binding: 5, resource: { buffer: this.histogramBuf } },
        ],
      });
      const pp = encoder.beginComputePass();
      pp.setPipeline(this.prefixSumPipeline);
      pp.setBindGroup(0, prefixBG);
      pp.dispatchWorkgroups(1);
      pp.end();

      // --- Scatter ---
      const scatterBG = this.device.createBindGroup({
        layout: this.scatterPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uBuf } },
          { binding: 1, resource: { buffer: readKeys } },
          { binding: 2, resource: { buffer: readVals } },
          { binding: 3, resource: { buffer: writeKeys } },
          { binding: 4, resource: { buffer: writeVals } },
          { binding: 5, resource: { buffer: this.histogramBuf } },
        ],
      });
      const sp = encoder.beginComputePass();
      sp.setPipeline(this.scatterPipeline);
      sp.setBindGroup(0, scatterBG);
      sp.dispatchWorkgroups(numWGs);
      sp.end();

      // Ping-pong
      const tmpK = readKeys; readKeys = writeKeys; writeKeys = tmpK;
      const tmpV = readVals; readVals = writeVals; writeVals = tmpV;
    }

    // After 4 passes (even), result is back in keysA/valsA
    return readVals;
  }

  destroy(): void {
    this.keysA?.destroy();
    this.valsA?.destroy();
    this.keysB?.destroy();
    this.valsB?.destroy();
    this.histogramBuf?.destroy();
    for (const buf of this.passUniformBufs) buf.destroy();
  }
}
