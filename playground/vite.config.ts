import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      // In dev, resolve zsplat from source for HMR
      zsplat: resolve(__dirname, '../src/index.ts'),
    },
  },
  server: {
    port: 5173,
    open: true,
  },
  // Serve PLY files from the project root
  publicDir: resolve(__dirname, 'public'),
  assetsInclude: ['**/*.ply'],
});
