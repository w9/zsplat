# ZSplat

WebGPU renderer for Gaussian splats with optimized GPU radix sorting (portable and subgroup-optimized paths), plus a React component, loaders, and an interactive playground.

## Live demos

- Playground demo: <https://w9.github.io/zsplat/playground/?src=https://d28zzqy0iyovbz.cloudfront.net/cf6ac78e/v1/scene.compressed.ply>
- GPU radix sort visualizer: <https://w9.github.io/zsplat/radix-sort-visualized/>

This repository contains:
- the published `zsplat` package (from `src/`)
- an interactive playground app (`playground/`)
- a learning visualizer for GPU radix sort (`radix-sort-visualized/`)
- static site outputs under `docs/`

## Package install

```bash
pnpm add zsplat
```

## React usage

```tsx
import { ZSplat } from "zsplat";

export function Viewer() {
  return (
    <ZSplat
      src="/models/scene.ply"
      className="w-full h-screen"
      sortMethod="gpu-subgroup"
      turntable
    />
  );
}
```

`src` accepts either:
- a URL string
- a `File` object

Supported load formats in the package:
- standard/compressed PLY
- SPZ
- SOG (`meta.json` URL)

## Loader usage (without React)

```ts
import { loadSplat } from "zsplat";

const data = await loadSplat("/models/scene.spz");
console.log(data.count);
```

## Sorting modes

`ZSplat` supports:
- `gpu-subgroup` (default): stable, subgroup-optimized path when supported
- `gpu`: stable portable path
- `gpu-unstable`: unstable GPU path
- `cpu`: CPU fallback

## Repo layout

- `src/` - library source (renderer, camera, shaders, loaders, React component)
- `playground/` - interactive viewer app for local files and URL loading
- `radix-sort-visualized/` - educational app explaining GPU radix sort
- `docs/` - static build outputs:
  - `docs/playground/`
  - `docs/radix-sort-visualized/`

## Development

From repo root:

```bash
pnpm install
pnpm dev
```

This runs the playground dev server.

Run the radix visualizer locally:

```bash
pnpm --dir radix-sort-visualized dev
```

## Build commands

From repo root:

```bash
pnpm build
```

Builds the `zsplat` package to `dist/`.

```bash
pnpm build:docs
```

Builds both apps as static sites:
- playground -> `docs/playground/`
- radix visualizer -> `docs/radix-sort-visualized/`

```bash
pnpm preview
```

Previews the playground build.

## Playground quick notes

The playground top bar currently includes:
- open local `.ply` / `.spz`
- load by URL (and `?src=...` query param auto-load)
- sort mode selector
- camera mode/turntable controls
- link to radix sort learning page
- link to this GitHub repository
