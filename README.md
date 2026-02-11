# ZSplat

WebGPU renderer for SuperSplat-style compressed Gaussian splats.

## Install

```bash
pnpm add zsplat
```

## Basic Usage (Vanilla)

```ts
import { ZSplat } from "zsplat";

const canvas = document.querySelector("canvas");
const splat = new ZSplat();
await splat.init(canvas);

const buffer = await fetch("/path/to/file.ply").then((r) => r.arrayBuffer());
await splat.loadPly(buffer);

function frame() {
  splat.render();
  requestAnimationFrame(frame);
}
frame();
```

## React

```tsx
import { ZSplatView } from "zsplat/react";

export function Viewer() {
  return <ZSplatView url="/model.ply" style={{ width: "100%", height: "100%" }} />;
}
```

## Playground

```bash
pnpm install
pnpm dev
```

Open the dev server and load a PLY from the UI.
