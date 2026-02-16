import type { SplatData } from '../types';

/**
 * SOG meta.json schema (v2 shape, v1 is auto-upgraded).
 */
export interface SogMeta {
  version: number;
  count: number;
  means: { mins: number[]; maxs: number[]; files: string[] };
  quats: { files: string[] };
  scales: { mins?: number[]; maxs?: number[]; codebook?: number[]; files: string[] };
  sh0: { mins?: number[]; maxs?: number[]; codebook?: number[]; files: string[] };
  shN?: { files: string[] };
}

/**
 * Detect whether a filename looks like a SOG meta.json or .sog bundle.
 */
export function isSogFile(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('meta.json') || lower.endsWith('.sog') || lower.endsWith('.json');
}

/**
 * Load a SOG scene from a meta.json URL.
 * Fetches the webp textures referenced in the meta, decodes them,
 * and decompresses into the standard SplatData format.
 */
export async function loadSog(metaUrl: string): Promise<SplatData> {
  // Fetch meta.json
  const resp = await fetch(metaUrl);
  if (!resp.ok) throw new Error(`Failed to fetch SOG meta: ${metaUrl} (${resp.status})`);
  let meta: SogMeta = await resp.json();

  // Upgrade v1 to v2 shape
  if (meta.version !== 2) {
    meta = upgradeMeta(meta);
  }

  // Patch codebooks (null entry at [0])
  patchCodebooks(meta);

  const baseUrl = metaUrl.substring(0, metaUrl.lastIndexOf('/') + 1);

  // Load all webp textures in parallel
  const [meansL, meansU] = await Promise.all(
    meta.means.files.map((f) => loadImagePixels(baseUrl + f)),
  );
  const [quatsImg] = await Promise.all(
    meta.quats.files.map((f) => loadImagePixels(baseUrl + f)),
  );
  const [scalesImg] = await Promise.all(
    meta.scales.files.map((f) => loadImagePixels(baseUrl + f)),
  );
  const [sh0Img] = await Promise.all(
    meta.sh0.files.map((f) => loadImagePixels(baseUrl + f)),
  );

  const count = meta.count;

  const positions = new Float32Array(count * 3);
  const rotations = new Float32Array(count * 4);
  const scales = new Float32Array(count * 3);
  const colors = new Float32Array(count * 4);

  const boundsMin: [number, number, number] = [Infinity, Infinity, Infinity];
  const boundsMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  const SH_C0 = 0.28209479177387814;
  const norm = Math.SQRT2;

  for (let i = 0; i < count; i++) {
    // ---- Position: 16-bit from two 8-bit textures + exponential mapping ----
    const nx = lerp(
      meta.means.mins[0], meta.means.maxs[0],
      ((meansU[i * 4 + 0] << 8) + meansL[i * 4 + 0]) / 65535,
    );
    const ny = lerp(
      meta.means.mins[1], meta.means.maxs[1],
      ((meansU[i * 4 + 1] << 8) + meansL[i * 4 + 1]) / 65535,
    );
    const nz = lerp(
      meta.means.mins[2], meta.means.maxs[2],
      ((meansU[i * 4 + 2] << 8) + meansL[i * 4 + 2]) / 65535,
    );
    const px = Math.sign(nx) * (Math.exp(Math.abs(nx)) - 1);
    const py = Math.sign(ny) * (Math.exp(Math.abs(ny)) - 1);
    const pz = Math.sign(nz) * (Math.exp(Math.abs(nz)) - 1);
    positions[i * 3] = px;
    positions[i * 3 + 1] = py;
    positions[i * 3 + 2] = pz;

    boundsMin[0] = Math.min(boundsMin[0], px);
    boundsMin[1] = Math.min(boundsMin[1], py);
    boundsMin[2] = Math.min(boundsMin[2], pz);
    boundsMax[0] = Math.max(boundsMax[0], px);
    boundsMax[1] = Math.max(boundsMax[1], py);
    boundsMax[2] = Math.max(boundsMax[2], pz);

    // ---- Rotation: smallest-three with mode in alpha channel ----
    const a = (quatsImg[i * 4 + 0] / 255 - 0.5) * norm;
    const b = (quatsImg[i * 4 + 1] / 255 - 0.5) * norm;
    const c = (quatsImg[i * 4 + 2] / 255 - 0.5) * norm;
    const d = Math.sqrt(Math.max(0, 1 - (a * a + b * b + c * c)));
    const mode = quatsImg[i * 4 + 3] - 252;

    // PlayCanvas Quat.set(x, y, z, w) — we store as (w, x, y, z)
    switch (mode) {
      case 0: rotations[i*4]=d; rotations[i*4+1]=a; rotations[i*4+2]=b; rotations[i*4+3]=c; break;
      case 1: rotations[i*4]=a; rotations[i*4+1]=d; rotations[i*4+2]=b; rotations[i*4+3]=c; break;
      case 2: rotations[i*4]=a; rotations[i*4+1]=b; rotations[i*4+2]=d; rotations[i*4+3]=c; break;
      case 3: rotations[i*4]=a; rotations[i*4+1]=b; rotations[i*4+2]=c; rotations[i*4+3]=d; break;
      default: rotations[i*4]=1; rotations[i*4+1]=0; rotations[i*4+2]=0; rotations[i*4+3]=0; break;
    }

    // ---- Scale ----
    if (meta.version === 2 && meta.scales.codebook) {
      scales[i * 3]     = Math.exp(meta.scales.codebook[scalesImg[i * 4 + 0]]);
      scales[i * 3 + 1] = Math.exp(meta.scales.codebook[scalesImg[i * 4 + 1]]);
      scales[i * 3 + 2] = Math.exp(meta.scales.codebook[scalesImg[i * 4 + 2]]);
    } else {
      scales[i * 3]     = Math.exp(lerp(meta.scales.mins![0], meta.scales.maxs![0], scalesImg[i * 4 + 0] / 255));
      scales[i * 3 + 1] = Math.exp(lerp(meta.scales.mins![1], meta.scales.maxs![1], scalesImg[i * 4 + 1] / 255));
      scales[i * 3 + 2] = Math.exp(lerp(meta.scales.mins![2], meta.scales.maxs![2], scalesImg[i * 4 + 2] / 255));
    }

    // ---- Color ----
    if (meta.version === 2 && meta.sh0.codebook) {
      const cr = meta.sh0.codebook[sh0Img[i * 4 + 0]];
      const cg = meta.sh0.codebook[sh0Img[i * 4 + 1]];
      const cb = meta.sh0.codebook[sh0Img[i * 4 + 2]];
      const ca = sh0Img[i * 4 + 3] / 255;
      colors[i * 4]     = 0.5 + cr * SH_C0;
      colors[i * 4 + 1] = 0.5 + cg * SH_C0;
      colors[i * 4 + 2] = 0.5 + cb * SH_C0;
      colors[i * 4 + 3] = ca;
    } else {
      const cr = lerp(meta.sh0.mins![0], meta.sh0.maxs![0], sh0Img[i * 4 + 0] / 255);
      const cg = lerp(meta.sh0.mins![1], meta.sh0.maxs![1], sh0Img[i * 4 + 1] / 255);
      const cb = lerp(meta.sh0.mins![2], meta.sh0.maxs![2], sh0Img[i * 4 + 2] / 255);
      const logitA = lerp(meta.sh0.mins![3], meta.sh0.maxs![3], sh0Img[i * 4 + 3] / 255);
      colors[i * 4]     = 0.5 + cr * SH_C0;
      colors[i * 4 + 1] = 0.5 + cg * SH_C0;
      colors[i * 4 + 2] = 0.5 + cb * SH_C0;
      colors[i * 4 + 3] = 1.0 / (1.0 + Math.exp(-logitA));
    }
  }

  return { count, positions, rotations, scales, colors, bounds: { min: boundsMin, max: boundsMax } };
}

