// Verifies that Solar's per-mode chunks honour the size budget
// declared in chantier-solar.md and that the broadcast chunk does
// not pull in any overlay (control / test / status-pill) code.
//
// Run after `npm run build`. Exits non-zero on any violation —
// designed to be wired into CI as a separate step.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { resolve, join } from "node:path";

const DIST = resolve(import.meta.dirname, "..", "dist");
const HOST_DIR = resolve(DIST, "host");

// Per-mode budgets, gzipped, in bytes. These target the LIBRARY/runtime
// chunks (externals; react/framer NOT inlined) consumed by Prism.
const BROADCAST_BUDGET = 200 * 1024;
const CONTROL_BUDGET = 280 * 1024;
const TEST_BUDGET = 360 * 1024;

// Dedicated budget for the self-contained HOST bundle (ADR 001 §4): the
// served artefact inlines react + react-dom + @preact/signals-react +
// framer-motion, so it is necessarily much larger than the library
// chunks and is NOT held to the library budgets. Observed ~120 KiB gz
// (the inlined main chunk dominates at ~112 KiB); 400 KiB gz leaves
// headroom for React/Framer growth while still catching a regression
// that doubles the served weight (e.g. a duplicate runtime).
const HOST_BUDGET = 400 * 1024;

// Since ADR 007 (Solar = thin adapter over @lumencast/runtime), the
// per-mode chunks come from the runtime and may carry TWO hash segments
// (the runtime's own chunk hash + Vite's re-bundle hash), e.g.
// `broadcast-BqOhSNsY-8nj7XQpl.js`. Match against the known source names
// rather than trying to guess where the hash boundary is.
const KNOWN_PREFIXES = [
  "solar",
  "index",
  "tree",
  "broadcast",
  "control",
  "test",
  "status-pill",
];

const files = readdirSync(DIST).filter((f) => f.endsWith(".js"));
const fileMap = new Map(); // source name → { full, raw, gzip }
for (const f of files) {
  const buf = readFileSync(join(DIST, f));
  const gzip = gzipSync(buf).length;
  // A chunk maps to a known prefix when its name is exactly the prefix
  // (`solar.js`) or the prefix followed by a hash segment
  // (`broadcast-XXXX[-YYYY].js`). Longest match wins so `status-pill`
  // isn't shadowed by a shorter prefix.
  const match = KNOWN_PREFIXES.filter(
    (p) => f === `${p}.js` || f.startsWith(`${p}-`),
  ).sort((a, b) => b.length - a.length)[0];
  if (match) fileMap.set(match, { full: f, raw: buf.length, gzip });
}

function need(prefix) {
  const entry = fileMap.get(prefix);
  if (!entry) {
    fail(`expected dist chunk for "${prefix}" — not found`);
  }
  return entry;
}

const errors = [];
function fail(msg) {
  errors.push(msg);
}

const solar = need("solar");
const indexShared = need("index");
const tree = need("tree");
const broadcast = need("broadcast");
const control = need("control");
const test = need("test");
const statusPill = need("status-pill");

// --- Per-mode bundle weights ---------------------------------------

const broadcastBundle =
  solar.gzip + indexShared.gzip + tree.gzip + broadcast.gzip;
const controlBundle = broadcastBundle + control.gzip + statusPill.gzip;
const testBundle = controlBundle + test.gzip;

console.log("solar runtime — chunk sizes");
console.log(
  "  broadcast  : %d B raw / %d B gz (sum)",
  solar.raw + indexShared.raw + tree.raw + broadcast.raw,
  broadcastBundle,
);
console.log(
  "  control    : %d B raw / %d B gz (sum)",
  solar.raw +
    indexShared.raw +
    tree.raw +
    broadcast.raw +
    control.raw +
    statusPill.raw,
  controlBundle,
);
console.log(
  "  test       : %d B raw / %d B gz (sum)",
  solar.raw +
    indexShared.raw +
    tree.raw +
    broadcast.raw +
    control.raw +
    statusPill.raw +
    test.raw,
  testBundle,
);

if (broadcastBundle > BROADCAST_BUDGET) {
  fail(
    `broadcast bundle ${broadcastBundle} B gz > ${BROADCAST_BUDGET} B budget`,
  );
}
if (controlBundle > CONTROL_BUDGET) {
  fail(`control bundle ${controlBundle} B gz > ${CONTROL_BUDGET} B budget`);
}
if (testBundle > TEST_BUDGET) {
  fail(`test bundle ${testBundle} B gz > ${TEST_BUDGET} B budget`);
}

// --- Broadcast chunk does not import overlay chunks ---------------

const broadcastSource = readFileSync(join(DIST, broadcast.full), "utf8");

// The chunk's import statements reference the chunks it depends on
// by relative URL. We can grep for the basename of the forbidden
// chunks. If broadcast imports any of them, it's a tree-shake leak.
const FORBIDDEN_FOR_BROADCAST = ["control", "test", "status-pill"];
for (const forbidden of FORBIDDEN_FOR_BROADCAST) {
  const ref = fileMap.get(forbidden);
  if (!ref) continue;
  // Looking for an import like `from"./control-XXXXX.js"` or similar.
  if (broadcastSource.includes(ref.full)) {
    fail(
      `broadcast chunk references "${ref.full}" — overlay code leaked into broadcast mode`,
    );
  }
}

// --- Host bundle budget (self-contained, deps inlined) ------------

if (existsSync(HOST_DIR) && statSync(HOST_DIR).isDirectory()) {
  let hostRaw = 0;
  let hostGzip = 0;
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".js")) {
        const buf = readFileSync(full);
        hostRaw += buf.length;
        hostGzip += gzipSync(buf).length;
      }
    }
  };
  walk(HOST_DIR);

  console.log("\nsolar host bundle — served artefact (deps inlined)");
  console.log("  host (all js) : %d B raw / %d B gz (sum)", hostRaw, hostGzip);

  if (hostGzip > HOST_BUDGET) {
    fail(`host bundle ${hostGzip} B gz > ${HOST_BUDGET} B budget`);
  }
} else {
  fail(`host bundle dir ${HOST_DIR} missing — did the host build run?`);
}

// --- Done ---------------------------------------------------------

if (errors.length > 0) {
  console.error("\nbundle-size check FAILED :");
  for (const e of errors) console.error("  -", e);
  process.exit(1);
}

console.log("\nbundle-size check OK");
