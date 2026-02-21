/**
 * Spark RAD format loader (.rad).
 * Spec: https://github.com/sparkjsdev/spark (rust/spark-lib/src/rad.rs)
 * Format: RAD0 magic + JSON meta + chunks; each chunk is RADC + JSON + gzipped property payloads.
 */
import type { SplatData } from '../types';

const RAD_MAGIC = 0x30444152; // 'RAD0' LE
const RAD_CHUNK_MAGIC = 0x43444152; // 'RADC' LE
const PI = Math.PI;

function roundup8(size: number): number {
  return (size + 7) & ~7;
}

async function decompressGzip(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new Response(buffer).body!.pipeThrough(
    new DecompressionStream('gzip'),
  );
  const blob = await new Response(stream).blob();
  return blob.arrayBuffer();
}

interface RadChunkRange {
  offset: number;
  bytes: number;
}

interface RadMeta {
  version: number;
  type: string;
  count: number;
  maxSh?: number;
  chunks: RadChunkRange[];
  splatEncoding?: {
    rgb_min?: number;
    rgb_max?: number;
    ln_scale_min?: number;
    ln_scale_max?: number;
    sh1_max?: number;
    sh2_max?: number;
    sh3_max?: number;
  };
}

interface RadChunkProperty {
  offset: number;
  bytes: number;
  property: string;
  encoding: string;
  compression?: string;
  min?: number;
  max?: number;
}

interface RadChunkMeta {
  version: number;
  base: number;
  count: number;
  payloadBytes: number;
  maxSh?: number;
  properties: RadChunkProperty[];
  splatEncoding?: RadMeta['splatEncoding'];
}

export function isRadFile(name: string): boolean {
  return name.toLowerCase().endsWith('.rad');
}

// ---- Decoders (match rad.rs layout: dimension-major) ----
function decodeF32(data: Uint8Array, dims: number, count: number): Float32Array {
  const out = new Float32Array(count * dims);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < count; i++) {
    for (let d = 0; d < dims; d++) {
      const idx = (count * d + i) * 4;
      out[i * dims + d] = view.getFloat32(idx, true);
    }
  }
  return out;
}

function decodeF16(data: Uint8Array, dims: number, count: number): Float32Array {
  const out = new Float32Array(count * dims);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < count; i++) {
    for (let d = 0; d < dims; d++) {
      const idx = (count * d + i) * 2;
      const bits = view.getUint16(idx, true);
      out[i * dims + d] = halfToFloat(bits);
    }
  }
  return out;
}

function halfToFloat(h: number): number {
  const exp = (h >> 10) & 0x1f;
  const mant = h & 0x3ff;
  if (exp === 0) return (mant === 0 ? 0 : Math.pow(2, -14) * (mant / 1024));
  if (exp === 31) return mant === 0 ? Infinity : NaN;
  return Math.pow(2, exp - 15) * (1 + mant / 1024);
}

