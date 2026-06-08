import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dts from "vite-plugin-dts";

// Solar is published as @zablab/solar — a single ESM bundle plus
// CSS and types. The HTML wrapper consumed by Pulsar CEF is built
// in a follow-up step (see scripts/build-html.* — out of scope for
// the initial scaffold).

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
        "src/host-entry.tsx",
      ],
      outDir: "dist",
      rollupTypes: true,
      tsconfigPath: "./tsconfig.lib.json",
    }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "Solar",
      formats: ["es"],
      fileName: () => "solar.js",
      cssFileName: "solar",
    },
    rollupOptions: {
      external: [
        /^react($|\/)/,
        /^react-dom($|\/)/,
        /^@preact\/signals(-react)?($|\/)/,
        /^framer-motion($|\/)/,
        /^motion($|\/)/,
        /^motion-dom($|\/)/,
        /^motion-utils($|\/)/,
      ],
      output: {
        globals: {
          react: "React",
          "react-dom": "ReactDOM",
        },
      },
    },
    sourcemap: true,
    target: "es2022",
    emptyOutDir: true,
  },
});
