import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  root: "playground",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src")
    }
  },
  server: {
    fs: {
      allow: [".."]
    }
  },
  build: {
    outDir: "../dist-playground",
    emptyOutDir: true
  }
});
