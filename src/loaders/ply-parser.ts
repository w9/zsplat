import type { PlyFile, PlyElement, PlyProperty } from '../types';

const TYPE_SIZES: Record<string, number> = {
  char: 1,
  uchar: 1,
  short: 2,
  ushort: 2,
  int: 4,
  uint: 4,
  float: 4,
  double: 8,
  int8: 1,
  uint8: 1,
  int16: 2,
  uint16: 2,
  int32: 4,
  uint32: 4,
  float32: 4,
  float64: 8,
};

/**
 * Parse the ASCII header of a PLY file and return element/property metadata
 * plus the byte offset where binary data begins.
 */
export function parsePlyHeader(buffer: ArrayBuffer): PlyFile {
  const bytes = new Uint8Array(buffer);
  const headerEnd = findEndHeader(bytes);
  if (headerEnd < 0) {
    throw new Error('Invalid PLY file: could not find end_header');
  }

  const headerText = new TextDecoder('ascii').decode(bytes.subarray(0, headerEnd));
  const lines = headerText.split(/\r?\n/).filter(Boolean);

  if (lines[0]?.trim() !== 'ply') {
    throw new Error('Not a PLY file');
  }

  let format = '';
  let comment = '';
  const elements: PlyElement[] = [];
  let current: PlyElement | null = null;

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    const keyword = parts[0];

    if (keyword === 'format') {
      format = parts[1];
    } else if (keyword === 'comment') {
      comment += (comment ? '\n' : '') + parts.slice(1).join(' ');
    } else if (keyword === 'element') {
      current = {
        name: parts[1],
        count: parseInt(parts[2], 10),
        properties: [],
      };
      elements.push(current);
    } else if (keyword === 'property' && current) {
      // Handle list properties (not used in splat files but good to handle)
      if (parts[1] === 'list') {
        // property list <count_type> <value_type> <name>
        current.properties.push({
          name: parts[4],
          type: 'list',
          byteSize: 0, // variable
        });
      } else {
        const type = parts[1];
        const name = parts[2];
        const byteSize = TYPE_SIZES[type];
        if (byteSize === undefined) {
          throw new Error(`Unknown PLY property type: ${type}`);
        }
        current.properties.push({ name, type, byteSize });
      }
    }
  }

  if (format !== 'binary_little_endian') {
    throw new Error(`Unsupported PLY format: "${format}". Only binary_little_endian is supported.`);
  }

  return {
    format,
    elements,
    headerByteLength: headerEnd,
    comment,
  };
}

/** Compute the byte stride for one instance of an element. */
export function elementStride(element: PlyElement): number {
  let stride = 0;
  for (const prop of element.properties) {
    stride += prop.byteSize;
  }
  return stride;
}

/** Read a typed value from a DataView at the given offset. */
export function readTypedValue(
  view: DataView,
  offset: number,
  type: string,
): { value: number; next: number } {
  switch (type) {
    case 'float':
    case 'float32':
      return { value: view.getFloat32(offset, true), next: offset + 4 };
    case 'double':
    case 'float64':
      return { value: view.getFloat64(offset, true), next: offset + 8 };
    case 'uint':
    case 'uint32':
    case 'int32':
      return { value: view.getUint32(offset, true), next: offset + 4 };
    case 'int':
      return { value: view.getInt32(offset, true), next: offset + 4 };
    case 'ushort':
    case 'uint16':
      return { value: view.getUint16(offset, true), next: offset + 2 };
    case 'short':
    case 'int16':
      return { value: view.getInt16(offset, true), next: offset + 2 };
    case 'uchar':
    case 'uint8':
      return { value: view.getUint8(offset), next: offset + 1 };
    case 'char':
    case 'int8':
      return { value: view.getInt8(offset), next: offset + 1 };
    default:
      throw new Error(`Unsupported PLY property type: ${type}`);
  }
}

/** Detect if a parsed PLY file uses the SuperSplat compressed format. */
export function isCompressedPly(ply: PlyFile): boolean {
  const hasChunk = ply.elements.some((e) => e.name === 'chunk');
  const vertex = ply.elements.find((e) => e.name === 'vertex');
  if (!hasChunk || !vertex) return false;
  const requiredProps = ['packed_position', 'packed_rotation', 'packed_scale', 'packed_color'];
  const vertexPropNames = new Set(vertex.properties.map((p) => p.name));
  return requiredProps.every((p) => vertexPropNames.has(p));
}

// ---- internal helpers ----

function findEndHeader(bytes: Uint8Array): number {
  const marker = 'end_header';
  for (let i = 0; i < Math.min(bytes.length, 65536) - marker.length; i++) {
    let match = true;
    for (let j = 0; j < marker.length; j++) {
      if (bytes[i + j] !== marker.charCodeAt(j)) {
        match = false;
        break;
      }
    }
    if (match) {
      // find the newline after end_header
      for (let k = i + marker.length; k < bytes.length; k++) {
        if (bytes[k] === 0x0a) {
          return k + 1;
        }
      }
    }
  }
  return -1;
}
