import type { Sorter } from './Sorter';

/**
 * CPU-based depth sorter.
 * The preprocess shader writes sort keys + values into GPU buffers.
 * Each frame we read back positions from the CPU-side copy, compute
 * camera-space depth, sort on JS, and upload sorted indices to a GPU buffer.
 *
 * The key/value GPU buffers exist so the preprocess shader bind group
 * is satisfied, but we ignore their contents — depth is recomputed on CPU.
 */
export class CpuSort implements Sorter {
  private device: GPUDevice;
  private keysBuf!: GPUBuffer;
  private valuesBuf!: GPUBuffer;
  private sortedBuf!: GPUBuffer;
  private capacity = 0;

  // CPU-side arrays
  private indices!: Uint32Array;
  private depths!: Float32Array;

  // Set by the renderer each frame before sort()
  positions: Float32Array | null = null;
  viewMatrix: Float32Array | null = null;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  ensureCapacity(n: number): void {
    if (n <= this.capacity) return;

    this.keysBuf?.destroy();
    this.valuesBuf?.destroy();
    this.sortedBuf?.destroy();

    this.capacity = n;
    const size = n * 4;
    const storageUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;

    this.keysBuf = this.device.createBuffer({ size, usage: storageUsage });
    this.valuesBuf = this.device.createBuffer({ size, usage: storageUsage });
    this.sortedBuf = this.device.createBuffer({
      size,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.indices = new Uint32Array(n);
    this.depths = new Float32Array(n);
  }

  getInputBuffers(): { keys: GPUBuffer; values: GPUBuffer } {
    return { keys: this.keysBuf, values: this.valuesBuf };
  }

  /**
   * Sort on CPU and upload sorted indices.
   * The encoder param is unused (sort is synchronous) but kept for interface compat.
   */
  sort(_encoder: GPUCommandEncoder, numElements: number): GPUBuffer {
    const pos = this.positions;
    const view = this.viewMatrix;
    if (!pos || !view) return this.sortedBuf;

    const depths = this.depths;
    const indices = this.indices;

    // cam.z = view row 2 dot position + translation
    const vx = view[2], vy = view[6], vz = view[10], vw = view[14];

    for (let i = 0; i < numElements; i++) {
      indices[i] = i;
      depths[i] = pos[i * 3] * vx + pos[i * 3 + 1] * vy + pos[i * 3 + 2] * vz + vw;
    }

    // Back-to-front: most negative cam.z (farthest) first
    indices.sort((a, b) => depths[a] - depths[b]);

    this.device.queue.writeBuffer(
      this.sortedBuf, 0,
      indices.buffer, indices.byteOffset, numElements * 4,
    );

    return this.sortedBuf;
  }

  destroy(): void {
    this.keysBuf?.destroy();
    this.valuesBuf?.destroy();
    this.sortedBuf?.destroy();
  }
}