/**
 * Load a SOG scene from a File (meta.json or .sog zip bundle).
 * For a meta.json File, the webp companions must be passed as additional files.
 */
export async function loadSogFromFiles(files: File[]): Promise<SplatData> {
  // Find meta.json
  const metaFile = files.find((f) => f.name.toLowerCase().endsWith('meta.json') || f.name.toLowerCase().endsWith('.json'));
  if (!metaFile) throw new Error('No meta.json found in SOG files');

  const metaText = await metaFile.text();
  let meta: SogMeta = JSON.parse(metaText);

  if (meta.version !== 2) {
    meta = upgradeMeta(meta);
  }
  patchCodebooks(meta);

  // Build a map of filename → File
  const fileMap = new Map<string, File>();
  for (const f of files) {
    fileMap.set(f.name, f);
  }

  // Load textures from the file map
  const loadTex = async (filename: string): Promise<Uint8Array> => {
    const file = fileMap.get(filename);
    if (!file) throw new Error(`SOG missing file: ${filename}`);
    return loadImagePixelsFromBlob(file);
  };

  const [meansL, meansU] = await Promise.all(meta.means.files.map(loadTex));
  const [quatsImg] = await Promise.all(meta.quats.files.map(loadTex));
  const [scalesImg] = await Promise.all(meta.scales.files.map(loadTex));
  const [sh0Img] = await Promise.all(meta.sh0.files.map(loadTex));

  // Reuse the same decompression logic (copy from loadSog body)
  return decompressSog(meta, meansL, meansU, quatsImg, scalesImg, sh0Img);
}

