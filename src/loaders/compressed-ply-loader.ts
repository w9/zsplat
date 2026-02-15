import type { PlyFile, SplatData } from '../types';
import { readTypedValue } from './ply-parser';

/**
 * Load a SuperSplat-style compressed PLY file into SplatData.
 * Decompresses packed position/rotation/scale/color on the CPU
 * so the GPU receives a uniform float layout.
 */
export function loadCompressedPly(buffer: ArrayBuffer, ply: PlyFile): SplatData {
  const chunkEl = ply.elements.find((e) => e.name === 'chunk')!;
  const vertexEl = ply.elements.find((e) => e.name === 'vertex')!;
  const count = vertexEl.count;
  const numChunks = chunkEl.count;

  // ---- read chunk data ----
  const chunkArrays = readChunkData(buffer, ply, chunkEl);

  // ---- read vertex packed data ----
  const vertexArrays = readVertexData(buffer, ply, vertexEl);

  // ---- decompress ----
  const positions = new Float32Array(count * 3);
  const rotations = new Float32Array(count * 4);
  const scales = new Float32Array(count * 3);
  const colors = new Float32Array(count * 4);

  const boundsMin: [number, number, number] = [Infinity, Infinity, Infinity];
  const boundsMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  const hasColorBounds = chunkArrays.min_r !== undefined;

  for (let i = 0; i < count; i++) {
    const ci = Math.min(i >> 8, numChunks - 1); // chunk index

    // Position: unpack111011 then lerp with chunk bounds
    const pp = unpack111011(vertexArrays.packed_position[i]);
    const px = lerp(chunkArrays.min_x[ci], chunkArrays.max_x[ci], pp[0]);
    const py = lerp(chunkArrays.min_y[ci], chunkArrays.max_y[ci], pp[1]);
    const pz = lerp(chunkArrays.min_z[ci], chunkArrays.max_z[ci], pp[2]);
    positions[i * 3] = px;
    positions[i * 3 + 1] = py;
    positions[i * 3 + 2] = pz;

    // Rotation: smallest-three quaternion
    const q = unpackRotation(vertexArrays.packed_rotation[i]);
    rotations[i * 4] = q[0];     // w
    rotations[i * 4 + 1] = q[1]; // x
    rotations[i * 4 + 2] = q[2]; // y
    rotations[i * 4 + 3] = q[3]; // z

    // Scale: unpack111011 then lerp with chunk bounds, then exp
    const ss = unpack111011(vertexArrays.packed_scale[i]);
    const sx = Math.exp(lerp(chunkArrays.min_scale_x[ci], chunkArrays.max_scale_x[ci], ss[0]));
    const sy = Math.exp(lerp(chunkArrays.min_scale_y[ci], chunkArrays.max_scale_y[ci], ss[1]));
    const sz = Math.exp(lerp(chunkArrays.min_scale_z[ci], chunkArrays.max_scale_z[ci], ss[2]));
    scales[i * 3] = sx;
    scales[i * 3 + 1] = sy;
    scales[i * 3 + 2] = sz;

    // Color: unpack8888
    const cc = unpack8888(vertexArrays.packed_color[i]);
    if (hasColorBounds) {
      // SuperSplat 2.9+ with per-chunk color quantization
      colors[i * 4] = lerp(chunkArrays.min_r![ci], chunkArrays.max_r![ci], cc[0]);
      colors[i * 4 + 1] = lerp(chunkArrays.min_g![ci], chunkArrays.max_g![ci], cc[1]);
      colors[i * 4 + 2] = lerp(chunkArrays.min_b![ci], chunkArrays.max_b![ci], cc[2]);
    } else {
      // Original format: color is SH DC coefficient
      const SH_C0 = 0.28209479177387814;
      colors[i * 4] = 0.5 + SH_C0 * cc[0]; // was (cc - 0.5)/SH_C0 to get SH, we want linear color
      colors[i * 4 + 1] = 0.5 + SH_C0 * cc[1];
      colors[i * 4 + 2] = 0.5 + SH_C0 * cc[2];
    }
    // Alpha: sigmoid of packed alpha (or direct if color bounds present)
    colors[i * 4 + 3] = hasColorBounds ? cc[3] : cc[3];

    // Update bounds
    boundsMin[0] = Math.min(boundsMin[0], px);
    boundsMin[1] = Math.min(boundsMin[1], py);
    boundsMin[2] = Math.min(boundsMin[2], pz);
    boundsMax[0] = Math.max(boundsMax[0], px);
    boundsMax[1] = Math.max(boundsMax[1], py);
    boundsMax[2] = Math.max(boundsMax[2], pz);
  }

  return { count, positions, rotations, scales, colors, bounds: { min: boundsMin, max: boundsMax } };
}

// ---- chunk data reader ----

