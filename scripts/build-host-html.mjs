#!/usr/bin/env node
/**
 * Generates dist/index.html — the production bootstrap consumed by
 * Pulsar CEF (browser source) and any other Solar host that loads the
 * bundle as a static URL.
 *
 * The harness is the static counterpart of src/dev-entry.tsx :
 * read URL query params, mount() Solar against the requested Orion
 * endpoint with the requested mode/token. Inlined into the HTML so
 * the host fetches a single file plus the already-bundled solar.js.
 *
 * Run as the second step of `npm run build` after `vite build`.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const distDir = resolve(root, "dist");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

mkdirSync(distDir, { recursive: true });

// One file, no external dependencies. Solar's CSS — if any — is
// inlined into solar.js by Vite's library mode, so we don't link a
// stylesheet here. The 100vh black background mirrors broadcast
// hosts' expectation (Pulsar CEF composites this as a transparent
// overlay over the operator's video sources).
const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="generator" content="@zablab/solar ${pkg.version}" />
    <title>Solar</title>
    <style>
      html, body { margin: 0; padding: 0; height: 100%; background: #000; }
      #scene { position: relative; width: 100vw; height: 100vh; overflow: hidden; }
    </style>
  </head>
  <body>
    <div id="scene" data-testid="solar-scene-root"></div>
    <script type="module">
      // Same bootstrap surface as src/dev-entry.tsx, hand-rolled so
      // no extra build entry is needed. Read URL params, fall back
      // to sane defaults, mount() Solar.
      import { mount } from "./solar.js";

      const params = new URLSearchParams(window.location.search);
      const orionUrl = params.get("orion") ?? \`wss://\${location.host}/orion/api/v1/show/stream\`;
      const token = params.get("token") ?? "";
      const modeParam = params.get("mode") ?? "broadcast";
      const mode = ["broadcast", "control", "test"].includes(modeParam) ? modeParam : "broadcast";
      const scene = params.get("scene") ?? undefined;
      const testSession = params.get("session") ?? undefined;

      const target = document.getElementById("scene");
      if (!(target instanceof HTMLElement)) {
        document.body.textContent = "Solar host: #scene target missing";
        throw new Error("solar host: #scene target missing");
      }

      mount({
        target,
        orionUrl,
        token,
        mode,
        ...(mode === "test" && scene ? { scene } : {}),
        ...(mode === "test" && testSession ? { testSession } : {}),
        onError: (err) => {
          // Broadcast hosts must not surface chrome — log to console
          // and let the operator overlay (control/test modes) display
          // a degraded state through Solar's own UI.
          console.error("[solar]", err);
        },
      });
    </script>
  </body>
</html>
`;

const target = resolve(distDir, "index.html");
writeFileSync(target, html);
const bytes = Buffer.byteLength(html, "utf8");
console.log(`solar host html  : ${bytes} B raw at ${target}`);
