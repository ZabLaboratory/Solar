// Verifies that Solar's per-mode bundles honour the size budget declared in
// chantier-solar.md and that broadcast does not directly load another mode.
//
// The library is a thin adapter over @lumencast/runtime. Vite therefore emits
// runtime-owned chunks whose names can be renamed, re-hashed, or merged on a
// runtime minor update. This check follows the emitted ESM import graph instead
// of treating those internal chunk names as an API.
//
// Run after `npm run build`. Exits non-zero on any violation.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const DIST = resolve(import.meta.dirname, "..", "dist");
const LIBRARY_ENTRY = "solar.js";

// Per-mode budgets, gzipped, in bytes. These target the LIBRARY/runtime
// chunks (externals; react/framer NOT inlined) consumed by Prism.
const BROADCAST_BUDGET = 200 * 1024;
const CONTROL_BUDGET = 280 * 1024;
const TEST_BUDGET = 360 * 1024;

// Dedicated budget for the self-contained HOST bundle (ADR 001 §4): the
// served artefact inlines react + react-dom + @preact/signals-react +
// framer-motion, so it is necessarily much larger than the library chunks.
const HOST_BUDGET = 400 * 1024;

const MODE_EXPORTS = new Map([
  ["BroadcastMode", "broadcast"],
  ["ControlMode", "control"],
  ["TestMode", "test"],
]);

const MODE_BUDGETS = new Map([
  ["broadcast", BROADCAST_BUDGET],
  ["control", CONTROL_BUDGET],
  ["test", TEST_BUDGET],
]);

/**
 * Parse the relative ESM edges that survive in a Vite library build.
 *
 * The generated files are standard ESM, and Vite emits both static imports
 * (`from "./chunk.js"`) and literal dynamic imports (`import("./chunk.js")`).
 * We deliberately ignore bare imports: they are the external React/runtime
 * dependencies of the library build and are not files in this graph.
 */
function parseImports(source) {
  const edges = [];
  const dynamicPattern = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of source.matchAll(dynamicPattern)) {
    const specifier = match[1];
    if (specifier?.startsWith(".")) {
      const mode = modeForDynamicImport(
        source,
        (match.index ?? 0) + match[0].length,
      );
      edges.push({ kind: "dynamic", specifier, mode });
    }
  }

  const staticPattern = /\b(?:from|import)\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(staticPattern)) {
    const specifier = match[1];
    if (specifier?.startsWith(".")) {
      edges.push({ kind: "static", specifier, mode: null });
    }
  }

  return edges;
}

/**
 * Identify the mode selected by a lazy loader without using its emitted file
 * name. The mode export is the stable contract between Solar's loader and the
 * runtime; the surrounding callback is intentionally bounded to avoid
 * matching a later, unrelated lazy import.
 */
function modeForDynamicImport(source, endOffset) {
  const callback = source.slice(endOffset, endOffset + 512);
  for (const [exportName, mode] of MODE_EXPORTS) {
    const pattern = new RegExp(`\\.\\s*${exportName}\\b`);
    if (pattern.test(callback)) return mode;
  }
  return null;
}

function normalizeModuleName(name) {
  return normalize(name).replaceAll("\\", "/");
}

function resolveLocalModule(fromName, specifier, files) {
  const withoutQuery = specifier.split(/[?#]/, 1)[0];
  const candidate = normalizeModuleName(
    join(
      fromName.includes("/")
        ? fromName.slice(0, fromName.lastIndexOf("/"))
        : ".",
      withoutQuery,
    ),
  );
  const candidates = [candidate];
  if (!candidate.endsWith(".js")) candidates.push(`${candidate}.js`);
  candidates.push(`${candidate}/index.js`);
  return candidates.find((entry) => files.has(entry)) ?? null;
}

function collectLibraryFiles(distDir, errors) {
  if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
    errors.push(
      `library dist dir ${distDir} missing — did the library build run?`,
    );
    return new Map();
  }

  const files = new Map();
  for (const name of readdirSync(distDir)) {
    if (!name.endsWith(".js")) continue;
    const source = readFileSync(join(distDir, name), "utf8");
    const buffer = Buffer.from(source);
    files.set(normalizeModuleName(name), {
      name: normalizeModuleName(name),
      source,
      raw: buffer.length,
      gzip: gzipSync(buffer).length,
      edges: [],
    });
  }

  for (const file of files.values()) {
    for (const edge of parseImports(file.source)) {
      const target = resolveLocalModule(file.name, edge.specifier, files);
      if (!target) {
        errors.push(
          `${file.name} imports missing emitted library chunk "${edge.specifier}"`,
        );
        continue;
      }
      file.edges.push({ ...edge, target });
    }
  }

  return files;
}

function reachable(files, roots, includeDynamic, skipDynamicFrom = new Set()) {
  const visited = new Set();
  const pending = [...roots];
  while (pending.length > 0) {
    const name = pending.pop();
    if (!name || visited.has(name)) continue;
    const file = files.get(name);
    if (!file) continue;
    visited.add(name);
    for (const edge of file.edges) {
      if (
        edge.kind === "static" ||
        (includeDynamic && !skipDynamicFrom.has(name))
      ) {
        pending.push(edge.target);
      }
    }
  }
  return visited;
}

function bundleStats(files, names) {
  let raw = 0;
  let gzip = 0;
  for (const name of names) {
    const file = files.get(name);
    if (!file) continue;
    raw += file.raw;
    gzip += file.gzip;
  }
  return {
    raw,
    gzip,
    files: [...names].sort(),
  };
}

function hostStats(hostDir) {
  if (!existsSync(hostDir) || !statSync(hostDir).isDirectory()) return null;

  let raw = 0;
  let gzip = 0;
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (name.endsWith(".js")) {
        const buffer = readFileSync(full);
        raw += buffer.length;
        gzip += gzipSync(buffer).length;
      }
    }
  };
  walk(hostDir);
  return { raw, gzip };
}

