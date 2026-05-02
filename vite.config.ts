import { defineConfig } from "vite";
import { resolve } from "path";

// Vite config for renderer windows. We build two HTML entry points:
//   - overlay.html  → the transparent full-screen canvas per monitor
//   - toolbar.html  → the floating draggable toolbar
//
// Both share code from src/shared and src/renderer.
export default defineConfig({
  root: "src/renderer",
  base: "./",
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "src/shared"),
      "@renderer": resolve(__dirname, "src/renderer"),
    },
  },
  build: {
    outDir: resolve(__dirname, "dist/renderer"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        overlay: resolve(__dirname, "src/renderer/overlay.html"),
        toolbar: resolve(__dirname, "src/renderer/toolbar.html"),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
