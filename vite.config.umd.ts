import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// UMD bundle for <script>-tag embeds on third-party sites.
// React + react-dom stay external — the host page must load them
// separately and expose them as `window.React` / `window.ReactDOM`,
// per the AI SDK / Preact Signals embed conventions.

const EXTERNAL = [
  "react",
  "react-dom",
  "react-dom/client",
  "@preact/signals-react",
  "framer-motion",
  "motion",
  "motion-dom",
  "motion-utils",
];

export default defineConfig({
  plugins: [react()],
  build: {
    // Don't wipe the ESM artefacts emitted by vite.config.ts.
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "Solar",
      formats: ["umd"],
      fileName: () => "solar.umd.js",
    },
    rollupOptions: {
      external: EXTERNAL,
      output: {
        globals: {
          react: "React",
          "react-dom": "ReactDOM",
          "react-dom/client": "ReactDOM",
          "@preact/signals-react": "PreactSignalsReact",
          "framer-motion": "FramerMotion",
          motion: "Motion",
          "motion-dom": "MotionDom",
          "motion-utils": "MotionUtils",
        },
        exports: "named",
        // Avoid the "named and default exports" rollup warning that
        // would otherwise spam the UMD build because we re-export
        // types alongside the runtime members.
      },
    },
    sourcemap: true,
    target: "es2018",
  },
});
