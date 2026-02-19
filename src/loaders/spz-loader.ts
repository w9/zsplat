import type { SplatData } from '../types';

const SPZ_MAGIC = 0x5053474e; // "NGSP" LE
const COLOR_SCALE = 0.15;
const SH_C0 = 0.28209479177387814;
const SQRT1_2 = 0.7071067811865475244;

/**
 * Detect whether a filename or URL looks like an SPZ file.
 */
export function isSpzFile(name: string): boolean {
  return name.toLowerCase().endsWith('.spz');
}

/**
 * Decompress gzip data using the browser's DecompressionStream.
 */
async function decompressGzip(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new Response(buffer).body!.pipeThrough(
    new DecompressionStream('gzip'),
  );
  const blob = await new Response(stream).blob();
  return blob.arrayBuffer();
}

/** Read 24-bit signed little-endian and sign-extend to 32-bit. */
function read24bitSigned(data: Uint8Array, offset: number): number {
  const a = data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16);
  return (a & 0x800000) ? (a | 0xff000000) : a;
}

/** Unquantize SH coefficient: (x - 128) / 128 */
function unquantizeSH(x: number): number {
  return (x - 128) / 128;
}

/** Unpack smallest-three quaternion (v3): 4 bytes -> [w, x, y, z] for pipeline.
 *  C++ GaussianCloud stores quaternions as (x, y, z, w) at indices [0,1,2,3]. */
function unpackQuaternionSmallestThree(r: Uint8Array, offset: number): [number, number, number, number] {
  const comp = (r[offset] | (r[offset + 1] << 8) | (r[offset + 2] << 16) | (r[offset + 3] << 24)) >>> 0;
  const cMask = (1 << 9) - 1;
  const iLargest = comp >>> 30;
  const rotation: [number, number, number, number] = [0, 0, 0, 0];
  let compShift = comp;
  let sumSquares = 0;

  for (let i = 3; i >= 0; i--) {
    if (i !== iLargest) {
      const mag = compShift & cMask;
      const negbit = (compShift >>> 9) & 1;
      compShift = compShift >>> 10;
      let val = SQRT1_2 * (mag / cMask);
      if (negbit === 1) val = -val;
      rotation[i] = val;
      sumSquares += val * val;
    }
  }
  rotation[iLargest] = Math.sqrt(Math.max(0, 1 - sumSquares));

  // C++ layout: rotation[0]=x, [1]=y, [2]=z, [3]=w. Pipeline expects (w, x, y, z).
  return [rotation[3], rotation[0], rotation[1], rotation[2]];
}

/** Unpack first-three quaternion (v2): 3 bytes (unsigned 0..255) -> [w, x, y, z]. */
function unpackQuaternionFirstThree(r: Uint8Array, offset: number): [number, number, number, number] {
  const x = r[offset] / 127.5 - 1;
  const y = r[offset + 1] / 127.5 - 1;
  const z = r[offset + 2] / 127.5 - 1;
  const w = Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z));
  return [w, x, y, z];
}

function dimForDegree(degree: number): number {
  switch (degree) {
    case 0: return 0;
    case 1: return 3;
    case 2: return 8;
    case 3: return 15;
    default: return 0;
  }
}

/**
 * Load Niantic .spz (gzipped Gaussian splat) into SplatData.
 * Spec: https://github.com/nianticlabs/spz
 */
