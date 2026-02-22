import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
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
  build: {
    outDir: resolve(__dirname, '../docs/playground'),
    emptyOutDir: true,
  },
});
