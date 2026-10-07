#!/usr/bin/env node
/**
 * Reconciles the standalone Vision host HTML after its Vite build.
 *
 * The host Vite target emits a self-contained bundle under `dist/host/`
 * and an HTML file that imports it via a relative module URL.
 * Because Vite names the HTML after its input (`host.html`), this step:
 *
 *   1. renames `host.html` to the served `index.html`;
 *   2. stamps the package version into the generator meta;
 *   3. verifies the entry script remains relative for CEF.
 *
 * The bootstrap lives in src/host-entry.ts and is compiled into the host
 * chunk, so no renderer entry is hand-maintained here.
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

writeFileSync(
  resolve(hostDir, "solar-host-contract.json"),
  JSON.stringify(
    {
      schema_version: "solar.host.contract.v1",
      protocol_version: "solar.host.v2",
      capabilities: [
        "solar.vision.lsml.v1",
        "solar.native-lsdp.v1",
        "solar.source-provider.v1",
      ],
    },
    null,
    2,
  ) + "\n",
);

const bytes = Buffer.byteLength(html, "utf8");
console.log(
  `solar host html  : ${bytes} B raw at ${served} (entry ${entrySrc}, generator @zablab/solar ${pkg.version})`,
);
