# Agent guidelines for zsplat

- **Package manager:** Use **pnpm** by default for installing dependencies and running scripts (e.g. `pnpm install`, `pnpm dev`, `pnpm build`). Do not assume npm or yarn.
- When updating WebGPU shaders, always check if the binding groups layout needs to be updated.
