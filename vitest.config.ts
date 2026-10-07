import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@lumencast/runtime": resolve(
        __dirname,
        "node_modules/@lumencast/runtime/dist/webrtc/index.js",
      ),
    },
  },
  test: {
    environment: "happy-dom",
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
    coverage: {
      reporter: ["text", "html"],
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/types/**"],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
