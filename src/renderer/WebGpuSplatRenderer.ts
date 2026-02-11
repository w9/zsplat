import type { Mat4 } from "../math/mat4";
import type { SplatBuffers } from "../ply/CompressedPlyLoader";

const SHADER = `
struct Globals {
  viewProj : mat4x4<f32>,
  sizeScale : f32,
  _pad : vec3<f32>
};

@group(0) @binding(0) var<uniform> globals : Globals;
@group(0) @binding(1) var<storage, read> centers : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> axis1 : array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> axis2 : array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> colors : array<vec4<f32>>;

struct VertexOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv : vec2<f32>,
  @location(1) color : vec4<f32>
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex : u32,
           @builtin(instance_index) instanceIndex : u32) -> VertexOut {
  var corners = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0,  1.0)
  );

  let corner = corners[vertexIndex];
  let center = centers[instanceIndex];
  let a1 = axis1[instanceIndex].xyz * globals.sizeScale;
  let a2 = axis2[instanceIndex].xyz * globals.sizeScale;
  let world = center.xyz + a1 * corner.x + a2 * corner.y;

  var out : VertexOut;
  out.pos = globals.viewProj * vec4<f32>(world, 1.0);
  out.uv = corner;
  out.color = vec4<f32>(colors[instanceIndex].xyz, center.w);
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let r2 = dot(in.uv, in.uv);
  let alpha = exp(-r2 * 2.0) * in.color.a;
  if (alpha < 0.003) {
    discard;
  }
  return vec4<f32>(in.color.rgb * alpha, alpha);
}
`;

type RendererOptions = {
  sizeScale?: number;
  backgroundColor?: [number, number, number, number];
};

export class WebGpuSplatRenderer {
  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  private format: GPUTextureFormat | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private buffers: { centers?: GPUBuffer; axis1?: GPUBuffer; axis2?: GPUBuffer; colors?: GPUBuffer } = {};
  private count = 0;
  private sizeScale = 1.0;
  private backgroundColor: [number, number, number, number];

  constructor(options: RendererOptions = {}) {
    this.sizeScale = options.sizeScale ?? 1.0;
    this.backgroundColor = options.backgroundColor ?? [0, 0, 0, 1];
  }

  async init(canvas: HTMLCanvasElement) {
    if (!navigator.gpu) {
      throw new Error("WebGPU is not available in this browser");
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error("Failed to acquire WebGPU adapter");
    }
    this.device = await adapter.requestDevice();
    this.context = canvas.getContext("webgpu");
    if (!this.context) {
      throw new Error("Failed to create WebGPU context");
    }
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: "premultiplied"
    });
    this.pipeline = this.createPipeline(this.device, this.format);
    this.uniformBuffer = this.device.createBuffer({
      size: 80,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
  }

  resize(width: number, height: number) {
    if (!this.context || !this.device || !this.format) {
      return;
    }
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: "premultiplied"
    });
  }

  uploadSplats(data: SplatBuffers) {
    if (!this.device) {
      throw new Error("Renderer not initialized");
    }
    this.count = data.count;
    this.buffers.centers = this.createStorageBuffer(data.centers);
    this.buffers.axis1 = this.createStorageBuffer(data.axis1);
    this.buffers.axis2 = this.createStorageBuffer(data.axis2);
    this.buffers.colors = this.createStorageBuffer(data.colors);

    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer! } },
        { binding: 1, resource: { buffer: this.buffers.centers } },
        { binding: 2, resource: { buffer: this.buffers.axis1 } },
        { binding: 3, resource: { buffer: this.buffers.axis2 } },
        { binding: 4, resource: { buffer: this.buffers.colors } }
      ]
    });
  }

  render(viewProj: Mat4) {
    if (!this.device || !this.context || !this.pipeline || !this.bindGroup || !this.uniformBuffer) {
      return;
    }
    const uniform = new Float32Array(20);
    uniform.set(viewProj, 0);
    uniform[16] = this.sizeScale;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniform.buffer, uniform.byteOffset, uniform.byteLength);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: {
            r: this.backgroundColor[0],
            g: this.backgroundColor[1],
            b: this.backgroundColor[2],
            a: this.backgroundColor[3]
          },
          loadOp: "clear",
          storeOp: "store"
        }
      ]
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(4, this.count, 0, 0);
    pass.end();

    this.device.queue.submit([encoder.finish()]);
  }

  dispose() {
    this.buffers.centers?.destroy();
    this.buffers.axis1?.destroy();
    this.buffers.axis2?.destroy();
    this.buffers.colors?.destroy();
    this.uniformBuffer?.destroy();
  }

  private createStorageBuffer(data: Float32Array): GPUBuffer {
    const buffer = this.device!.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    this.device!.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, data.byteLength);
    return buffer;
  }

  private createPipeline(device: GPUDevice, format: GPUTextureFormat): GPURenderPipeline {
    return device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module: device.createShaderModule({ code: SHADER }),
        entryPoint: "vs_main"
      },
      fragment: {
        module: device.createShaderModule({ code: SHADER }),
        entryPoint: "fs_main",
        targets: [
          {
            format,
            blend: {
              color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
              alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" }
            }
          }
        ]
      },
      primitive: {
        topology: "triangle-strip",
        cullMode: "none"
      }
    });
  }
}