function decodeF32LeBytes(data: Uint8Array, dims: number, count: number): Float32Array {
  const out = new Float32Array(count * dims);
  const stride = count * dims;
  for (let i = 0; i < count; i++) {
    for (let d = 0; d < dims; d++) {
      const base = count * d + i;
      const bytes = [
        data[base],
        data[base + stride],
        data[base + stride * 2],
        data[base + stride * 3],
      ];
      const u32 = (bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 0;
      const view = new DataView(new ArrayBuffer(4));
      view.setUint32(0, u32, true);
      out[i * dims + d] = view.getFloat32(0, true);
    }
  }
  return out;
}

function decodeF16LeBytes(data: Uint8Array, dims: number, count: number): Float32Array {
  const out = new Float32Array(count * dims);
  const stride = count * dims;
  for (let i = 0; i < count; i++) {
    for (let d = 0; d < dims; d++) {
      const idx = count * d + i;
      const b0 = data[idx];
      const b1 = data[stride + idx];
      const bits = b0 | (b1 << 8);
      out[i * dims + d] = halfToFloat(bits);
    }
  }
  return out;
}

function decodeR8(
  data: Uint8Array,
  dims: number,
  count: number,
  min: number,
  max: number,
): Float32Array {
  const out = new Float32Array(count * dims);
  for (let i = 0; i < count; i++) {
    for (let d = 0; d < dims; d++) {
      const idx = i + count * d;
      out[i * dims + d] = (data[idx] / 255) * (max - min) + min;
    }
  }
  return out;
}

function decodeR8Delta(
  data: Uint8Array,
  dims: number,
  count: number,
  min: number,
  max: number,
): Float32Array {
  const out = new Float32Array(count * dims);
  const last = new Uint8Array(dims);
  for (let i = 0; i < count; i++) {
    for (let d = 0; d < dims; d++) {
      const idx = i + count * d;
      last[d] = (last[d] + data[idx]) & 0xff;
      out[i * dims + d] = (last[d] / 255) * (max - min) + min;
    }
  }
  return out;
}

function decodeS8(
  data: Uint8Array,
  dims: number,
  count: number,
  max: number,
): Float32Array {
  const out = new Float32Array(count * dims);
  for (let i = 0; i < count; i++) {
    for (let d = 0; d < dims; d++) {
      const idx = i + count * d;
      const s8 = (data[idx] << 24) >> 24;
      out[i * dims + d] = (s8 / 127) * max;
    }
  }
  return out;
}

function decodeScale8(byte: number, lnMin: number, lnMax: number): number {
  if (byte === 0) return 0;
  const scale = (lnMax - lnMin) / 254;
  return Math.exp(lnMin + (byte - 1) * scale);
}

function decodeLn0R8(
  data: Uint8Array,
  dims: number,
  count: number,
  min: number,
  max: number,
): Float32Array {
  const out = new Float32Array(count * dims);
  for (let i = 0; i < count; i++) {
    for (let d = 0; d < dims; d++) {
      const idx = i + count * d;
      out[i * dims + d] = decodeScale8(data[idx], min, max);
    }
  }
  return out;
}

function decodeLnF16(data: Uint8Array, dims: number, count: number): Float32Array {
  const out = new Float32Array(count * dims);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < count; i++) {
    for (let d = 0; d < dims; d++) {
      const idx = (count * d + i) * 2;
      const bits = view.getUint16(idx, true);
      out[i * dims + d] = Math.exp(halfToFloat(bits));
    }
  }
  return out;
}

/** Oct88R8: 3 bytes per quat (axis octahedron + angle), output [x,y,z,w]. */
function decodeQuatOct888(data: Uint8Array, i: number): [number, number, number, number] {
  const u = data[i * 3] / 255 * 2 - 1;
  const v = data[i * 3 + 1] / 255 * 2 - 1;
  let z = 1 - Math.abs(u) - Math.abs(v);
  const t = Math.max(-z, 0);
  let x = u >= 0 ? u - t : u + t;
  let y = v >= 0 ? v - t : v + t;
  const len = Math.sqrt(x * x + y * y + z * z) || 1;
  x /= len;
  y /= len;
  z /= len;
  const halfTheta = (data[i * 3 + 2] / 255) * 0.5 * PI;
  const s = Math.sin(halfTheta);
  const w = Math.cos(halfTheta);
  return [x * s, y * s, z * s, w];
}

function decodeQuatOct88R8(data: Uint8Array, count: number): Float32Array {
  const out = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const [qx, qy, qz, qw] = decodeQuatOct888(data, i);
    out[i * 4] = qw;
    out[i * 4 + 1] = qx;
    out[i * 4 + 2] = qy;
    out[i * 4 + 3] = qz;
  }
  return out;
}

// ---- Chunk decoding ----
async function decompressChunkPayload(
  raw: Uint8Array,
  compression: string | undefined,
): Promise<Uint8Array> {
  if (compression === 'gz') {
    const ab = await decompressGzip(
      raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer,
    );
    return new Uint8Array(ab);
  }
  return raw;
}

