#!/usr/bin/env node
/**
 * Reconciles the host build's emitted HTML into the served contract
 * (ADR 001 §3.3) — runs as the third step of `npm run build`, after the
 * library build and the host build (`vite build --config vite.config.host.ts`).
 *
 * The host Vite target (app mode, no externals) emits a self-contained
 * bundle under `dist/host/`: a hashed JS chunk that inlines every runtime
 * dep (react / react-dom / @preact/signals-react / framer-motion) and an
 * HTML file that imports it via a RELATIVE module URL (`./assets/host-*.js`).
 * Because Vite names the HTML after its input (`host.html`), this step:
 *
 *   1. renames `dist/host/host.html` → `dist/host/index.html` so the served
 *      contract stays `/static/solar/v{N}/index.html` (D3, unchanged shape);
 *   2. stamps the real package version into `<meta name="generator">`
 *      (resolution criterion 5: generator reflects 0.2.1);
 *   3. asserts the served HTML's entry script is a relative `./` URL — a
 *      cheap guard so the served form can never regress to a bare/absolute
 *      module specifier the CEF can't resolve (D1). The deep
 *      anti-bare-specifier scan of the JS lives in
 *      scripts/check-host-bundle.mjs (CI gate).
 *
 * This is intentionally a thin reconcile, not a hand-rolled bootstrap: the
 * bootstrap now lives in src/host-entry.tsx and is compiled into the
 * hashed chunk, so there is no inlined `import "./solar.js"` to keep in
 * sync with the build's filenames (R3 mitigation).
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const hostDir = resolve(root, "dist", "host");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

const emitted = resolve(hostDir, "host.html");
const served = resolve(hostDir, "index.html");

if (!existsSync(emitted) && !existsSync(served)) {
  console.error(
    `build-host-html: neither dist/host/host.html nor index.html exists — ` +
      `did the host build run? (vite build --config vite.config.host.ts)`,
  );
  process.exit(1);
}

if (existsSync(emitted)) {
  renameSync(emitted, served);
}

let html = readFileSync(served, "utf8");

// Stamp the real version into the generator meta (host.html ships a
// "dev" placeholder for `npm run dev`).
html = html.replace(
  /<meta name="generator" content="@zablab\/solar [^"]*"\s*\/>/,
  `<meta name="generator" content="@zablab/solar ${pkg.version}" />`,
);
if (!html.includes(`@zablab/solar ${pkg.version}`)) {
  console.error(
    `build-host-html: could not stamp generator meta with version ${pkg.version}`,
  );
  process.exit(1);
}

// Guard: the entry module reference must be a relative URL. A bare or
// root-absolute specifier here would not resolve in the CEF (no bundler,
// no import map) — exactly the B4 regression.
const scriptMatch = html.match(/<script[^>]*\bsrc="([^"]+)"[^>]*>/);
if (!scriptMatch) {
  console.error(`build-host-html: no <script src=…> entry in served HTML`);
  process.exit(1);
}
const entrySrc = scriptMatch[1];
if (!entrySrc.startsWith("./") && !entrySrc.startsWith("../")) {
  console.error(
    `build-host-html: entry script "${entrySrc}" is not a relative URL — ` +
      `served bundle would not resolve in the CEF`,
  );
  process.exit(1);
}

writeFileSync(served, html);

const bytes = Buffer.byteLength(html, "utf8");
console.log(
  `solar host html  : ${bytes} B raw at ${served} (entry ${entrySrc}, generator @zablab/solar ${pkg.version})`,
);