export async function loadSpz(buffer: ArrayBuffer): Promise<SplatData> {
  const decompressed = await decompressGzip(buffer);
  const data = new Uint8Array(decompressed);
  const view = new DataView(decompressed);

  if (data.length < 16) {
    throw new Error('SPZ: file too short');
  }

  const magic = view.getUint32(0, true);
  if (magic !== SPZ_MAGIC) {
    throw new Error(`SPZ: invalid magic 0x${magic.toString(16)}, expected 0x5053474e`);
  }

  const version = view.getUint32(4, true);
  if (version !== 2 && version !== 3) {
    throw new Error(`SPZ: unsupported version ${version}`);
  }

  const numPoints = view.getUint32(8, true);
  const shDegree = data[12];
  const fractionalBits = data[13];
  // data[14] = flags, data[15] = reserved

  if (numPoints === 0) {
    throw new Error('SPZ: numPoints is 0');
  }
  if (shDegree > 3) {
    throw new Error(`SPZ: invalid shDegree ${shDegree}`);
  }

  const shDim = dimForDegree(shDegree);
  let offset = 16;

  // Positions: numPoints * 9 bytes (24-bit signed per axis)
  const posScale = 1 / (1 << fractionalBits);
  const positions = new Float32Array(numPoints * 3);
  for (let i = 0; i < numPoints * 3; i++) {
    const fixed = read24bitSigned(data, offset);
    positions[i] = fixed * posScale;
    offset += 3;
  }

  // Alphas: numPoints bytes
  const alphas = data.slice(offset, offset + numPoints);
  offset += numPoints;

  // Colors: numPoints * 3 bytes (RGB)
  const colorsRaw = data.slice(offset, offset + numPoints * 3);
  offset += numPoints * 3;

  // Scales: numPoints * 3 bytes — (log_scale + 10) * 16 per component; decode then exp for linear
  const scalesRaw = data.slice(offset, offset + numPoints * 3);
  offset += numPoints * 3;

  // Rotations: v3 -> numPoints * 4 bytes, v2 -> numPoints * 3 bytes
  const rotationBytes = version === 3 ? 4 : 3;
  const rotationsRaw = data.slice(offset, offset + numPoints * rotationBytes);
  offset += numPoints * rotationBytes;

  // Spherical harmonics: numPoints * shDim * 3 bytes
  const shBytes = numPoints * shDim * 3;
  const shRaw = shDim > 0 ? data.slice(offset, offset + shBytes) : null;
  offset += shBytes;

  // Build output arrays
  const rotations = new Float32Array(numPoints * 4);
  const scales = new Float32Array(numPoints * 3);
  const colors = new Float32Array(numPoints * 4);

  const boundsMin: [number, number, number] = [Infinity, Infinity, Infinity];
  const boundsMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (let i = 0; i < numPoints; i++) {
    const q = version === 3
      ? unpackQuaternionSmallestThree(rotationsRaw, i * 4)
      : unpackQuaternionFirstThree(rotationsRaw, i * 3);
    rotations[i * 4] = q[0];
    rotations[i * 4 + 1] = q[1];
    rotations[i * 4 + 2] = q[2];
    rotations[i * 4 + 3] = q[3];

    // SPZ stores log(scale) as (log_scale + 10) * 16 (C++ GaussianCloud from PLY uses log scale)
    const logScale = (raw: number) => Math.max(-20, Math.min(5, raw / 16 - 10));
    scales[i * 3] = Math.exp(logScale(scalesRaw[i * 3]));
    scales[i * 3 + 1] = Math.exp(logScale(scalesRaw[i * 3 + 1]));
    scales[i * 3 + 2] = Math.exp(logScale(scalesRaw[i * 3 + 2]));

    // DC coeff -> linear color, matching PLY: 0.5 + SH_C0 * dc_coeff
    colors[i * 4]     = 0.5 + SH_C0 * ((colorsRaw[i * 3]     / 255 - 0.5) / COLOR_SCALE);
    colors[i * 4 + 1] = 0.5 + SH_C0 * ((colorsRaw[i * 3 + 1] / 255 - 0.5) / COLOR_SCALE);
    colors[i * 4 + 2] = 0.5 + SH_C0 * ((colorsRaw[i * 3 + 2] / 255 - 0.5) / COLOR_SCALE);
    // Alpha byte is already sigmoid(logit)*255; divide by 255 for 0..1 opacity
    colors[i * 4 + 3] = alphas[i] / 255;

    const px = positions[i * 3];
    const py = positions[i * 3 + 1];
    const pz = positions[i * 3 + 2];
    boundsMin[0] = Math.min(boundsMin[0], px);
    boundsMin[1] = Math.min(boundsMin[1], py);
    boundsMin[2] = Math.min(boundsMin[2], pz);
    boundsMax[0] = Math.max(boundsMax[0], px);
    boundsMax[1] = Math.max(boundsMax[1], py);
    boundsMax[2] = Math.max(boundsMax[2], pz);
  }

  // Clamp colors to [0,1] for base RGB (SH can add outside range)
  for (let i = 0; i < numPoints * 4; i++) {
    if (i % 4 !== 3) {
      colors[i] = Math.max(0, Math.min(1, colors[i]));
    }
  }

  let shCoeffs: Float32Array | undefined;
  if (shRaw && shDim > 0) {
    // SPZ layout: coefficient-major then RGB (sh0_r, sh0_g, sh0_b, sh1_r, ...).
    // Our layout: [R0..R14, G0..G14, B0..B14] per splat (15 coeffs × 3 channels).
    shCoeffs = new Float32Array(numPoints * 45);
    for (let i = 0; i < numPoints; i++) {
      const base = i * shDim * 3;
      for (let k = 0; k < 15; k++) {
        const r = k < shDim ? unquantizeSH(shRaw[base + k * 3]) : 0;
        const g = k < shDim ? unquantizeSH(shRaw[base + k * 3 + 1]) : 0;
        const b = k < shDim ? unquantizeSH(shRaw[base + k * 3 + 2]) : 0;
        shCoeffs[i * 45 + 0 * 15 + k] = r;
        shCoeffs[i * 45 + 1 * 15 + k] = g;
        shCoeffs[i * 45 + 2 * 15 + k] = b;
      }
    }
  }

  return {
    count: numPoints,
    positions,
    rotations,
    scales,
    colors,
    shCoeffs,
    bounds: { min: boundsMin, max: boundsMax },
  };
}
