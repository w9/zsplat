import type { PlyFile, SplatData } from '../types';
import { readTypedValue } from './ply-parser';

/**
 * Load a standard (uncompressed) Gaussian Splat PLY file.
 * Expected properties: x, y, z, rot_0..3, scale_0..2, f_dc_0..2, opacity
 */
export function loadStandardPly(buffer: ArrayBuffer, ply: PlyFile): SplatData {
  const vertexEl = ply.elements.find((e) => e.name === 'vertex');
  if (!vertexEl) throw new Error('No vertex element found in PLY');

  const count = vertexEl.count;
  const view = new DataView(buffer);

  // Compute offset to vertex data
  let offset = ply.headerByteLength;
  for (const el of ply.elements) {
    if (el.name === 'vertex') break;
    let stride = 0;
    for (const p of el.properties) stride += p.byteSize;
    offset += stride * el.count;
  }

  // Build property name → index map
  const propIndex = new Map<string, number>();
  vertexEl.properties.forEach((p, idx) => {
    propIndex.set(p.name, idx);
  });

  // Verify required properties exist
  const reqPos = ['x', 'y', 'z'];
  const reqRot = ['rot_0', 'rot_1', 'rot_2', 'rot_3'];
  const reqScale = ['scale_0', 'scale_1', 'scale_2'];
  const reqColor = ['f_dc_0', 'f_dc_1', 'f_dc_2'];

  for (const name of [...reqPos, ...reqRot, ...reqScale, ...reqColor, 'opacity']) {
    if (!propIndex.has(name)) {
      throw new Error(`Missing required property: ${name}`);
    }
  }

  // Detect how many SH rest coefficients are available
  const shProps: string[] = [];
  for (let i = 0; i < 45; i++) {
    if (propIndex.has(`f_rest_${i}`)) shProps.push(`f_rest_${i}`);
    else break;
  }
  const hasSH = shProps.length >= 3; // at least band 1 (3 coefficients per channel = 9 total)

  const positions = new Float32Array(count * 3);
  const rotations = new Float32Array(count * 4);
  const scales = new Float32Array(count * 3);
  const colors = new Float32Array(count * 4);
  const shCoeffs = hasSH ? new Float32Array(count * 45) : undefined;

  const boundsMin: [number, number, number] = [Infinity, Infinity, Infinity];
  const boundsMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  const SH_C0 = 0.28209479177387814;

  for (let i = 0; i < count; i++) {
    // Read all properties for this vertex
    const values: number[] = [];
    let cursor = offset;
    for (const prop of vertexEl.properties) {
      const r = readTypedValue(view, cursor, prop.type);
      values.push(r.value);
      cursor = r.next;
    }
    offset = cursor;

    // Position
    const px = values[propIndex.get('x')!];
    const py = values[propIndex.get('y')!];
    const pz = values[propIndex.get('z')!];
    positions[i * 3] = px;
    positions[i * 3 + 1] = py;
    positions[i * 3 + 2] = pz;

    // Rotation: rot_0 = w, rot_1 = x, rot_2 = y, rot_3 = z (PlayCanvas convention)
    const rw = values[propIndex.get('rot_0')!];
    const rx = values[propIndex.get('rot_1')!];
    const ry = values[propIndex.get('rot_2')!];
    const rz = values[propIndex.get('rot_3')!];
    // Normalize
    const rlen = Math.sqrt(rw * rw + rx * rx + ry * ry + rz * rz) || 1;
    rotations[i * 4] = rw / rlen;     // w
    rotations[i * 4 + 1] = rx / rlen; // x
    rotations[i * 4 + 2] = ry / rlen; // y
    rotations[i * 4 + 3] = rz / rlen; // z

    // Scale: stored as log(scale), we need exp(scale)
    scales[i * 3] = Math.exp(values[propIndex.get('scale_0')!]);
    scales[i * 3 + 1] = Math.exp(values[propIndex.get('scale_1')!]);
    scales[i * 3 + 2] = Math.exp(values[propIndex.get('scale_2')!]);

    // Color: SH DC coefficient → linear color
    colors[i * 4] = Math.max(0, Math.min(1, 0.5 + SH_C0 * values[propIndex.get('f_dc_0')!]));
    colors[i * 4 + 1] = Math.max(0, Math.min(1, 0.5 + SH_C0 * values[propIndex.get('f_dc_1')!]));
    colors[i * 4 + 2] = Math.max(0, Math.min(1, 0.5 + SH_C0 * values[propIndex.get('f_dc_2')!]));

    // Opacity: stored as logit, we need sigmoid
    const logit = values[propIndex.get('opacity')!];
    colors[i * 4 + 3] = 1.0 / (1.0 + Math.exp(-logit));

    // SH rest coefficients (bands 1-3)
    // Standard PLY layout: f_rest_0..44 ordered as [R0..R14, G0..G14, B0..B14]
    if (shCoeffs && hasSH) {
      for (let k = 0; k < shProps.length && k < 45; k++) {
        shCoeffs[i * 45 + k] = values[propIndex.get(shProps[k])!];
      }
      // remaining coefficients stay 0
    }

    // Bounds
    boundsMin[0] = Math.min(boundsMin[0], px);
    boundsMin[1] = Math.min(boundsMin[1], py);
    boundsMin[2] = Math.min(boundsMin[2], pz);
    boundsMax[0] = Math.max(boundsMax[0], px);
    boundsMax[1] = Math.max(boundsMax[1], py);
    boundsMax[2] = Math.max(boundsMax[2], pz);
  }

  return {
    count,
    positions,
    rotations,
    scales,
    colors,
    shCoeffs,
    bounds: { min: boundsMin, max: boundsMax },
  };
}