interface ChunkArrays {
  min_x: Float32Array; min_y: Float32Array; min_z: Float32Array;
  max_x: Float32Array; max_y: Float32Array; max_z: Float32Array;
  min_scale_x: Float32Array; min_scale_y: Float32Array; min_scale_z: Float32Array;
  max_scale_x: Float32Array; max_scale_y: Float32Array; max_scale_z: Float32Array;
  min_r?: Float32Array; min_g?: Float32Array; min_b?: Float32Array;
  max_r?: Float32Array; max_g?: Float32Array; max_b?: Float32Array;
}

function readChunkData(buffer: ArrayBuffer, ply: PlyFile, chunkEl: typeof ply.elements[0]): ChunkArrays {
  const view = new DataView(buffer);
  let offset = ply.headerByteLength;

  // Skip elements before chunk
  for (const el of ply.elements) {
    if (el.name === 'chunk') break;
    let stride = 0;
    for (const p of el.properties) stride += p.byteSize;
    offset += stride * el.count;
  }

  const n = chunkEl.count;
  const propNames = new Set(chunkEl.properties.map(p => p.name));
  const result: Record<string, Float32Array> = {};
  const required = [
    'min_x', 'min_y', 'min_z', 'max_x', 'max_y', 'max_z',
    'min_scale_x', 'min_scale_y', 'min_scale_z', 'max_scale_x', 'max_scale_y', 'max_scale_z',
  ];
  const optional = ['min_r', 'min_g', 'min_b', 'max_r', 'max_g', 'max_b'];

  for (const name of [...required, ...optional]) {
    if (propNames.has(name)) {
      result[name] = new Float32Array(n);
    }
  }

  for (let i = 0; i < n; i++) {
    for (const prop of chunkEl.properties) {
      const r = readTypedValue(view, offset, prop.type);
      offset = r.next;
      if (result[prop.name]) {
        result[prop.name][i] = r.value;
      }
    }
  }

  // Verify required
  for (const name of required) {
    if (!result[name]) throw new Error(`Missing required chunk property: ${name}`);
  }

  return result as unknown as ChunkArrays;
}

// ---- vertex data reader ----

interface VertexArrays {
  packed_position: Uint32Array;
  packed_rotation: Uint32Array;
  packed_scale: Uint32Array;
  packed_color: Uint32Array;
}

function readVertexData(buffer: ArrayBuffer, ply: PlyFile, vertexEl: typeof ply.elements[0]): VertexArrays {
  const view = new DataView(buffer);
  let offset = ply.headerByteLength;

  // Skip elements before vertex
  for (const el of ply.elements) {
    if (el.name === 'vertex') break;
    let stride = 0;
    for (const p of el.properties) stride += p.byteSize;
    offset += stride * el.count;
  }

  const n = vertexEl.count;
  const packed_position = new Uint32Array(n);
  const packed_rotation = new Uint32Array(n);
  const packed_scale = new Uint32Array(n);
  const packed_color = new Uint32Array(n);
  const propSet = new Set(['packed_position', 'packed_rotation', 'packed_scale', 'packed_color']);

  for (let i = 0; i < n; i++) {
    for (const prop of vertexEl.properties) {
      const r = readTypedValue(view, offset, prop.type);
      offset = r.next;
      if (propSet.has(prop.name)) {
        const val = r.value >>> 0;
        switch (prop.name) {
          case 'packed_position': packed_position[i] = val; break;
          case 'packed_rotation': packed_rotation[i] = val; break;
          case 'packed_scale': packed_scale[i] = val; break;
          case 'packed_color': packed_color[i] = val; break;
        }
      }
    }
  }

  return { packed_position, packed_rotation, packed_scale, packed_color };
}

// ---- bit unpacking ----

function unpackUnorm(value: number, bits: number): number {
  const t = (1 << bits) - 1;
  return (value & t) / t;
}

function unpack111011(value: number): [number, number, number] {
  return [
    unpackUnorm(value >>> 21, 11),
    unpackUnorm(value >>> 11, 10),
    unpackUnorm(value, 11),
  ];
}

function unpack8888(value: number): [number, number, number, number] {
  return [
    unpackUnorm(value >>> 24, 8),
    unpackUnorm(value >>> 16, 8),
    unpackUnorm(value >>> 8, 8),
    unpackUnorm(value, 8),
  ];
}

function unpackRotation(value: number): [number, number, number, number] {
  const norm = 1.0 / (Math.SQRT2 * 0.5);
  const a = (unpackUnorm(value >>> 20, 10) - 0.5) * norm;
  const b = (unpackUnorm(value >>> 10, 10) - 0.5) * norm;
  const c = (unpackUnorm(value, 10) - 0.5) * norm;
  const msq = Math.max(0, 1.0 - (a * a + b * b + c * c));
  const m = Math.sqrt(msq);

  // Return as [w, x, y, z]
  switch (value >>> 30) {
    case 0: return [m, a, b, c];
    case 1: return [a, m, b, c];
    case 2: return [a, b, m, c];
    case 3: return [a, b, c, m];
    default: return [1, 0, 0, 0];
  }
}

function lerp(a: number, b: number, t: number): number {
  return a * (1 - t) + b * t;
}
