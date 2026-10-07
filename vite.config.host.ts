import { resolve } from "node:path";
import { defineConfig } from "vite";

// Standalone LSDP/Vision host loaded by Pulsar CEF and served by Orion.
// The complete application and receive-only peer viewer are bundled locally;
// generated Vision presenter and WASM assets are copied from public/vision.
export default defineConfig({
  resolve: {
    alias: {
      "@lumencast/runtime": resolve(
        __dirname,
        "node_modules/@lumencast/runtime/dist/webrtc/index.js",
      ),
    },
  },
  base: "./",
  build: {
    outDir: "dist/host",
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
    rollupOptions: {
      input: resolve(__dirname, "host.html"),
    },
  },
});
