import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Host / standalone target — ADR 001 (dual-build).
//
// The library build (vite.config.ts) marks react / react-dom /
// @preact/signals(-react) / framer-motion as `external`, which is correct
// for `@zablab/solar` (Prism vendors and re-bundles). But the bundle
// Orion static-serves and the Pulsar CEF loads has NO bundler and NO
// import map, so those externals survive as bare ESM specifiers the
// browser cannot resolve → mount() never runs → black frame (B4).
//
// This config is the second output: an *app-mode* build (no `build.lib`)
// with NO externals, so Rollup inlines every runtime dep into the chunks.
// The emitted dist/host/** is self-contained — zero bare specifiers — and
// is the artefact served at /static/solar/v{N}/.
//
// `base: "./"` makes every emitted import/asset reference relative, so the
// bundle resolves regardless of the path prefix Orion serves it under
// (e.g. /orion/static/solar/v0.2.1/). The anti-bare-specifier test
// (scripts/check-host-bundle.mjs) and the Playwright smoke test (loaded
// with NO import map) guard the invariant in CI.

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist/host",
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
    rollupOptions: {
      // host.html is the entry; its <script type="module"> points at
      // src/host-entry.tsx. Deliberately NO `external` — every dep is
      // inlined so no bare specifier survives in the served JS.
      input: resolve(__dirname, "host.html"),
    },
  },
});
