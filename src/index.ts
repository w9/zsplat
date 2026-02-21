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
export { loadRad, isRadFile } from './loaders/rad-loader';

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
import { loadRad, isRadFile } from './loaders/rad-loader';
import type { SplatData } from './types';

/**
 * Convenience loader that auto-detects format:
 * - SOG (meta.json URL) → fetches webp textures and decompresses
 * - SPZ (.spz URL or File) → gzip decompress and parse Niantic format
 * - RAD (.rad URL or File) → Spark RAD format (chunked, gzipped properties)
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
  const fileLike =
    source instanceof File ||
    (typeof source === 'object' && source !== null && typeof (source as File).arrayBuffer === 'function');
  if (fileLike) {
    buffer = await (source as File).arrayBuffer();
  } else {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10 * 60 * 1000); // 10 min for large files
    try {
      const resp = await fetch(source, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!resp.ok) throw new Error(`Failed to fetch ${source}: ${resp.status}`);
      buffer = await resp.arrayBuffer();
    } catch (e) {
      clearTimeout(timeoutId);
      const isBlob = typeof source === 'string' && source.startsWith('blob:');
      const hint = isBlob
        ? ' Pass the File object from the file picker instead of URL.createObjectURL(file).'
        : ' For large files (e.g. >100MB), open via the file picker and pass the File directly.';
      const msg =
        e instanceof Error && e.name === 'AbortError'
          ? `Request timed out loading ${source}.${hint}`
          : e instanceof Error
            ? `${e.message}.${hint}`
            : 'Failed to load file.';
      throw new Error(msg);
    }
  }

  const name = fileLike ? (source as File).name : (source as string);
  if (isSpzFile(name)) {
    return loadSpz(buffer);
  }
  if (isRadFile(name)) {
    return loadRad(buffer);
  }

  const ply = parsePlyHeader(buffer);
  if (isCompressedPly(ply)) {
    return loadCompressedPly(buffer, ply);
  }
  return loadStandardPly(buffer, ply);
}

/** @deprecated Use loadSplat instead */
export const loadPly = loadSplat;
