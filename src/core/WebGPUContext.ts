/**
 * Manages WebGPU adapter, device, and canvas context initialization.
 */
export class WebGPUContext {
  adapter!: GPUAdapter;
  device!: GPUDevice;
  context!: GPUCanvasContext;
  format!: GPUTextureFormat;
  canvas!: HTMLCanvasElement;
  private destroyedByUs = false;

  async init(canvas: HTMLCanvasElement): Promise<void> {
    if (!navigator.gpu) {
      throw new Error(
        'WebGPU is not supported in this browser. Please use Chrome 113+ or Edge 113+.',
      );
    }

    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance',
    });
    if (!adapter) {
      throw new Error('Failed to acquire WebGPU adapter.');
    }

    // Request device with larger limits for million-splat scenes
    const device = await adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: adapter.limits.maxBufferSize,
        maxComputeWorkgroupsPerDimension: adapter.limits.maxComputeWorkgroupsPerDimension,
        maxComputeInvocationsPerWorkgroup: adapter.limits.maxComputeInvocationsPerWorkgroup,
        maxComputeWorkgroupSizeX: adapter.limits.maxComputeWorkgroupSizeX,
      },
    });

    device.lost.then((info) => {
      if (!this.destroyedByUs) {
        console.error('WebGPU device lost:', info.message);
      }
    });

    const context = canvas.getContext('webgpu');
    if (!context) {
      throw new Error('Failed to create WebGPU canvas context.');
    }

    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
      device,
      format,
      alphaMode: 'premultiplied',
    });

    this.adapter = adapter;
    this.device = device;
    this.context = context;
    this.format = format;
    this.canvas = canvas;
  }

  reconfigure(): void {
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'premultiplied',
    });
  }

  dispose(): void {
    this.destroyedByUs = true;
    this.device?.destroy();
  }
}
