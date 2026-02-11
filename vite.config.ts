import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig(({ command }) => {
  if (command === "serve") {
    return {
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
      }
    };
  }

  return {
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src")
      }
    },
    build: {
      lib: {
        entry: {
          index: path.resolve(__dirname, "src/index.ts"),
          react: path.resolve(__dirname, "src/react.tsx")
        },
        formats: ["es"]
      },
      rollupOptions: {
        external: ["react", "react-dom"],
        output: {
          entryFileNames: "[name].js"
        }
      }
    }
  };
});
