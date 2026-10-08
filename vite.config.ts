import { resolve } from "node:path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// Public LSDP/Vision mount API and declaration output. The standalone host
// is built separately by vite.config.host.ts.

export default defineConfig({
  // Resolve the compatibility package directly to its receive-only WebRTC
  // entry. No other Lumencast runtime entry is part of Solar's renderer.
  resolve: {
    alias: {
      "@lumencast/runtime": resolve(__dirname, "node_modules/@lumencast/runtime/dist/webrtc/index.js"),
    },
  },
  plugins: [
    dts({
      aliasesExclude: ["@lumencast/runtime"],
      entryRoot: "src",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/dev-entry.ts",
        "src/host-entry.ts",
      ],
      outDir: "dist",
      rollupTypes: true,
      tsconfigPath: "./tsconfig.lib.json",
    }),
  ],
  worker: {
    // The host's assets are promoted into the installed runtime root. Keep
    // library-relative worker bytes in their own directory to preserve that ABI.
    rollupOptions: { output: { entryFileNames: "workers/[name]-[hash].js" } },
  },
  build: {
    // Vision's static assets belong to the standalone host. Keeping Vite's
    // default public copy here duplicates them in the combined release tree.
    copyPublicDir: false,
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "Solar",
      formats: ["es"],
      fileName: () => "solar.js",
      cssFileName: "solar",
    },
    sourcemap: true,
    target: "es2022",
    emptyOutDir: true,
  },
});
