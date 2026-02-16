/**
 * Common interface for splat depth sorters.
 * Both GPU (RadixSort) and CPU (CpuSort) implement this.
 *
 * Contract:
 *   1. Caller calls ensureCapacity(n) when splat count changes.
 *   2. getInputBuffers() returns GPU buffers for the preprocess shader
 *      to write sort keys (uint32) and values (uint32 splat indices).
 *   3. sort() encodes sort work into the command encoder and returns
 *      the GPU buffer containing sorted splat indices.
 */
export interface Sorter {
  ensureCapacity(n: number): void;
  getInputBuffers(): { keys: GPUBuffer; values: GPUBuffer };
  sort(encoder: GPUCommandEncoder, numElements: number): GPUBuffer;
  destroy(): void;
}
