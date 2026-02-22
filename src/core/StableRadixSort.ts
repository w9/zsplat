import type { Sorter } from './Sorter';
import radixSortWGSL from '../shaders/radixSort.wgsl?raw';
import radixSortSubgroupWGSL from '../shaders/radixSortSubgroup.wgsl?raw';

const WG_SIZE = 256;
const ELEMENTS_PER_THREAD = 16;
const TILE_SIZE = WG_SIZE * ELEMENTS_PER_THREAD; // 4096
const RADIX = 16;
const NUM_PASSES = 8;

/**
 * Stable GPU Radix Sort.
 * Uses the same histogram and prefix-sum shaders as RadixSort,
 * but replaces the scatter with a deterministic wave-based algorithm
 * that preserves element order within identical-digit buckets.
 */
export type ScatterVariant = 'portable' | 'subgroup';

export class StableRadixSort implements Sorter {
  private device: GPUDevice;
  private prefixSumPipeline!: GPUComputePipeline;

  // Portable/subgroup: fused scatter (histogram → prefixSum → stableScatter)
  private histogramPipeline!: GPUComputePipeline;
  private stableScatterPipeline!: GPUComputePipeline;

  // Optimized path: separated scatter (stableBlockSum → prefixSum → stableReorder)
  private stableBlockSumPipeline!: GPUComputePipeline;
  private stableReorderPipeline!: GPUComputePipeline;

  private useSeparatedScatter = false;

  private keysA!: GPUBuffer;
  private valsA!: GPUBuffer;
  private keysB!: GPUBuffer;
  private valsB!: GPUBuffer;
  private histogramBuf!: GPUBuffer;
  private localPrefixBuf!: GPUBuffer | null;

  private passUniformBufs: GPUBuffer[] = [];
  private capacity = 0;

  /**
   * @param device  GPU device
   * @param variant 'portable' always uses the serial-rank scatter;
   *                'subgroup' uses the subgroup-aware scatter if the device
   *                supports it, otherwise falls back to portable.
   */
  constructor(device: GPUDevice, variant: ScatterVariant = 'portable') {
    this.device = device;
    this.createPipelines(variant);
  }

  private createPipelines(variant: ScatterVariant) {
    const baseModule = this.device.createShaderModule({ code: radixSortWGSL });
    const hasSubgroups = this.device.features.has('subgroups' as GPUFeatureName);
    const useSubgroup = variant === 'subgroup' && hasSubgroups;
    if (variant === 'subgroup' && !hasSubgroups) {
      console.warn('[StableRadixSort] subgroup scatter requested but device lacks "subgroups" feature; falling back to portable path.');
    }

    // Separated scatter path (stableBlockSum + stableReorder) is always available
    this.useSeparatedScatter = true;
    this.stableBlockSumPipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: { module: baseModule, entryPoint: 'stableBlockSum' },
    });
    this.stableReorderPipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: { module: baseModule, entryPoint: 'stableReorder' },
    });

    // Keep fused paths for histogram-only and prefix-sum (shared)
    this.histogramPipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: { module: baseModule, entryPoint: 'histogram' },
    });

    this.prefixSumPipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: { module: baseModule, entryPoint: 'prefixSum' },
    });

    if (useSubgroup) {
      const sgModule = this.device.createShaderModule({ code: radixSortSubgroupWGSL });
      this.stableScatterPipeline = this.device.createComputePipeline({
        layout: 'auto',
        compute: { module: sgModule, entryPoint: 'stableScatterSubgroup' },
      });
    } else {
      this.stableScatterPipeline = this.device.createComputePipeline({
        layout: 'auto',
        compute: { module: baseModule, entryPoint: 'stableScatter' },
      });
    }

    console.log(`[StableRadixSort] scatter path: separated (stableBlockSum → prefixSum → stableReorder), subgroup fallback: ${useSubgroup ? 'subgroup' : 'portable'}`);

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
    this.localPrefixBuf?.destroy();

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

    this.localPrefixBuf = this.device.createBuffer({
      size: bufSize,
      usage: GPUBufferUsage.STORAGE,
    });
  }

  getInputBuffers(): { keys: GPUBuffer; values: GPUBuffer } {
    return { keys: this.keysA, values: this.valsA };
  }

  sort(encoder: GPUCommandEncoder, numElements: number): GPUBuffer {
    const numWGs = Math.ceil(numElements / TILE_SIZE);
    const numElementWGs = Math.ceil(numElements / WG_SIZE);

    for (let pass = 0; pass < NUM_PASSES; pass++) {
      const data = new Uint32Array([numElements, pass * 4, numWGs, pass === 0 ? 1 : 0]);
      this.device.queue.writeBuffer(this.passUniformBufs[pass], 0, data);
    }

    let readKeys = this.keysA;
    let readVals = this.valsA;
    let writeKeys = this.keysB;
    let writeVals = this.valsB;

    for (let pass = 0; pass < NUM_PASSES; pass++) {
      const uBuf = this.passUniformBufs[pass];

      if (this.useSeparatedScatter && this.localPrefixBuf) {
        // --- Phase 1: Stable Block Sum (local prefix + histogram) ---
        const blockSumBG = this.device.createBindGroup({
          layout: this.stableBlockSumPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: uBuf } },
            { binding: 1, resource: { buffer: readKeys } },
            { binding: 5, resource: { buffer: this.histogramBuf } },
            { binding: 6, resource: { buffer: this.localPrefixBuf } },
          ],
        });
        const bsp = encoder.beginComputePass();
        bsp.setPipeline(this.stableBlockSumPipeline);
        bsp.setBindGroup(0, blockSumBG);
        bsp.dispatchWorkgroups(numWGs);
        bsp.end();

        // --- Phase 2: Prefix Sum ---
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

        // --- Phase 3: Stable Reorder ---
        const reorderBG = this.device.createBindGroup({
          layout: this.stableReorderPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: uBuf } },
            { binding: 1, resource: { buffer: readKeys } },
            { binding: 2, resource: { buffer: readVals } },
            { binding: 3, resource: { buffer: writeKeys } },
            { binding: 4, resource: { buffer: writeVals } },
            { binding: 5, resource: { buffer: this.histogramBuf } },
            { binding: 6, resource: { buffer: this.localPrefixBuf } },
          ],
        });
        const rp = encoder.beginComputePass();
        rp.setPipeline(this.stableReorderPipeline);
        rp.setBindGroup(0, reorderBG);
        // One thread per element in stableReorder.
        rp.dispatchWorkgroups(numElementWGs);
        rp.end();
      } else {
        // Fallback: fused histogram → prefixSum → stableScatter
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

        const scatterBG = this.device.createBindGroup({
          layout: this.stableScatterPipeline.getBindGroupLayout(0),
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
        sp.setPipeline(this.stableScatterPipeline);
        sp.setBindGroup(0, scatterBG);
        sp.dispatchWorkgroups(numWGs);
        sp.end();
      }

      // Ping-pong
      const tmpK = readKeys; readKeys = writeKeys; writeKeys = tmpK;
      const tmpV = readVals; readVals = writeVals; writeVals = tmpV;
    }

    return readVals;
  }

  destroy(): void {
    this.keysA?.destroy();
    this.valsA?.destroy();
    this.keysB?.destroy();
    this.valsB?.destroy();
    this.histogramBuf?.destroy();
    this.localPrefixBuf?.destroy();
    for (const buf of this.passUniformBufs) buf.destroy();
  }
}