// ---- internal helpers ----

function upgradeMeta(meta: any): SogMeta {
  return {
    version: 1,
    count: meta.means?.shape?.[0] ?? meta.count ?? 0,
    means: { mins: meta.means.mins, maxs: meta.means.maxs, files: meta.means.files },
    quats: { files: meta.quats.files },
    scales: { mins: meta.scales.mins, maxs: meta.scales.maxs, files: meta.scales.files },
    sh0: { mins: meta.sh0.mins, maxs: meta.sh0.maxs, files: meta.sh0.files },
    ...(meta.shN ? { shN: { files: meta.shN.files } } : {}),
  };
}

function patchCodebooks(meta: SogMeta): void {
  for (const key of ['scales', 'sh0'] as const) {
    const codebook = (meta[key] as any)?.codebook as number[] | undefined;
    if (codebook && codebook[0] === null) {
      codebook[0] = codebook[1] + (codebook[1] - codebook[255]) / 255;
    }
  }
}

function lerp(a: number, b: number, t: number): number {
  return a * (1 - t) + b * t;
}

/** Load a webp image from URL and return RGBA pixel data. */
async function loadImagePixels(url: string): Promise<Uint8Array> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);
  const blob = await resp.blob();
  return loadImagePixelsFromBlob(blob);
}

/** Decode an image Blob to RGBA pixel data using canvas. */
async function loadImagePixelsFromBlob(blob: Blob): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();
  return new Uint8Array(imageData.data.buffer);
}

