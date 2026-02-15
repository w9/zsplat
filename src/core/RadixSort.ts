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
export class RadixSort {
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
  private uniformBuf!: GPUBuffer;

  private capacity = 0;
  private numWorkgroups = 0;

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

    this.uniformBuf = this.device.createBuffer({
      size: 16, // 4 x u32
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  /**
   * Ensure internal buffers are large enough for `n` elements.
   * The caller provides keysA and valsA pre-filled with data.
   * Returns the buffer pair that contains the sorted result.
   */
  ensureCapacity(n: number): void {
    if (n <= this.capacity) return;

    // Destroy old buffers
    this.keysA?.destroy();
    this.valsA?.destroy();
    this.keysB?.destroy();
    this.valsB?.destroy();
    this.histogramBuf?.destroy();

    this.capacity = n;
    this.numWorkgroups = Math.ceil(n / TILE_SIZE);

    const bufSize = n * 4;
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;

    this.keysA = this.device.createBuffer({ size: bufSize, usage });
    this.valsA = this.device.createBuffer({ size: bufSize, usage });
    this.keysB = this.device.createBuffer({ size: bufSize, usage });
    this.valsB = this.device.createBuffer({ size: bufSize, usage });

    this.histogramBuf = this.device.createBuffer({
      size: RADIX * this.numWorkgroups * 4,
      usage: GPUBufferUsage.STORAGE,
    });
  }

  /** Get the A-side key/value buffers (to be filled by preprocess). */
  getInputBuffers(): { keys: GPUBuffer; values: GPUBuffer } {
    return { keys: this.keysA, values: this.valsA };
  }

  /**
   * Encode sort commands into the given command encoder.
   * After execution, sorted values (splat indices) are in the returned buffer.
   */
  sort(encoder: GPUCommandEncoder, numElements: number): GPUBuffer {
    const numWGs = Math.ceil(numElements / TILE_SIZE);

    let readKeys = this.keysA;
    let readVals = this.valsA;
    let writeKeys = this.keysB;
    let writeVals = this.valsB;

    for (let pass = 0; pass < NUM_PASSES; pass++) {
      const bitOffset = pass * 8;

      // Write uniforms
      const uniformData = new Uint32Array([numElements, bitOffset, numWGs, 0]);
      this.device.queue.writeBuffer(this.uniformBuf, 0, uniformData);

      // --- Histogram pass ---
      const histBG = this.device.createBindGroup({
        layout: this.histogramPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuf } },
          { binding: 1, resource: { buffer: readKeys } },
          { binding: 2, resource: { buffer: readVals } },
          { binding: 3, resource: { buffer: writeKeys } },
          { binding: 4, resource: { buffer: writeVals } },
          { binding: 5, resource: { buffer: this.histogramBuf } },
        ],
      });

      const histPass = encoder.beginComputePass();
      histPass.setPipeline(this.histogramPipeline);
      histPass.setBindGroup(0, histBG);
      histPass.dispatchWorkgroups(numWGs);
      histPass.end();

      // --- Prefix sum pass ---
      const prefixBG = this.device.createBindGroup({
        layout: this.prefixSumPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuf } },
          { binding: 1, resource: { buffer: readKeys } },
          { binding: 2, resource: { buffer: readVals } },
          { binding: 3, resource: { buffer: writeKeys } },
          { binding: 4, resource: { buffer: writeVals } },
          { binding: 5, resource: { buffer: this.histogramBuf } },
        ],
      });

      const prefixPass = encoder.beginComputePass();
      prefixPass.setPipeline(this.prefixSumPipeline);
      prefixPass.setBindGroup(0, prefixBG);
      prefixPass.dispatchWorkgroups(1);
      prefixPass.end();

      // --- Scatter pass ---
      const scatterBG = this.device.createBindGroup({
        layout: this.scatterPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuf } },
          { binding: 1, resource: { buffer: readKeys } },
          { binding: 2, resource: { buffer: readVals } },
          { binding: 3, resource: { buffer: writeKeys } },
          { binding: 4, resource: { buffer: writeVals } },
          { binding: 5, resource: { buffer: this.histogramBuf } },
        ],
      });

      const scatterPass = encoder.beginComputePass();
      scatterPass.setPipeline(this.scatterPipeline);
      scatterPass.setBindGroup(0, scatterBG);
      scatterPass.dispatchWorkgroups(numWGs);
      scatterPass.end();

      // Ping-pong
      const tmpK = readKeys; readKeys = writeKeys; writeKeys = tmpK;
      const tmpV = readVals; readVals = writeVals; writeVals = tmpV;
    }

    // After 4 passes (even number), result is back in the original read buffers
    // For even number of passes, result is in keysA/valsA
    return readVals;
  }

  destroy(): void {
    this.keysA?.destroy();
    this.valsA?.destroy();
    this.keysB?.destroy();
    this.valsB?.destroy();
    this.histogramBuf?.destroy();
    this.uniformBuf?.destroy();
  }
}