/**
 * Analyse a built Solar library and host bundle without writing anything.
 * Exported for the regression test so a renamed/merged runtime chunk is
 * exercised without mutating the repository's dist/ directory.
 */
export function analyzeBundle({
  distDir = DIST,
  hostDir = join(distDir, "host"),
} = {}) {
  const errors = [];
  const files = collectLibraryFiles(distDir, errors);
  const base = reachable(files, [LIBRARY_ENTRY], false);

  if (!files.has(LIBRARY_ENTRY)) {
    errors.push(`library entry "${LIBRARY_ENTRY}" not found in ${distDir}`);
  }

  const modeRoots = new Map([
    ["broadcast", new Set()],
    ["control", new Set()],
    ["test", new Set()],
  ]);

  for (const name of base) {
    const file = files.get(name);
    if (!file) continue;
    for (const edge of file.edges) {
      if (edge.kind !== "dynamic") continue;
      if (!edge.mode) {
        errors.push(
          `${name} has an unmapped local dynamic import "${edge.specifier}"; ` +
            "the bundle check cannot determine its mode",
        );
        continue;
      }
      modeRoots.get(edge.mode)?.add(edge.target);
    }
  }

  const modeNodes = new Map();
  const modeStats = new Map();
  for (const mode of MODE_BUDGETS.keys()) {
    const roots = modeRoots.get(mode);
    if (!roots || roots.size === 0) {
      errors.push(`no emitted entry found for ${mode} mode`);
      modeNodes.set(mode, new Set(base));
      modeStats.set(mode, bundleStats(files, base));
      continue;
    }
    const nodes = new Set(base);
    // The shared loader imports every mode lazily. It belongs in every bundle,
    // but its other lazy edges must not turn one mode's reachability walk into
    // the union of all modes. A truly merged mode root is the exception: if a
    // runtime points a mode directly at a shared loader, count what that
    // loader actually loads.
    const skipDynamicFrom = new Set(base);
    for (const root of roots) {
      if (base.has(root)) skipDynamicFrom.delete(root);
    }
    for (const name of reachable(files, roots, true, skipDynamicFrom)) {
      nodes.add(name);
    }
    modeNodes.set(mode, nodes);
    modeStats.set(mode, bundleStats(files, nodes));
  }

  // Preserve the old tree-shake guard without naming runtime-owned chunks:
  // a broadcast-specific emitted chunk must not directly import a distinct
  // control/test mode entry. If runtime merges entries, the shared target is
  // intentionally accepted and is counted once in each affected mode.
  const broadcastRoots = modeRoots.get("broadcast") ?? new Set();
  const overlayRoots = new Set([
    ...(modeRoots.get("control") ?? []),
    ...(modeRoots.get("test") ?? []),
  ]);
  for (const name of modeNodes.get("broadcast") ?? []) {
    // The shared loader necessarily contains the three dynamic mode imports;
    // inspect only the broadcast-specific emitted chunks for cross-mode leaks.
    if (base.has(name)) continue;
    const file = files.get(name);
    if (!file) continue;
    for (const edge of file.edges) {
      if (overlayRoots.has(edge.target) && !broadcastRoots.has(edge.target)) {
        errors.push(
          `broadcast bundle imports distinct overlay mode entry "${edge.target}"`,
        );
      }
    }
  }

  const host = hostStats(hostDir);
  if (!host)
    errors.push(`host bundle dir ${hostDir} missing — did the host build run?`);
  if (host && host.gzip > HOST_BUDGET) {
    errors.push(`host bundle ${host.gzip} B gz > ${HOST_BUDGET} B budget`);
  }

  for (const [mode, budget] of MODE_BUDGETS) {
    const stats = modeStats.get(mode);
    if (stats && stats.gzip > budget) {
      errors.push(`${mode} bundle ${stats.gzip} B gz > ${budget} B budget`);
    }
  }

  return {
    errors,
    modes: modeStats,
    host,
    modeRoots,
  };
}

function printReport(result) {
  console.log("solar runtime — graph-derived chunk sizes");
  for (const mode of MODE_BUDGETS.keys()) {
    const stats = result.modes.get(mode);
    if (!stats) continue;
    console.log(
      `  ${mode.padEnd(9)}: ${stats.raw} B raw / ${stats.gzip} B gz (unique reachable files)`,
    );
    console.log("    files: %s", stats.files.join(", "));
  }

  if (result.host) {
    console.log("\nsolar host bundle — served artefact (deps inlined)");
    console.log(
      "  host (all js) : %d B raw / %d B gz (sum)",
      result.host.raw,
      result.host.gzip,
    );
  }
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = analyzeBundle();
  printReport(result);

  if (result.errors.length > 0) {
    console.error("\nbundle-size check FAILED:");
    for (const error of result.errors) console.error("  -", error);
    process.exit(1);
  }

  console.log("\nbundle-size check OK");
}