async function decodeChunk(
  chunkBytes: ArrayBuffer,
  meta: RadMeta,
  positions: Float32Array,
  rotations: Float32Array,
  scales: Float32Array,
  colors: Float32Array,
  shCoeffs: Float32Array | null,
  encoding: RadMeta['splatEncoding'],
): Promise<void> {
  const view = new DataView(chunkBytes);
  if (view.getUint32(0, true) !== RAD_CHUNK_MAGIC) {
    throw new Error('RAD: invalid chunk magic');
  }
  const metaLen = view.getUint32(4, true);
  const metaEnd = 8 + roundup8(metaLen);
  const metaJson = new TextDecoder().decode(chunkBytes.slice(8, 8 + metaLen));
  const chunkMeta: RadChunkMeta = JSON.parse(metaJson);
  const payloadBytes = Number(view.getBigUint64(metaEnd, true));
  let payloadOffset = metaEnd + 8;
  const base = chunkMeta.base;
  const count = chunkMeta.count;
  const enc = chunkMeta.splatEncoding ?? encoding ?? {};
  const rgbMin = enc.rgb_min ?? 0;
  const rgbMax = enc.rgb_max ?? 1;
  const lnScaleMin = enc.ln_scale_min ?? -12;
  const lnScaleMax = enc.ln_scale_max ?? 9;
  const sh1Max = enc.sh1_max ?? 1;
  const sh2Max = enc.sh2_max ?? 1;
  const sh3Max = enc.sh3_max ?? 1;

  for (const prop of chunkMeta.properties) {
    const raw = new Uint8Array(
      chunkBytes,
      payloadOffset,
      Math.min(prop.bytes, chunkBytes.byteLength - payloadOffset),
    );
    const data = await decompressChunkPayload(raw, prop.compression);
    const min = prop.min ?? 0;
    const max = prop.max ?? 1;

    switch (prop.property) {
      case 'center': {
        let centers: Float32Array;
        switch (prop.encoding) {
          case 'f32':
            centers = decodeF32(data, 3, count);
            break;
          case 'f16':
            centers = decodeF16(data, 3, count);
            break;
          case 'f32_lebytes':
            centers = decodeF32LeBytes(data, 3, count);
            break;
          case 'f16_lebytes':
            centers = decodeF16LeBytes(data, 3, count);
            break;
          default:
            throw new Error(`RAD: unsupported center encoding ${prop.encoding}`);
        }
        for (let i = 0; i < count; i++) {
          positions[(base + i) * 3] = centers[i * 3];
          positions[(base + i) * 3 + 1] = centers[i * 3 + 1];
          positions[(base + i) * 3 + 2] = centers[i * 3 + 2];
        }
        break;
      }
      case 'alpha': {
        let alphas: Float32Array;
        switch (prop.encoding) {
          case 'f32':
            alphas = decodeF32(data, 1, count);
            break;
          case 'f16':
            alphas = decodeF16(data, 1, count);
            break;
          case 'r8':
            alphas = decodeR8(data, 1, count, min, max);
            break;
          default:
            throw new Error(`RAD: unsupported alpha encoding ${prop.encoding}`);
        }
        for (let i = 0; i < count; i++) colors[(base + i) * 4 + 3] = alphas[i];
        break;
      }
      case 'rgb': {
        let rgbs: Float32Array;
        switch (prop.encoding) {
          case 'f32':
            rgbs = decodeF32(data, 3, count);
            break;
          case 'f16':
            rgbs = decodeF16(data, 3, count);
            break;
          case 'r8':
            rgbs = decodeR8(data, 3, count, min, max);
            break;
          case 'r8_delta':
            rgbs = decodeR8Delta(data, 3, count, min, max);
            break;
          default:
            throw new Error(`RAD: unsupported rgb encoding ${prop.encoding}`);
        }
        for (let i = 0; i < count; i++) {
          colors[(base + i) * 4] = Math.max(0, Math.min(1, rgbs[i * 3]));
          colors[(base + i) * 4 + 1] = Math.max(0, Math.min(1, rgbs[i * 3 + 1]));
          colors[(base + i) * 4 + 2] = Math.max(0, Math.min(1, rgbs[i * 3 + 2]));
        }
        break;
      }
      case 'scales': {
        let scalesChunk: Float32Array;
        switch (prop.encoding) {
          case 'f32':
            scalesChunk = decodeF32(data, 3, count);
            break;
          case 'ln_f16':
            scalesChunk = decodeLnF16(data, 3, count);
            break;
          case 'ln_0r8':
            scalesChunk = decodeLn0R8(data, 3, count, min, max);
            break;
          default:
            throw new Error(`RAD: unsupported scales encoding ${prop.encoding}`);
        }
        for (let i = 0; i < count; i++) {
          scales[(base + i) * 3] = Math.max(1e-6, scalesChunk[i * 3]);
          scales[(base + i) * 3 + 1] = Math.max(1e-6, scalesChunk[i * 3 + 1]);
          scales[(base + i) * 3 + 2] = Math.max(1e-6, scalesChunk[i * 3 + 2]);
        }
        break;
      }
      case 'orientation': {
        if (prop.encoding !== 'oct88r8') {
          throw new Error(`RAD: unsupported orientation encoding ${prop.encoding}`);
        }
        const quats = decodeQuatOct88R8(data, count);
        for (let i = 0; i < count; i++) {
          rotations[(base + i) * 4] = quats[i * 4];
          rotations[(base + i) * 4 + 1] = quats[i * 4 + 1];
          rotations[(base + i) * 4 + 2] = quats[i * 4 + 2];
          rotations[(base + i) * 4 + 3] = quats[i * 4 + 3];
        }
        break;
      }
      case 'sh1': {
        const elements = 9; // 3 coeffs × 3 channels
        let sh: Float32Array;
        if (prop.encoding === 's8') {
          sh = decodeS8(data, elements, count, sh1Max);
        } else if (prop.encoding === 's8_delta') {
          const last = new Uint8Array(elements);
          sh = new Float32Array(count * elements);
          for (let i = 0; i < count; i++) {
            for (let k = 0; k < elements; k++) {
              const idx = i + count * k;
              last[k] = (last[k] + data[idx]) & 0xff;
              const s8 = (last[k] << 24) >> 24;
              sh[i * elements + k] = (s8 / 127) * sh1Max;
            }
          }
        } else {
          sh = prop.encoding === 'f16' ? decodeF16(data, elements, count) : decodeF32(data, elements, count);
        }
        if (shCoeffs) {
          for (let i = 0; i < count; i++) {
            const o = (base + i) * 45;
            for (let k = 0; k < 3; k++) {
              shCoeffs[o + 0 * 15 + k] = sh[i * 9 + k];
              shCoeffs[o + 1 * 15 + k] = sh[i * 9 + 3 + k];
              shCoeffs[o + 2 * 15 + k] = sh[i * 9 + 6 + k];
            }
          }
        }
        break;
      }
      case 'sh2': {
        const elements = 15; // 5 coeffs × 3 channels
        let sh: Float32Array;
        if (prop.encoding === 's8') {
          sh = decodeS8(data, elements, count, sh2Max);
        } else if (prop.encoding === 's8_delta') {
          const last = new Uint8Array(elements);
          sh = new Float32Array(count * elements);
          for (let i = 0; i < count; i++) {
            for (let k = 0; k < elements; k++) {
              const idx = i + count * k;
              last[k] = (last[k] + data[idx]) & 0xff;
              const s8 = (last[k] << 24) >> 24;
              sh[i * elements + k] = (s8 / 127) * sh2Max;
            }
          }
        } else {
          sh = prop.encoding === 'f16' ? decodeF16(data, elements, count) : decodeF32(data, elements, count);
        }
        if (shCoeffs) {
          for (let i = 0; i < count; i++) {
            const o = (base + i) * 45;
            for (let k = 0; k < 5; k++) {
              shCoeffs[o + 0 * 15 + k] = sh[i * 15 + k];
              shCoeffs[o + 1 * 15 + k] = sh[i * 15 + 5 + k];
              shCoeffs[o + 2 * 15 + k] = sh[i * 15 + 10 + k];
            }
          }
        }
        break;
      }
      case 'sh3': {
        const elements = 21; // 7 coeffs × 3 channels
        let sh: Float32Array;
        if (prop.encoding === 's8') {
          sh = decodeS8(data, elements, count, sh3Max);
        } else if (prop.encoding === 's8_delta') {
          const last = new Uint8Array(elements);
          sh = new Float32Array(count * elements);
          for (let i = 0; i < count; i++) {
            for (let k = 0; k < elements; k++) {
              const idx = i + count * k;
              last[k] = (last[k] + data[idx]) & 0xff;
              const s8 = (last[k] << 24) >> 24;
              sh[i * elements + k] = (s8 / 127) * sh3Max;
            }
          }
        } else {
          sh = prop.encoding === 'f16' ? decodeF16(data, elements, count) : decodeF32(data, elements, count);
        }
        if (shCoeffs) {
          for (let i = 0; i < count; i++) {
            const o = (base + i) * 45;
            for (let k = 0; k < 7; k++) {
              shCoeffs[o + 0 * 15 + k] = sh[i * 21 + k];
              shCoeffs[o + 1 * 15 + k] = sh[i * 21 + 7 + k];
              shCoeffs[o + 2 * 15 + k] = sh[i * 21 + 14 + k];
            }
          }
        }
        break;
      }
      default:
        break;
    }
    payloadOffset += roundup8(prop.bytes);
  }
}

