import { build } from "esbuild";
import { execFileSync } from "node:child_process";
execFileSync(
  process.execPath,
  ["node_modules/typescript/bin/tsc", "-p", "tsconfig.server.json"],
  { stdio: "inherit" },
);
await build({
  entryPoints: ["src/server/index.ts", "src/server/scene-capsule-worker.ts"],
  outdir: "dist/server",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
});
