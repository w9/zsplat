// Public API
export { ZSplat } from './ZSplat';
export { SplatRenderer } from './core/SplatRenderer';
export type { SortMethod } from './core/SplatRenderer';
export { Camera } from './core/Camera';
export { parsePlyHeader, isCompressedPly } from './loaders/ply-parser';
export { loadCompressedPly } from './loaders/compressed-ply-loader';
export { loadStandardPly } from './loaders/standard-ply-loader';
export { loadSog, loadSogFromFiles, isSogFile } from './loaders/sog-loader';
export { loadSpz, isSpzFile } from './loaders/spz-loader';

export type {
  SplatData,
  CameraState,
  RendererOptions,
  ZSplatProps,
  SplatStats,
  PlyFile,
  PlyElement,
  PlyProperty,
} from './types';

export type { SogMeta } from './loaders/sog-loader';

// Local imports for the convenience loader
import { parsePlyHeader, isCompressedPly } from './loaders/ply-parser';
import { loadCompressedPly } from './loaders/compressed-ply-loader';
import { loadStandardPly } from './loaders/standard-ply-loader';
import { loadSog, isSogFile } from './loaders/sog-loader';
import { loadSpz, isSpzFile } from './loaders/spz-loader';
import type { SplatData } from './types';

/**
 * Convenience loader that auto-detects format:
 * - SOG (meta.json URL) → fetches webp textures and decompresses
 * - SPZ (.spz URL or File) → gzip decompress and parse Niantic format
 * - Compressed PLY → decompresses packed data
 * - Standard PLY → reads float properties
 *
 * .ksplat (GaussianSplats3D) is not supported; format is not publicly specified.
 */
export async function loadSplat(source: string | File): Promise<SplatData> {
  // SOG: URL pointing to meta.json
  if (typeof source === 'string' && isSogFile(source)) {
    return loadSog(source);
  }

  let buffer: ArrayBuffer;
  if (source instanceof File) {
    buffer = await source.arrayBuffer();
  } else {
    const resp = await fetch(source);
    if (!resp.ok) throw new Error(`Failed to fetch ${source}: ${resp.status}`);
    buffer = await resp.arrayBuffer();
  }

  const name = source instanceof File ? source.name : source;
  if (isSpzFile(name)) {
    return loadSpz(buffer);
  }

  const ply = parsePlyHeader(buffer);
  if (isCompressedPly(ply)) {
    return loadCompressedPly(buffer, ply);
  }
  return loadStandardPly(buffer, ply);
}

/** @deprecated Use loadSplat instead */
export const loadPly = loadSplat;
