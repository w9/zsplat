import type { Sorter } from './Sorter';
import radixSortWGSL from '../shaders/radixSort.wgsl?raw';
import radixSortSubgroupWGSL from '../shaders/radixSortSubgroup.wgsl?raw';

const WG_SIZE = 256;
const ELEMENTS_PER_THREAD = 16;
const TILE_SIZE = WG_SIZE * ELEMENTS_PER_THREAD; // 4096

const VARIANT_CONFIG = {
  portable: { radix: 16, numPasses: 8, bitsPerPass: 4 },
  subgroup: { radix: 256, numPasses: 4, bitsPerPass: 8 },
} as const;

function patchRadix(wgsl: string, radix: number): string {
  return wgsl.replace(/const RADIX: u32 = \d+u;/, `const RADIX: u32 = ${radix}u;`);
}

/**
 * Stable GPU Radix Sort.
 *
 * 'portable' variant: RADIX=16, 8 passes of 4 bits, separated scatter
 *   (stableBlockSum → prefixSum → stableReorder).
 * 'subgroup' variant: RADIX=256, 4 passes of 8 bits, fused scatter
 *   (histogram → prefixSum → stableScatterSubgroup).
 */
export type ScatterVariant = 'portable' | 'subgroup';

export class StableRadixSort implements Sorter {
  private device: GPUDevice;
  private radix: number;
  private numPasses: number;
  private bitsPerPass: number;

  private prefixSumPipeline!: GPUComputePipeline;

  // Fused scatter path (histogram → prefixSum → stableScatter/stableScatterSubgroup)
  private histogramPipeline!: GPUComputePipeline;
  private stableScatterPipeline!: GPUComputePipeline;

  // Separated scatter path (stableBlockSum → prefixSum → stableReorder)
  private stableBlockSumPipeline!: GPUComputePipeline;
  private stableReorderPipeline!: GPUComputePipeline;

  private useSeparatedScatter = false;

  private keysA!: GPUBuffer;
  private valsA!: GPUBuffer;
  private keysB!: GPUBuffer;
  private valsB!: GPUBuffer;
  private histogramBuf!: GPUBuffer;
  private localPrefixBuf: GPUBuffer | null = null;

  private passUniformBufs: GPUBuffer[] = [];
  private capacity = 0;

  /**
   * @param device  GPU device
   * @param variant 'portable' uses RADIX=16 with separated scatter;
   *                'subgroup' uses RADIX=256 with subgroup-accelerated fused scatter
   *                (falls back to portable if device lacks subgroups).
   */
  constructor(device: GPUDevice, variant: ScatterVariant = 'portable') {
    this.device = device;

    const hasSubgroups = device.features.has('subgroups' as GPUFeatureName);
    const effectiveVariant = (variant === 'subgroup' && !hasSubgroups) ? 'portable' : variant;
    if (variant === 'subgroup' && !hasSubgroups) {
      console.warn('[StableRadixSort] subgroup scatter requested but device lacks "subgroups" feature; falling back to portable path.');
    }

    const config = VARIANT_CONFIG[effectiveVariant];
    this.radix = config.radix;
    this.numPasses = config.numPasses;
    this.bitsPerPass = config.bitsPerPass;
    this.useSeparatedScatter = effectiveVariant === 'portable';

    this.createPipelines(effectiveVariant);
  }

  private createPipelines(variant: 'portable' | 'subgroup') {
    const baseModule = this.device.createShaderModule({
      code: patchRadix(radixSortWGSL, this.radix),
    });

    this.histogramPipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: { module: baseModule, entryPoint: 'histogram' },
    });

    this.prefixSumPipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: { module: baseModule, entryPoint: 'prefixSum' },
    });

    if (variant === 'portable') {
      this.stableBlockSumPipeline = this.device.createComputePipeline({
        layout: 'auto',
        compute: { module: baseModule, entryPoint: 'stableBlockSum' },
      });
      this.stableReorderPipeline = this.device.createComputePipeline({
        layout: 'auto',
        compute: { module: baseModule, entryPoint: 'stableReorder' },
      });
      this.stableScatterPipeline = this.device.createComputePipeline({
        layout: 'auto',
        compute: { module: baseModule, entryPoint: 'stableScatter' },
      });
      console.log(`[StableRadixSort] portable path: RADIX=${this.radix}, ${this.numPasses} passes, separated scatter`);
    } else {
      const sgModule = this.device.createShaderModule({
        code: patchRadix(radixSortSubgroupWGSL, this.radix),
      });
      this.stableScatterPipeline = this.device.createComputePipeline({
        layout: 'auto',
        compute: { module: sgModule, entryPoint: 'stableScatterSubgroup' },
      });
      // Not used in subgroup path, but assign for type safety
      this.stableBlockSumPipeline = this.histogramPipeline;
      this.stableReorderPipeline = this.histogramPipeline;
      console.log(`[StableRadixSort] subgroup path: RADIX=${this.radix}, ${this.numPasses} passes, fused scatter`);
    }

    for (let i = 0; i < this.numPasses; i++) {
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
      size: this.radix * numWGs * 4,
      usage: GPUBufferUsage.STORAGE,
    });

    if (this.useSeparatedScatter) {
      this.localPrefixBuf = this.device.createBuffer({
        size: bufSize,
        usage: GPUBufferUsage.STORAGE,
      });
    } else {
      this.localPrefixBuf = null;
    }
  }

  getInputBuffers(): { keys: GPUBuffer; values: GPUBuffer } {
    return { keys: this.keysA, values: this.valsA };
  }

  sort(encoder: GPUCommandEncoder, numElements: number): GPUBuffer {
    const numWGs = Math.ceil(numElements / TILE_SIZE);
    const numElementWGs = Math.ceil(numElements / WG_SIZE);

    for (let pass = 0; pass < this.numPasses; pass++) {
      const data = new Uint32Array([numElements, pass * this.bitsPerPass, numWGs, pass === 0 ? 1 : 0]);
      this.device.queue.writeBuffer(this.passUniformBufs[pass], 0, data);
    }

    let readKeys = this.keysA;
    let readVals = this.valsA;
    let writeKeys = this.keysB;
    let writeVals = this.valsB;

    for (let pass = 0; pass < this.numPasses; pass++) {
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
