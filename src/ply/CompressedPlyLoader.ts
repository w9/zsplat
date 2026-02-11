export type SplatBuffers = {
  count: number;
  centers: Float32Array;
  axis1: Float32Array;
  axis2: Float32Array;
  colors: Float32Array;
  bounds: { min: [number, number, number]; max: [number, number, number] };
};

type PlyElement = {
  name: string;
  count: number;
  properties: { name: string; type: string }[];
};

type CompressedPlyData = {
  chunks: Record<string, Float32Array>;
  vertices: Record<string, Uint32Array>;
  vertexCount: number;
};

const CHUNK_PROPS = new Set([
  "min_x",
  "min_y",
  "min_z",
  "max_x",
  "max_y",
  "max_z",
  "min_scale_x",
  "min_scale_y",
  "min_scale_z",
  "max_scale_x",
  "max_scale_y",
  "max_scale_z"
]);

const VERTEX_PROPS = new Set([
  "packed_position",
  "packed_rotation",
  "packed_scale",
  "packed_color"
]);

export function loadCompressedPly(buffer: ArrayBuffer): SplatBuffers {
  const { headerLength, elements } = parseHeader(buffer);
  const data = readBinaryData(buffer, headerLength, elements);
  return decodeCompressed(data);
}

function parseHeader(buffer: ArrayBuffer): { headerLength: number; elements: PlyElement[] } {
  const bytes = new Uint8Array(buffer);
  const endHeader = findEndHeader(bytes);
  if (endHeader < 0) {
    throw new Error("PLY header not found");
  }
  const header = new TextDecoder("ascii").decode(bytes.subarray(0, endHeader));
  const lines = header.split(/\r?\n/).filter(Boolean);

  const elements: PlyElement[] = [];
  let current: PlyElement | null = null;
  let format = "";

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === "format") {
      format = parts[1];
    } else if (parts[0] === "element") {
      current = {
        name: parts[1],
        count: Number(parts[2]),
        properties: []
      };
      elements.push(current);
    } else if (parts[0] === "property" && current) {
      current.properties.push({ type: parts[1], name: parts[2] });
    }
  }

  if (format !== "binary_little_endian") {
    throw new Error(`Unsupported PLY format: ${format}`);
  }

  return { headerLength: endHeader, elements };
}

function findEndHeader(bytes: Uint8Array): number {
  const marker = "end_header";
  for (let i = 0; i < bytes.length - marker.length; i += 1) {
    let match = true;
    for (let j = 0; j < marker.length; j += 1) {
      if (bytes[i + j] !== marker.charCodeAt(j)) {
        match = false;
        break;
      }
    }
    if (match) {
      for (let k = i + marker.length; k < bytes.length; k += 1) {
        if (bytes[k] === 10) {
          return k + 1;
        }
      }
    }
  }
  return -1;
}

function readBinaryData(buffer: ArrayBuffer, offset: number, elements: PlyElement[]): CompressedPlyData {
  const view = new DataView(buffer);
  let cursor = offset;

  const chunks: Record<string, Float32Array> = {};
  const vertices: Record<string, Uint32Array> = {};
  let vertexCount = 0;

  for (const element of elements) {
    if (element.name === "chunk") {
      for (const prop of element.properties) {
        if (CHUNK_PROPS.has(prop.name)) {
          chunks[prop.name] = new Float32Array(element.count);
        }
      }
    }
    if (element.name === "vertex") {
      vertexCount = element.count;
      for (const prop of element.properties) {
        if (VERTEX_PROPS.has(prop.name)) {
          vertices[prop.name] = new Uint32Array(element.count);
        }
      }
    }
  }

  for (const element of elements) {
    for (let i = 0; i < element.count; i += 1) {
      for (const prop of element.properties) {
        const { value, nextOffset } = readValue(view, cursor, prop.type);
        cursor = nextOffset;
        if (element.name === "chunk" && chunks[prop.name]) {
          chunks[prop.name][i] = value;
        } else if (element.name === "vertex" && vertices[prop.name]) {
          vertices[prop.name][i] = value >>> 0;
        }
      }
    }
  }

  return { chunks, vertices, vertexCount };
}

function readValue(view: DataView, offset: number, type: string): { value: number; nextOffset: number } {
  switch (type) {
    case "float":
      return { value: view.getFloat32(offset, true), nextOffset: offset + 4 };
    case "double":
      return { value: view.getFloat64(offset, true), nextOffset: offset + 8 };
    case "uint":
      return { value: view.getUint32(offset, true), nextOffset: offset + 4 };
    case "int":
      return { value: view.getInt32(offset, true), nextOffset: offset + 4 };
    case "ushort":
      return { value: view.getUint16(offset, true), nextOffset: offset + 2 };
    case "short":
      return { value: view.getInt16(offset, true), nextOffset: offset + 2 };
    case "uchar":
      return { value: view.getUint8(offset), nextOffset: offset + 1 };
    case "char":
      return { value: view.getInt8(offset), nextOffset: offset + 1 };
    default:
      throw new Error(`Unsupported PLY property type: ${type}`);
  }
}