function computeBounds(positions: Float32Array): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    min[0] = Math.min(min[0], positions[i]);
    min[1] = Math.min(min[1], positions[i + 1]);
    min[2] = Math.min(min[2], positions[i + 2]);
    max[0] = Math.max(max[0], positions[i]);
    max[1] = Math.max(max[1], positions[i + 1]);
    max[2] = Math.max(max[2], positions[i + 2]);
  }
  return { min, max };
}

/**
 * Load Spark .rad (RAD format) into SplatData.
 */
export async function loadRad(buffer: ArrayBuffer): Promise<SplatData> {
  const view = new DataView(buffer);
  if (buffer.byteLength < 8) throw new Error('RAD: file too short');

  const magic = view.getUint32(0, true);
  let meta: RadMeta;
  let chunksStart: number;
  let numSplats: number;
  let maxSh: number;

  if (magic === RAD_CHUNK_MAGIC) {
    // Single chunk (no outer RAD header)
    const metaLen = view.getUint32(4, true);
    const metaEnd = 8 + roundup8(metaLen);
    const metaJson = new TextDecoder().decode(buffer.slice(8, 8 + metaLen));
    const chunkMeta: RadChunkMeta = JSON.parse(metaJson);
    numSplats = chunkMeta.count;
    maxSh = chunkMeta.maxSh ?? 0;
    meta = {
      version: 1,
      type: 'gsplat',
      count: numSplats,
      maxSh,
      chunks: [{ offset: 0, bytes: buffer.byteLength }],
      splatEncoding: chunkMeta.splatEncoding,
    };
    chunksStart = 0;
  } else if (magic === RAD_MAGIC) {
    const metaLen = view.getUint32(4, true);
    const metaEnd = 8 + roundup8(metaLen);
    if (buffer.byteLength < metaEnd) throw new Error('RAD: truncated meta');
    const metaJson = new TextDecoder().decode(buffer.slice(8, 8 + metaLen));
    meta = JSON.parse(metaJson);
    if (meta.type !== 'gsplat') throw new Error(`RAD: unsupported type ${meta.type}`);
    numSplats = meta.count;
    maxSh = meta.maxSh ?? 0;
    chunksStart = metaEnd;
  } else {
    throw new Error(`RAD: invalid magic 0x${magic.toString(16)}`);
  }

  const positions = new Float32Array(numSplats * 3);
  const rotations = new Float32Array(numSplats * 4);
  const scales = new Float32Array(numSplats * 3);
  const colors = new Float32Array(numSplats * 4);
  const shCoeffs = maxSh > 0 ? new Float32Array(numSplats * 45) : null;
  const encoding = meta.splatEncoding;

  if (magic === RAD_CHUNK_MAGIC) {
    await decodeChunk(
      buffer,
      meta,
      positions,
      rotations,
      scales,
      colors,
      shCoeffs,
      encoding,
    );
  } else {
    for (const ch of meta.chunks) {
      const chunkBuf = buffer.slice(chunksStart + ch.offset, chunksStart + ch.offset + ch.bytes);
      await decodeChunk(
        chunkBuf,
        meta,
        positions,
        rotations,
        scales,
        colors,
        shCoeffs,
        encoding,
      );
    }
  }

  // Defaults for any missing data
  for (let i = 0; i < numSplats; i++) {
    if (scales[i * 3] === 0) scales[i * 3] = 1e-6;
    if (scales[i * 3 + 1] === 0) scales[i * 3 + 1] = 1e-6;
    if (scales[i * 3 + 2] === 0) scales[i * 3 + 2] = 1e-6;
    if (colors[i * 4 + 3] === 0) colors[i * 4 + 3] = 0.5;
  }

  const bounds = computeBounds(positions);

  return {
    count: numSplats,
    positions,
    rotations,
    scales,
    colors,
    shCoeffs: shCoeffs ?? undefined,
    bounds,
  };
}