/** Shared decompression logic for both URL-based and File-based loading. */
function decompressSog(
  meta: SogMeta,
  meansL: Uint8Array,
  meansU: Uint8Array,
  quatsImg: Uint8Array,
  scalesImg: Uint8Array,
  sh0Img: Uint8Array,
): SplatData {
  const count = meta.count;
  const positions = new Float32Array(count * 3);
  const rotations = new Float32Array(count * 4);
  const scales = new Float32Array(count * 3);
  const colors = new Float32Array(count * 4);

  const boundsMin: [number, number, number] = [Infinity, Infinity, Infinity];
  const boundsMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  const SH_C0 = 0.28209479177387814;
  const norm = Math.SQRT2;

  for (let i = 0; i < count; i++) {
    // Position
    const nx = lerp(meta.means.mins[0], meta.means.maxs[0], ((meansU[i*4+0] << 8) + meansL[i*4+0]) / 65535);
    const ny = lerp(meta.means.mins[1], meta.means.maxs[1], ((meansU[i*4+1] << 8) + meansL[i*4+1]) / 65535);
    const nz = lerp(meta.means.mins[2], meta.means.maxs[2], ((meansU[i*4+2] << 8) + meansL[i*4+2]) / 65535);
    const px = Math.sign(nx) * (Math.exp(Math.abs(nx)) - 1);
    const py = Math.sign(ny) * (Math.exp(Math.abs(ny)) - 1);
    const pz = Math.sign(nz) * (Math.exp(Math.abs(nz)) - 1);
    positions[i*3] = px; positions[i*3+1] = py; positions[i*3+2] = pz;

    boundsMin[0] = Math.min(boundsMin[0], px); boundsMin[1] = Math.min(boundsMin[1], py); boundsMin[2] = Math.min(boundsMin[2], pz);
    boundsMax[0] = Math.max(boundsMax[0], px); boundsMax[1] = Math.max(boundsMax[1], py); boundsMax[2] = Math.max(boundsMax[2], pz);

    // Rotation
    const a = (quatsImg[i*4+0] / 255 - 0.5) * norm;
    const b = (quatsImg[i*4+1] / 255 - 0.5) * norm;
    const c = (quatsImg[i*4+2] / 255 - 0.5) * norm;
    const d = Math.sqrt(Math.max(0, 1 - (a*a + b*b + c*c)));
    const mode = quatsImg[i*4+3] - 252;
    switch (mode) {
      case 0: rotations[i*4]=d; rotations[i*4+1]=a; rotations[i*4+2]=b; rotations[i*4+3]=c; break;
      case 1: rotations[i*4]=a; rotations[i*4+1]=d; rotations[i*4+2]=b; rotations[i*4+3]=c; break;
      case 2: rotations[i*4]=a; rotations[i*4+1]=b; rotations[i*4+2]=d; rotations[i*4+3]=c; break;
      case 3: rotations[i*4]=a; rotations[i*4+1]=b; rotations[i*4+2]=c; rotations[i*4+3]=d; break;
      default: rotations[i*4]=1; rotations[i*4+1]=0; rotations[i*4+2]=0; rotations[i*4+3]=0; break;
    }

    // Scale
    if (meta.version === 2 && meta.scales.codebook) {
      scales[i*3]   = Math.exp(meta.scales.codebook[scalesImg[i*4+0]]);
      scales[i*3+1] = Math.exp(meta.scales.codebook[scalesImg[i*4+1]]);
      scales[i*3+2] = Math.exp(meta.scales.codebook[scalesImg[i*4+2]]);
    } else {
      scales[i*3]   = Math.exp(lerp(meta.scales.mins![0], meta.scales.maxs![0], scalesImg[i*4+0] / 255));
      scales[i*3+1] = Math.exp(lerp(meta.scales.mins![1], meta.scales.maxs![1], scalesImg[i*4+1] / 255));
      scales[i*3+2] = Math.exp(lerp(meta.scales.mins![2], meta.scales.maxs![2], scalesImg[i*4+2] / 255));
    }

    // Color
    if (meta.version === 2 && meta.sh0.codebook) {
      colors[i*4]   = 0.5 + meta.sh0.codebook[sh0Img[i*4+0]] * SH_C0;
      colors[i*4+1] = 0.5 + meta.sh0.codebook[sh0Img[i*4+1]] * SH_C0;
      colors[i*4+2] = 0.5 + meta.sh0.codebook[sh0Img[i*4+2]] * SH_C0;
      colors[i*4+3] = sh0Img[i*4+3] / 255;
    } else {
      const cr = lerp(meta.sh0.mins![0], meta.sh0.maxs![0], sh0Img[i*4+0] / 255);
      const cg = lerp(meta.sh0.mins![1], meta.sh0.maxs![1], sh0Img[i*4+1] / 255);
      const cb = lerp(meta.sh0.mins![2], meta.sh0.maxs![2], sh0Img[i*4+2] / 255);
      const logitA = lerp(meta.sh0.mins![3], meta.sh0.maxs![3], sh0Img[i*4+3] / 255);
      colors[i*4]   = 0.5 + cr * SH_C0;
      colors[i*4+1] = 0.5 + cg * SH_C0;
      colors[i*4+2] = 0.5 + cb * SH_C0;
      colors[i*4+3] = 1.0 / (1.0 + Math.exp(-logitA));
    }
  }

  return { count, positions, rotations, scales, colors, bounds: { min: boundsMin, max: boundsMax } };
}