function decodeCompressed(data: CompressedPlyData): SplatBuffers {
  const position = data.vertices.packed_position;
  const rotation = data.vertices.packed_rotation;
  const scale = data.vertices.packed_scale;
  const color = data.vertices.packed_color;

  if (!position || !rotation || !scale || !color) {
    throw new Error("Missing compressed vertex attributes");
  }

  const minX = data.chunks.min_x;
  const minY = data.chunks.min_y;
  const minZ = data.chunks.min_z;
  const maxX = data.chunks.max_x;
  const maxY = data.chunks.max_y;
  const maxZ = data.chunks.max_z;
  const minScaleX = data.chunks.min_scale_x;
  const minScaleY = data.chunks.min_scale_y;
  const minScaleZ = data.chunks.min_scale_z;
  const maxScaleX = data.chunks.max_scale_x;
  const maxScaleY = data.chunks.max_scale_y;
  const maxScaleZ = data.chunks.max_scale_z;

  if (!minX || !minY || !minZ || !maxX || !maxY || !maxZ || !minScaleX || !minScaleY || !minScaleZ || !maxScaleX || !maxScaleY || !maxScaleZ) {
    throw new Error("Missing chunk bounds for decompression");
  }

  const count = data.vertexCount;
  const centers = new Float32Array(count * 4);
  const axis1 = new Float32Array(count * 4);
  const axis2 = new Float32Array(count * 4);
  const colors = new Float32Array(count * 4);

  const boundsMin: [number, number, number] = [Infinity, Infinity, Infinity];
  const boundsMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (let i = 0; i < count; i += 1) {
    const ci = i >> 8;
    const p = unpack111011(position[i]);
    const s = unpack111011(scale[i]);
    const r = unpackRotation(rotation[i]);
    const c = unpack8888(color[i]);

    const px = lerp(minX[ci], maxX[ci], p[0]);
    const py = lerp(minY[ci], maxY[ci], p[1]);
    const pz = lerp(minZ[ci], maxZ[ci], p[2]);
    const sx = Math.exp(lerp(minScaleX[ci], maxScaleX[ci], s[0]));
    const sy = Math.exp(lerp(minScaleY[ci], maxScaleY[ci], s[1]));
    const sz = Math.exp(lerp(minScaleZ[ci], maxScaleZ[ci], s[2]));

    const rot = quatToBasis(r[0], r[1], r[2], r[3]);
    const ax1 = rot[0] * sx;
    const ay1 = rot[1] * sx;
    const az1 = rot[2] * sx;
    const ax2 = rot[3] * sy;
    const ay2 = rot[4] * sy;
    const az2 = rot[5] * sy;

    const base = i * 4;
    centers[base] = px;
    centers[base + 1] = py;
    centers[base + 2] = pz;
    centers[base + 3] = c[3];

    axis1[base] = ax1;
    axis1[base + 1] = ay1;
    axis1[base + 2] = az1;
    axis1[base + 3] = 0;

    axis2[base] = ax2;
    axis2[base + 1] = ay2;
    axis2[base + 2] = az2;
    axis2[base + 3] = 0;

    colors[base] = c[0];
    colors[base + 1] = c[1];
    colors[base + 2] = c[2];
    colors[base + 3] = c[3];

    boundsMin[0] = Math.min(boundsMin[0], px - sx);
    boundsMin[1] = Math.min(boundsMin[1], py - sy);
    boundsMin[2] = Math.min(boundsMin[2], pz - sz);
    boundsMax[0] = Math.max(boundsMax[0], px + sx);
    boundsMax[1] = Math.max(boundsMax[1], py + sy);
    boundsMax[2] = Math.max(boundsMax[2], pz + sz);
  }

  return {
    count,
    centers,
    axis1,
    axis2,
    colors,
    bounds: { min: boundsMin, max: boundsMax }
  };
}

function unpack111011(value: number): [number, number, number] {
  const x = unpackUnorm(value >>> 21, 11);
  const y = unpackUnorm(value >>> 11, 10);
  const z = unpackUnorm(value, 11);
  return [x, y, z];
}

function unpack8888(value: number): [number, number, number, number] {
  const r = unpackUnorm(value >>> 24, 8);
  const g = unpackUnorm(value >>> 16, 8);
  const b = unpackUnorm(value >>> 8, 8);
  const a = unpackUnorm(value, 8);
  return [r, g, b, a];
}

function unpackUnorm(value: number, bits: number): number {
  const t = (1 << bits) - 1;
  return (value & t) / t;
}

function unpackRotation(value: number): [number, number, number, number] {
  const norm = 1.0 / (Math.sqrt(2) * 0.5);
  const a = (unpackUnorm(value >>> 20, 10) - 0.5) * norm;
  const b = (unpackUnorm(value >>> 10, 10) - 0.5) * norm;
  const c = (unpackUnorm(value, 10) - 0.5) * norm;
  const m = Math.sqrt(1.0 - (a * a + b * b + c * c));

  switch (value >>> 30) {
    case 0:
      return [m, a, b, c];
    case 1:
      return [a, m, b, c];
    case 2:
      return [a, b, m, c];
    case 3:
      return [a, b, c, m];
    default:
      return [1, 0, 0, 0];
  }
}

function quatToBasis(x: number, y: number, z: number, w: number): [number, number, number, number, number, number] {
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;

  const m00 = 1 - 2 * (yy + zz);
  const m01 = 2 * (xy + wz);
  const m02 = 2 * (xz - wy);

  const m10 = 2 * (xy - wz);
  const m11 = 1 - 2 * (xx + zz);
  const m12 = 2 * (yz + wx);

  return [m00, m01, m02, m10, m11, m12];
}

function lerp(a: number, b: number, t: number): number {
  return a * (1 - t) + b * t;
}
