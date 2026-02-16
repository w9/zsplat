// Public API
export { ZSplat } from './ZSplat';
export { SplatRenderer } from './core/SplatRenderer';
export type { SortMethod } from './core/SplatRenderer';
export { Camera } from './core/Camera';
export { parsePlyHeader, isCompressedPly } from './loaders/ply-parser';
export { loadCompressedPly } from './loaders/compressed-ply-loader';
export { loadStandardPly } from './loaders/standard-ply-loader';

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

// Local imports for the convenience loader
import { parsePlyHeader, isCompressedPly } from './loaders/ply-parser';
import { loadCompressedPly } from './loaders/compressed-ply-loader';
import { loadStandardPly } from './loaders/standard-ply-loader';
import type { SplatData } from './types';

/** Convenience loader that auto-detects compressed vs standard PLY format. */
export async function loadPly(source: string | File): Promise<SplatData> {
  let buffer: ArrayBuffer;
  if (source instanceof File) {
    buffer = await source.arrayBuffer();
  } else {
    const resp = await fetch(source);
    if (!resp.ok) throw new Error(`Failed to fetch ${source}: ${resp.status}`);
    buffer = await resp.arrayBuffer();
  }

  const ply = parsePlyHeader(buffer);

  if (isCompressedPly(ply)) {
    return loadCompressedPly(buffer, ply);
  }
  return loadStandardPly(buffer, ply);
}
