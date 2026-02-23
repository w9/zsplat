# Agent guidelines for zsplat

- **Package manager:** Use **pnpm** by default for installing dependencies and running scripts (e.g. `pnpm install`, `pnpm dev`, `pnpm build`). Do not assume npm or yarn.
- **Docs builds:** For static site outputs, use `pnpm build:docs` from the repo root instead of per-app build commands like `pnpm --dir playground build`.
- When updating WebGPU shaders, always check if the binding groups layout needs to be updated.
