#!/usr/bin/env node
/**
 * Finalises the published `dist/` shape required by the chantier
 * `Solar action runner` criterion 8 :
 *
 *   - dist/solar.js          — ESM bundle  (already emitted)
 *   - dist/solar.esm.js      — ESM alias   (copy of solar.js)
 *   - dist/solar.umd.js      — UMD bundle  (emitted by vite.config.umd.ts)
 *   - dist/solar.d.ts        — public types (alias of dist/index.d.ts)
 *   - dist/animate/flip.js   — FLIP subpath consumed by Prism
 *
 * The alias copies (solar.esm.js, solar.d.ts) are tiny and keep the
 * external contract stable while leaving the dts plugin's default
 * naming alone.
 */
import {
  copyFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "..", "dist");

function must(path) {
  if (!existsSync(path)) {
    console.error(`finalise-dist: expected artefact missing — ${path}`);
    process.exit(1);
  }
}

must(resolve(dist, "solar.js"));
must(resolve(dist, "animate", "flip.js"));
must(resolve(dist, "solar.d.ts"));

// 1. ESM alias.
copyFileSync(resolve(dist, "solar.js"), resolve(dist, "solar.esm.js"));

// 2. Per-entry type stubs for the subpath exports.
mkdirSync(resolve(dist, "animate"), { recursive: true });
const flipDts = resolve(dist, "animate", "flip.d.ts");
const rolledFlipDts = resolve(dist, "flip.d.ts");
if (existsSync(rolledFlipDts)) {
  copyFileSync(rolledFlipDts, flipDts);
  rmSync(rolledFlipDts);
} else if (!existsSync(flipDts)) {
  // Fallback : re-export the relevant subset from the rolled bundle.
  writeFileSync(
    flipDts,
    `export {\n  captureFlip,\n  playFlip,\n  withFlip,\n} from "../solar";\nexport type { FlipSnapshot, FlipPlayOptions } from "../solar";\n`,
  );
}

// 4. Validate UMD was emitted.
const umd = resolve(dist, "solar.umd.js");
if (!existsSync(umd)) {
  console.error("finalise-dist: dist/solar.umd.js missing — run vite -c vite.config.umd.ts");
  process.exit(1);
}

// 5. Drop the source maps for the alias copies (they reference the
//    original chunk hash and adding a duplicate map only inflates the
//    tarball without buying anything).
for (const candidate of ["solar.esm.js.map"]) {
  const p = resolve(dist, candidate);
  if (existsSync(p)) rmSync(p);
}

console.log(
  "finalise-dist: ok — solar.js / solar.esm.js / solar.umd.js / solar.d.ts / animate/flip.js",
);
// Read and surface gzipped sizes for transparency.
import("node:zlib").then(({ gzipSync }) => {
  const fmt = (n) => `${(n / 1024).toFixed(2)} KiB`;
  for (const f of [
    "solar.js",
    "solar.esm.js",
    "solar.umd.js",
    "animate/flip.js",
  ]) {
    const buf = readFileSync(resolve(dist, f));
    console.log(`  ${f.padEnd(20)} raw=${fmt(buf.length)}  gzip=${fmt(gzipSync(buf).length)}`);
  }
});
