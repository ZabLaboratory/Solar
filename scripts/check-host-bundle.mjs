#!/usr/bin/env node
/**
 * Anti-bare-specifier gate for the served host bundle — ADR 001 §6.2,
 * the core guard against the B4 regression.
 *
 * The Pulsar CEF (and Orion's static serve) load `dist/host/index.html`
 * in a bare browser: no bundler, no `<script type="importmap">`. Any ESM
 * import that survives in the served JS with a non-relative, non-absolute
 * specifier (`react`, `react-dom/client`, `@preact/signals-react`,
 * `@preact/signals-react/runtime`, `framer-motion`, `motion*`,
 * `react/jsx-runtime`, …) throws "Failed to resolve module specifier" and
 * mount() never runs → black frame. This script scans every emitted JS
 * chunk under dist/host/ and FAILS CI on any bare specifier.
 *
 * Run after the host build (third-party of `npm run build`). Exits
 * non-zero on any violation — wired into CI as a gate.
 *
 * We match real ESM module-specifier positions only, not arbitrary
 * `from"…"` substrings inside string literals:
 *   - `import … from "<spec>"`            (static import, with bindings)
 *   - `import "<spec>"`                   (side-effect import)
 *   - `export … from "<spec>"`            (re-export)
 *   - `import("<spec>")`                  (static-analysable dynamic import)
 * A specifier is "bare" when it does not start with `.` (relative),
 * `/` (root-absolute), or a URL scheme (`http:`, `https:`, `data:`,
 * `blob:`). Bundled output uses relative chunk URLs; anything bare is a
 * leaked external.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const HOST_DIR = resolve(root, "dist", "host");

/** Recursively collect every .js file under dir. */
function jsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...jsFiles(full));
    else if (name.endsWith(".js")) out.push(full);
  }
  return out;
}

// Module-specifier positions in real ESM statements. Capture group 1 is
// the specifier. Quotes may be `"` or `'`.
const PATTERNS = [
  // import ... from "spec"   /   export ... from "spec"
  /(?:^|[;\n}{)\s])(?:import|export)\b[^()'";]*?\bfrom\s*["']([^"']+)["']/g,
  // side-effect import "spec"  (import directly followed by the string)
  /(?:^|[;\n}{)\s])import\s*["']([^"']+)["']/g,
  // dynamic import("spec")
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
];

function isRelativeOrAbsolute(spec) {
  return (
    spec.startsWith("./") ||
    spec.startsWith("../") ||
    spec.startsWith("/") ||
    /^[a-z][a-z0-9+.-]*:/i.test(spec) // http:, https:, data:, blob:, …
  );
}

if (!statSync(HOST_DIR, { throwIfNoEntry: false })) {
  console.error(
    `check-host-bundle: ${HOST_DIR} does not exist — run the host build first`,
  );
  process.exit(1);
}

const files = jsFiles(HOST_DIR);
if (files.length === 0) {
  console.error(`check-host-bundle: no .js chunks under ${HOST_DIR}`);
  process.exit(1);
}

const violations = [];
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const seen = new Set();
  for (const pattern of PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(src)) !== null) {
      const spec = match[1];
      if (!isRelativeOrAbsolute(spec) && !seen.has(spec)) {
        seen.add(spec);
        violations.push({ file: relative(root, file), spec });
      }
    }
  }
}

console.log(
  `check-host-bundle: scanned ${files.length} JS chunk(s) under dist/host/`,
);

if (violations.length > 0) {
  console.error(
    `\ncheck-host-bundle FAILED — ${violations.length} bare ESM specifier(s) ` +
      `survive in the served host bundle (the CEF cannot resolve these):`,
  );
  for (const v of violations) {
    console.error(`  - ${v.file}: import of bare specifier "${v.spec}"`);
  }
  console.error(
    `\nThe host target must inline all runtime deps (no rollup externals). ` +
      `See ADR 001 — this is the B4 regression guard.`,
  );
  process.exit(1);
}

console.log("check-host-bundle OK — zero bare specifiers in served bundle");
