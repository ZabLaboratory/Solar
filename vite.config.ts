import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dts from "vite-plugin-dts";

// Solar publishes ESM as multi-entry library : the main bundle plus
// the `animate/flip` subpath, which Prism consumes directly so both
// runtimes share a single FLIP implementation.
//
// The UMD bundle (for `<script>` embed) is produced by a second
// Vite invocation (`vite.config.umd.ts`) — Vite library mode forces
// a single entry as soon as UMD is in the format list.

const EXTERNAL = [
  /^react($|\/)/,
  /^react-dom($|\/)/,
  /^@preact\/signals(-react)?($|\/)/,
  /^framer-motion($|\/)/,
  /^motion($|\/)/,
  /^motion-dom($|\/)/,
  /^motion-utils($|\/)/,
];

export default defineConfig({
  plugins: [
    react(),
    dts({
      entryRoot: "src",
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.test.tsx",
        "src/dev-entry.tsx",
      ],
      outDir: "dist",
      rollupTypes: true,
      tsconfigPath: "./tsconfig.lib.json",
      // The chantier criterion 8 expects `dist/solar.d.ts` ; we
      // re-publish the rolled bundle under that name post-build via
      // scripts/finalise-dist.mjs to avoid touching the dts plugin's
      // default index.d.ts output.
    }),
  ],
  build: {
    lib: {
      entry: {
        solar: resolve(__dirname, "src/index.ts"),
        "animate/flip": resolve(__dirname, "src/animate/flip.ts"),
      },
      name: "Solar",
      formats: ["es"],
      fileName: (_format, entryName) => {
        if (entryName === "solar") return "solar.js";
        return `${entryName}.js`;
      },
      cssFileName: "solar",
    },
    rollupOptions: {
      external: EXTERNAL,
      output: {
        // Multi-entry ESM keeps chunks per entry ; we still pin
        // friendly names for shared chunks so the dist tree stays
        // legible to consumers reading the tarball manifest.
        chunkFileNames: "chunks/[name]-[hash].js",
      },
    },
    sourcemap: true,
    target: "es2022",
    emptyOutDir: true,
  },
});
