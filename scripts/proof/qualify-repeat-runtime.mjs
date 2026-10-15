/* global document, getComputedStyle, window */
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { createRequire } from "node:module";
import { basename, resolve } from "node:path";
import { parseArgs, promisify } from "node:util";
import { strToU8, zipSync } from "fflate";
import { createServer as createViteServer } from "vite";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");
const { values } = parseArgs({
  options: {
    "prism-root": { type: "string" },
    "playwright-root": { type: "string" },
    "native-bin": { type: "string" },
    out: { type: "string" },
    evidence: { type: "string" },
    stamp: { type: "string" },
    help: { type: "boolean", default: false },
  },
  allowPositionals: false,
});

if (values.help) {
  process.stdout.write(
    "Usage: node scripts/proof/qualify-repeat-runtime.mjs --prism-root <Prism-read-only> --native-bin <lsdpd.exe> --out <private-work-output> --stamp <YYYYMMDDTHHMMSSZ> [--playwright-root <Prism>] [--evidence <Solar-evidence/local-20261015-rejected-mutation-frame/eleven>]\n",
  );
  process.exit(0);
}

for (const key of ["prism-root", "native-bin", "out", "stamp"])
  if (!values[key]?.trim()) throw new Error(`--${key} is required`);
if (!/^20261015T\d{6}Z$/.test(values.stamp))
  throw new Error("--stamp must be the current UTC time as YYYYMMDDTHHMMSSZ");

const prismRoot = resolve(values["prism-root"]);
const playwrightRoot = resolve(values["playwright-root"] ?? prismRoot);
const nativeBinary = resolve(values["native-bin"]);
const out = resolve(values.out);
const evidence = values.evidence ? resolve(values.evidence) : null;
const canonicalEvidence = resolve(
  root,
  "evidence/local-20261015-rejected-mutation-frame/eleven",
);
if (evidence && evidence !== canonicalEvidence)
  throw new Error(`Evidence output must be ${canonicalEvidence}`);

const inputPath = resolve(
  root,
  "tests/fixtures/repeat-runtime/prism-authoring.lsml",
);
const archivePath = resolve(out, `${values.stamp}-prism-repeat.lsmlz`);
const sourcePaths = [
  "src/renderer/src/lib/lsml/to-scene.ts",
  "src/renderer/src/lib/lsml/from-scene.ts",
  "src/renderer/src/lib/lsml/export/containers.ts",
  "src/renderer/src/lib/lsml/export/primitives.ts",
  "src/renderer/src/lib/lsml/import/collections.ts",
  "src/renderer/src/lib/lsml/_test/to-lsml.test.ts",
  "src/renderer/src/lib/lsml/_test/repeat-authoring.test.ts",
  "src/renderer/src/components/canvas/properties/model/repeat-path.ts",
  "src/renderer/src/components/canvas/properties/sections/TextSections.tsx",
];

const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
const vlqAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function decodeVlq(segment) {
  const values = [];
  let value = 0;
  let shift = 0;
  for (const character of segment) {
    const digit = vlqAlphabet.indexOf(character);
    if (digit < 0) throw new Error(`Invalid source-map VLQ digit: ${character}`);
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
      continue;
    }
    const negative = value & 1;
    values.push(negative ? -(value >> 1) : value >> 1);
    value = 0;
    shift = 0;
  }
  if (shift !== 0) throw new Error("Truncated source-map VLQ segment");
  return values;
}
async function mapOpacityWriteStacks(writes) {
  const mapped = [];
  for (const write of writes) {
    const frame = write.stack?.match(/\/assets\/([^/:]+\.js):(\d+):(\d+)/);
    if (!frame) {
      mapped.push({ ...write, sourceMap: null });
      continue;
    }
    const [, asset, lineText, columnText] = frame;
    const generatedLine = Number(lineText);
    const generatedColumn = Number(columnText) - 1;
    const mapPath = resolve(root, "dist/host/assets", `${asset}.map`);
    const mapBytes = await readFile(mapPath);
    const map = JSON.parse(mapBytes.toString("utf8"));
    let source = 0;
    let originalLine = 0;
    let originalColumn = 0;
    let currentGeneratedColumn = 0;
    let selected = null;
    for (const segment of (map.mappings.split(";")[generatedLine - 1] ?? "").split(",")) {
      if (!segment) continue;
      const values = decodeVlq(segment);
      currentGeneratedColumn += values[0];
      if (currentGeneratedColumn > generatedColumn) break;
      if (values.length >= 4) {
        source += values[1];
        originalLine += values[2];
        originalColumn += values[3];
        selected = {
          path: map.sources[source],
          line: originalLine + 1,
          column0: originalColumn,
        };
      }
    }
    mapped.push({
      ...write,
      sourceMap: {
        asset,
        sha256: sha256(mapBytes),
        generated: { line: generatedLine, column0: generatedColumn },
        original: selected,
      },
    });
  }
  return mapped;
}
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const git = async (...args) => {
  const { stdout } = await execFileAsync("git", ["-C", prismRoot, ...args], {
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
};
const jsonResponse = async (response) => {
  const text = await response.text();
  try {
    return { value: JSON.parse(text), text };
  } catch {
    return { value: null, text };
  }
};

await mkdir(out, { recursive: true });
await stat(nativeBinary);
await stat(resolve(root, "dist/host/index.html"));
await stat(resolve(root, "dist/server/index.mjs"));
const optionalUiShim = resolve(out, "prism-vite-shims/is-prop-valid.mjs");
await mkdir(resolve(out, "prism-vite-shims"), { recursive: true });
await writeFile(optionalUiShim, "export default () => true;\n");

const sourceHead = await git("rev-parse", "HEAD");
const sourceStatus = await git("status", "--porcelain", "--", ...sourcePaths);
assert.equal(
  sourceStatus,
  "",
  `Prism authoring/export sources must be clean for provenance: ${sourceStatus}`,
);
const sourceHashes = {};
for (const sourcePath of sourcePaths)
  sourceHashes[sourcePath] = sha256(await readFile(resolve(prismRoot, sourcePath)));

const fixtureInputBytes = await readFile(inputPath);
const fixtureInput = JSON.parse(fixtureInputBytes.toString("utf8"));
const vite = await createViteServer({
  configFile: false,
  root: prismRoot,
  cacheDir: resolve(out, "prism-vite-cache"),
  server: { middlewareMode: true, hmr: false },
  resolve: {
    alias: [
      {
        find: "@emotion/is-prop-valid",
        replacement: optionalUiShim,
      },
      {
        find: "@shared",
        replacement: resolve(prismRoot, "src/shared"),
      },
      {
        find: "@lumencast/compiler",
        replacement: resolve(
          prismRoot,
          "resources/lumencast/compiler/dist/index.js",
        ),
      },
      { find: "@", replacement: resolve(prismRoot, "src/renderer/src") },
    ],
  },
  // This is an optional dependency used only by Prism's bundled motion UI.
  // Keep the require optional during SSR instead of forcing a UI-only package
  // into the serializer's read-only dependency graph.
  ssr: { external: ["@emotion/is-prop-valid"] },
});

let exported;
let rebuilt;
try {
  const compiler = await vite.ssrLoadModule(
    "/resources/lumencast/compiler/dist/index.js",
  );
  const { lsmlToScene } = await vite.ssrLoadModule(
    "/src/renderer/src/lib/lsml/to-scene.ts",
  );
  const { sceneToLsmlz } = await vite.ssrLoadModule(
    "/src/renderer/src/lib/lsml/from-scene.ts",
  );
  const { validateBundle } = await vite.ssrLoadModule(
    "/src/shared/lsml/validate.ts",
  );

  const sourceBundle = await compiler.hashBundle(fixtureInput);
  const imported = lsmlToScene(sourceBundle, new Map(), {
    resolveAsset: (path) => path,
  });
  exported = await sceneToLsmlz(
    imported.scene,
    imported.sourceContext,
    imported.scene.components.length,
  );
  rebuilt = await sceneToLsmlz(
    imported.scene,
    imported.sourceContext,
    imported.scene.components.length,
    { forceRebuild: true },
  );
  await validateBundle(exported.bundle);
  await validateBundle(rebuilt.bundle);
  assert.deepEqual(
    exported.bundle.defaults,
    fixtureInput.defaults,
    "Prism export must preserve the producer collection defaults byte-for-value",
  );
  assert.deepEqual(
    rebuilt.bundle.defaults,
    fixtureInput.defaults,
    "Prism fresh rebuild must preserve the producer collection defaults byte-for-value",
  );
  assert.equal(exported.warnings.length, 0, "Prism source-preserving export reported warnings");
  assert.equal(rebuilt.warnings.length, 0, "Prism fresh rebuild reported warnings");
} finally {
  await vite.close();
}
assert.equal(
  await git("rev-parse", "HEAD"),
  sourceHead,
  "Prism HEAD changed while its read-only serializer was being exercised",
);
assert.equal(
  await git("status", "--porcelain", "--", ...sourcePaths),
  "",
  "Prism authoring/export source changed during fixture generation",
);

function inspectBundle(bundle) {
  const repeats = [];
  const textBindings = [];
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.kind === "repeat") repeats.push(node);
    if (node.kind === "text" && typeof node.bind?.value === "string")
      textBindings.push(node.bind.value);
    if (Array.isArray(node.children)) node.children.forEach(visit);
    if (node.template) visit(node.template);
  }
  visit(bundle.layout);
  return { repeats, textBindings };
}
const exportedStructure = inspectBundle(exported.bundle);
const rebuiltStructure = inspectBundle(rebuilt.bundle);
const exportedRepeats = exportedStructure.repeats;
const exportedTextBindings = exportedStructure.textBindings;
function assertRepeatContract(structure, label) {
  assert.deepEqual(
    structure.repeats.map((node) => node.bind?.items),
    ["teams", "{team}.players"],
    `${label} must retain outer and scoped collection paths`,
  );
  assert.equal(structure.repeats[0].limit, undefined, `${label} outer team Repeat must omit an item cap`);
  assert.equal(structure.repeats[1].limit, 2, `${label} inner player Repeat must preserve its explicit two-item limit`);
  for (const path of [
    "{team}.name",
    "{team}.code",
    "{player}.name",
    "{player}.score",
  ])
    assert.ok(structure.textBindings.includes(path), `${label} lost text path ${path}`);
}
assertRepeatContract(exportedStructure, "Prism source-preserving export");
assertRepeatContract(rebuiltStructure, "Prism fresh rebuild");

const exportedLsml = JSON.stringify(exported.bundle, null, 2) + "\n";
const rebuiltLsml = JSON.stringify(rebuilt.bundle, null, 2) + "\n";
const exportedBytes = strToU8(JSON.stringify(exported.bundle));
const archiveBytes = zipSync({ "scene.lsml": exportedBytes });
const rebuiltEvidence = resolve(out, `${values.stamp}-repeat-prism-rebuild.lsml`);
await writeFile(rebuiltEvidence, rebuiltLsml);
await writeFile(archivePath, archiveBytes);
const archiveSha256 = sha256(archiveBytes);
const nativeSha256 = sha256(await readFile(nativeBinary));
const visionPresenterPath = "src/engine/vision-presenter.ts";
const visionPresenterSha256 = sha256(
  await readFile(resolve(root, visionPresenterPath)),
);
const nativeManifestPath = resolve(
  root,
  "../eleven-local-20261015-project-integration/dist/native/manifest.json",
);
let nativeManifest = null;
try {
  nativeManifest = JSON.parse(await readFile(nativeManifestPath, "utf8"));
} catch {
  // The separately supplied native executable may be outside the sibling build.
}

const workFiles = [];
const report = {
  schema: "solar.repeat-runtime-qualification.v1",
  stamp: values.stamp,
  boundary:
    "one private local Solar scene; Prism serializer provenance; native LSDP collection updates; Solar-pinned Vision WASM front-canvas pixels; no transition or scene-selection test",
  prism: {
    root: prismRoot,
    head: sourceHead,
    relevantWorkingTreeStatus: sourceStatus || "clean",
    fixtureInputSha256: sha256(fixtureInputBytes),
    sourceHashes,
  },
  export: {
    runtimeMode: "Prism source-preserving sceneToLsmlz output",
    lsmlSha256: sha256(Buffer.from(exportedLsml)),
    archiveSha256,
    sceneId: exported.bundle.scene_id,
    sceneVersion: exported.bundle.scene_version,
    defaultsPreserved: true,
    defaults: exported.bundle.defaults,
    repeatCollections: exportedRepeats.map((node) => ({
      items: node.bind.items,
      scope: node.scope,
      key: node.key,
      limit: node.limit,
    })),
    textBindings: exportedTextBindings,
    warnings: exported.warnings,
    freshRebuild: {
      lsmlSha256: sha256(Buffer.from(rebuiltLsml)),
      sceneVersion: rebuilt.bundle.scene_version,
      repeatCollections: rebuiltStructure.repeats.map((node) => ({
        items: node.bind.items,
        scope: node.scope,
        key: node.key,
        limit: node.limit,
      })),
      textBindings: rebuiltStructure.textBindings,
      warnings: rebuilt.warnings,
    },
  },
  solar: {
    head: (await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      windowsHide: true,
    })).stdout.trim(),
    visionAssets: JSON.parse(
      await readFile(resolve(root, "public/vision/vision-assets.json"), "utf8"),
    ),
    nativeBinary,
    nativeSha256,
    nativeManifest,
    visionPresenterPath,
    visionPresenterSha256,
  },
  phases: [],
  prismSerializerEnvironment: {
    optionalUiDependency: "isolated in a scratch-only shim; not part of importer/exporter calls",
  },
  process: { nativeHostPid: null, nativePid: null, browser: null },
};

const rootLayout = exported.bundle.layout;
assert.equal(exported.bundle.scene_id, "repeat-runtime-proof");
assert.equal(rootLayout.kind, "frame");

let host;
let browser;
let page;
let hostExit;
let hostStdout = "";
let hostStderr = "";
let serverOrigin;
let hostProcessExited = false;

async function unusedLoopbackPort() {
  const probe = createNetServer();
  await new Promise((resolveListen, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolveListen);
  });
  const address = probe.address();
  if (!address || typeof address === "string")
    throw new Error("Could not allocate a local HTTP port");
  await new Promise((resolveClose, reject) =>
    probe.close((error) => (error ? reject(error) : resolveClose())),
  );
  return address.port;
}

async function getHealth() {
  const response = await fetch(`${serverOrigin}/health`, {
    signal: AbortSignal.timeout(1500),
  });
  if (!response.ok) throw new Error(`Local health returned ${response.status}`);
  return response.json();
}

async function readState() {
  const response = await fetch(`${serverOrigin}/state`, {
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`Local state returned ${response.status}`);
  const payload = await response.json();
  return payload?.value && typeof payload.value === "object"
    ? { value: payload.value, stateHash: payload.stateHash ?? null }
    : payload?.state && typeof payload.state === "object"
      ? { value: payload.state, stateHash: payload.stateHash ?? null }
      : { value: payload, stateHash: payload?.stateHash ?? null };
}

async function waitForHealth() {
  const until = Date.now() + 30_000;
  let lastError;
  while (Date.now() < until) {
    if (host?.exitCode !== null && host?.exitCode !== undefined)
      throw new Error(
        `Private native host exited ${host.exitCode}: ${hostStderr || hostStdout}`,
      );
    try {
      const health = await getHealth();
      report.process.nativePid = health.nativePid;
      return health;
    } catch (error) {
      lastError = error;
      await sleep(100);
    }
  }
  throw new Error(`Private native host did not become available: ${lastError}`);
}

async function waitForEvent(type, priorCount, timeout = 12_000) {
  const until = Date.now() + timeout;
  let last = [];
  while (Date.now() < until) {
    const health = await getHealth();
    last = health.events ?? [];
    const matching = last.filter((event) => event.type === type);
    if (matching.length > priorCount) return matching.at(-1);
    await sleep(80);
  }
  throw new Error(
    `Timed out waiting for Solar ${type}; latest diagnostics: ${JSON.stringify(last)}`,
  );
}

async function readSolarStatus() {
  return page.evaluate(
    () => document.documentElement.dataset.solarStatus ?? null,
  );
}

async function waitForSolarStatus(expected, timeout = 30_000) {
  const until = Date.now() + timeout;
  let last = null;
  while (Date.now() < until) {
    last = await readSolarStatus();
    if (last === expected) return last;
    await sleep(80);
  }
  throw new Error(
    `Solar status did not become ${expected}; latest status: ${JSON.stringify(last)}`,
  );
}

function processExists(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopOwnedProcesses() {
  await browser?.close().catch(() => {});
  browser = null;
  if (!host && !report.process.nativePid) {
    report.process.nativeHostExited = true;
    report.process.nativeProcessExited = true;
    hostProcessExited = true;
    return { hostProcessExited: true, nativeProcessExited: true };
  }
  if (host && host.exitCode === null) {
    host.kill("SIGINT");
    await Promise.race([hostExit, sleep(5000)]);
    if (host.exitCode === null) {
      const killTree = spawn(
        "taskkill.exe",
        ["/PID", String(host.pid), "/T", "/F"],
        { windowsHide: true, stdio: "ignore" },
      );
      await new Promise((resolveKill) => killTree.once("exit", resolveKill));
      await Promise.race([hostExit, sleep(3000)]);
    }
  }
  hostProcessExited = Boolean(
    host && (host.exitCode !== null || !processExists(host.pid)),
  );
  const nativePid = report.process.nativePid;
  let nativeProcessExited = !processExists(nativePid);
  if (!nativeProcessExited) {
    const killNativeTree = spawn(
      "taskkill.exe",
      ["/PID", String(nativePid), "/T", "/F"],
      { windowsHide: true, stdio: "ignore" },
    );
    await new Promise((resolveKill) => killNativeTree.once("exit", resolveKill));
    await sleep(250);
    nativeProcessExited = !processExists(nativePid);
  }
  report.process.nativeHostExited = hostProcessExited;
  report.process.nativeProcessExited = nativeProcessExited;
  return { hostProcessExited, nativeProcessExited };
}

async function sendMutation(label, operations, mode = "accepted") {
  const beforeHealth = await getHealth();
  const beforeState = await readState();
  const beforeEvents = beforeHealth.events ?? [];
  const beforeApplied = beforeEvents.filter((event) => event.type === "applied").length;
  const beforeErrors = beforeEvents.filter((event) => event.type === "error").length;
  const response = await fetch(`${serverOrigin}/mutations?resource=scene`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(operations),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await jsonResponse(response);
  let solarEvent = null;
  if (mode === "accepted" || mode === "native-only") {
    assert.equal(response.status, 200, `${label} native LSDP request failed: ${body.text}`);
    if (mode === "accepted") solarEvent = await waitForEvent("applied", beforeApplied);
  } else {
    try {
      solarEvent = await waitForEvent("error", beforeErrors, 5_000);
    } catch {
      // Some accepted-then-refused patches produce the console error after the
      // bounded native receipt; the visual state and authoritative payload below
      // remain the stronger outcome checks.
    }
  }
  const afterState = await readState();
  const phase = {
    label,
    operations,
    httpStatus: response.status,
    response: body.value ?? body.text,
    stateHashBefore: beforeState.stateHash,
    stateHashAfter: afterState.stateHash,
    stateHashChanged: beforeState.stateHash !== afterState.stateHash,
    solarEvent,
    appliedEventsBefore: beforeApplied,
    errorEventsBefore: beforeErrors,
    pageErrors: [...pageErrors],
    solarStatusAfterRequest: await readSolarStatus(),
  };
  report.phases.push(phase);
  return { phase, state: afterState.value };
}

async function readSurface(keepPrevious = false) {
  return page.evaluate(async (shouldKeepPrevious) => {
    const root = document.getElementById("scene");
    if (!root) return null;
    const candidates = [...root.querySelectorAll("canvas")];
    let canvas = null;
    let context = null;
    for (const candidate of candidates.reverse()) {
      if (!candidate.width || !candidate.height) continue;
      try {
        const next = candidate.getContext("2d");
        if (next) {
          canvas = candidate;
          context = next;
          break;
        }
      } catch {
        // A WebGL canvas is expected beside the readable Solar front canvas.
      }
    }
    if (!canvas || !context) return null;
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = image.data;
    const hashBytes = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
    const digest = await crypto.subtle.digest("SHA-256", hashBytes);
    const sha256 = [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    const rowCounts = new Uint32Array(canvas.height);
    let brightPixels = 0;
    let minX = canvas.width;
    let minY = canvas.height;
    let maxX = -1;
    let maxY = -1;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const red = pixels[offset];
      const green = pixels[offset + 1];
      const blue = pixels[offset + 2];
      const alpha = pixels[offset + 3];
      if (alpha < 180 || red < 205 || green < 205 || blue < 205) continue;
      const index = offset / 4;
      const y = Math.floor(index / canvas.width);
      const x = index - y * canvas.width;
      rowCounts[y] += 1;
      brightPixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    const bands = [];
    let band = null;
    for (let y = 0; y < rowCounts.length; y++) {
      const count = rowCounts[y];
      if (count < 3) continue;
      if (band && y - band.bottom <= 2) {
        band.bottom = y;
        band.brightPixelRows += count;
      } else {
        if (band) bands.push(band);
        band = { top: y, bottom: y, brightPixelRows: count };
      }
    }
    if (band) bands.push(band);
    const rect = canvas.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    const sceneLayer = canvas.closest("[data-solar-vision-scene]");
    const layerStyle = sceneLayer ? getComputedStyle(sceneLayer) : null;
    const canvasStyle = getComputedStyle(canvas);
    const layerOpacity = layerStyle ? Number(layerStyle.opacity) : null;
    const canvasOpacity = Number(canvasStyle.opacity);
    const frontCanvasVisible = Boolean(
      sceneLayer &&
        layerStyle &&
        layerStyle.display !== "none" &&
        layerStyle.visibility !== "hidden" &&
        layerOpacity > 0 &&
        canvasStyle.display !== "none" &&
        canvasStyle.visibility !== "hidden" &&
        canvasOpacity > 0 &&
        rect.width > 0 &&
        rect.height > 0,
    );
    const prior = window.__solarRepeatPreviousPixels;
    let diff = null;
    if (prior && prior.width === canvas.width && prior.height === canvas.height) {
      let changedPixels = 0;
      let left = canvas.width;
      let top = canvas.height;
      let right = -1;
      let bottom = -1;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (
          pixels[offset] === prior.pixels[offset] &&
          pixels[offset + 1] === prior.pixels[offset + 1] &&
          pixels[offset + 2] === prior.pixels[offset + 2] &&
          pixels[offset + 3] === prior.pixels[offset + 3]
        ) continue;
        const index = offset / 4;
        const y = Math.floor(index / canvas.width);
        const x = index - y * canvas.width;
        changedPixels += 1;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
      diff = changedPixels
        ? { changedPixels, bounds: { left, top, right, bottom } }
        : { changedPixels: 0, bounds: null };
    }
    if (shouldKeepPrevious)
      window.__solarRepeatPreviousPixels = {
        width: canvas.width,
        height: canvas.height,
        pixels: new Uint8ClampedArray(pixels),
      };
    return {
      sha256,
      dimensions: { width: canvas.width, height: canvas.height },
      rootRect: {
        x: rootRect.x,
        y: rootRect.y,
        width: rootRect.width,
        height: rootRect.height,
      },
      frontCanvasRect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      frontCanvasVisible,
      visibility: {
        sceneVersion: sceneLayer?.dataset.solarVisionScene ?? null,
        layerOpacity,
        layerDisplay: layerStyle?.display ?? null,
        layerVisibility: layerStyle?.visibility ?? null,
        canvasOpacity,
        canvasDisplay: canvasStyle.display,
        canvasVisibility: canvasStyle.visibility,
      },
      canvasCount: candidates.length,
      brightPixels,
      brightBounds:
        brightPixels > 0 ? { left: minX, top: minY, right: maxX, bottom: maxY } : null,
      brightBands: bands,
      diffFromPreviousCapture: diff,
    };
  }, keepPrevious);
}

async function waitForStableSurface(timeout = 15_000) {
  const until = Date.now() + timeout;
  let previous = null;
  let matching = 0;
  let last = null;
  while (Date.now() < until) {
    last = await readSurface(false);
    if (last && last.brightPixels > 0 && last.frontCanvasVisible) {
      if (last.sha256 === previous) matching += 1;
      else matching = 0;
      if (matching >= 2) return last;
      previous = last.sha256;
    }
    await sleep(100);
  }
  throw new Error(`Solar visible front canvas did not stabilize with text pixels: ${JSON.stringify(last)}`);
}

async function waitForVisibility(expectedVisible, timeout = 12_000) {
  const until = Date.now() + timeout;
  let last = null;
  while (Date.now() < until) {
    last = await readSurface(false);
    if (last?.frontCanvasVisible === expectedVisible) return last;
    await sleep(80);
  }
  throw new Error(
    `Solar front canvas visibility did not become ${expectedVisible}: ${JSON.stringify(last)}`,
  );
}

async function capture(label, { expectedVisible = true } = {}) {
  if (expectedVisible) await waitForStableSurface();
  else await waitForVisibility(false);
  const path = resolve(out, `${values.stamp}-${label}.png`);
  const screenshotBytes = await page.screenshot({ path, fullPage: true });
  const surface = await readSurface(true);
  assert.ok(surface?.brightPixels > 0, `${label} had no bright text pixels`);
  assert.equal(
    surface.frontCanvasVisible,
    expectedVisible,
    `${label} front-canvas CSS visibility did not match the expected state`,
  );
  workFiles.push(path);
  const record = {
    label,
    screenshot: path,
    screenshotSha256: sha256(screenshotBytes),
    solarStatus: await readSolarStatus(),
    ...surface,
  };
  report.phases.push({ label: `${label}-pixels`, surface: record });
  return record;
}

async function instrumentSceneLayerOpacity() {
  return page.evaluate(() => {
    const layer = document.querySelector(
      "#scene [data-solar-vision-scene]",
    );
    if (!layer) return { installed: false, reason: "scene layer missing" };
    const style = layer.style;
    let prototype = Object.getPrototypeOf(style);
    while (
      prototype &&
      !Object.getOwnPropertyDescriptor(prototype, "opacity")
    )
      prototype = Object.getPrototypeOf(prototype);
    const descriptor = prototype
      ? Object.getOwnPropertyDescriptor(prototype, "opacity")
      : null;
    if (descriptor && (!descriptor.get || !descriptor.set))
      return { installed: false, reason: "opacity accessor incomplete" };
    const getOpacity = () =>
      descriptor?.get
        ? descriptor.get.call(style)
        : style.getPropertyValue("opacity");
    const setOpacity = (value) => {
      if (descriptor?.set) descriptor.set.call(style, value);
      else style.setProperty("opacity", String(value));
    };
    try {
      window.__solarRepeatOpacityWrites = [];
      Object.defineProperty(style, "opacity", {
        configurable: true,
        enumerable: true,
        get() {
          return getOpacity();
        },
        set(value) {
          const before = getOpacity();
          setOpacity(value);
          const after = getOpacity();
          if (before !== after)
            window.__solarRepeatOpacityWrites.push({
              before,
              after,
              stack: new Error("Solar scene layer opacity write").stack,
            });
        },
      });
      return {
        installed: true,
        mechanism: descriptor?.set ? "css-style-accessor" : "css-style-set-property-fallback",
        layerVersion: layer.dataset.solarVisionScene ?? null,
        initialOpacity: style.opacity,
      };
    } catch (error) {
      return { installed: false, reason: String(error) };
    }
  });
}

async function postMutations(label, operations, expectApplied = true) {
  const beforeHealth = await getHealth();
  const beforeEvents = beforeHealth.events ?? [];
  const beforeApplied = beforeEvents.filter((event) => event.type === "applied").length;
  const beforeErrors = beforeEvents.filter((event) => event.type === "error").length;
  const outcome = await sendMutation(label, operations, expectApplied ? "accepted" : "rejected");
  if (expectApplied) {
    assert.ok(outcome.phase.stateHashChanged, `${label} did not change native LSDP state`);
    const applied = outcome.phase.solarEvent;
    assert.ok(applied, `${label} has no completed Solar presentation event`);
    assert.ok(
      applied.stateHash || applied.presentation,
      `${label} presentation event has no state or presentation receipt`,
    );
    const afterHealth = await getHealth();
    assert.ok(
      (afterHealth.events ?? []).filter((event) => event.type === "applied").length > beforeApplied,
      `${label} has no new Solar applied event`,
    );
    return outcome;
  }

  const duplicateState = outcome.state?.defaults?.teams?.[0]?.players;
  assert.ok(Array.isArray(duplicateState), "Rejected update was not present in private native state");
  assert.equal(duplicateState[0]?.id, duplicateState[1]?.id, "Malformed duplicate-key payload was not admitted for rejection");
  const afterHealth = await getHealth();
  const appliedAfter = (afterHealth.events ?? []).filter((event) => event.type === "applied").length;
  const errorAfter = (afterHealth.events ?? []).filter((event) => event.type === "error").length;
  const newErrors = errorAfter - beforeErrors;
  const acceptedAsApplied =
    outcome.phase.response?.receipt?.level === "applied" ||
    outcome.phase.response?.receipt?.level === "received";
  const explicitNativeRejection =
    outcome.phase.httpStatus >= 400 ||
    outcome.phase.response?.receipt?.level === "rejected" ||
    outcome.phase.response?.level === "rejected";
  assert.ok(
    explicitNativeRejection || newErrors > 0,
    "Malformed duplicate-key update produced neither a native rejection nor a Solar error",
  );
  assert.equal(
    appliedAfter,
    beforeApplied,
    "Malformed duplicate-key update emitted a completed Solar presentation event",
  );
  outcome.phase.acceptedNativeReceiptBeforeRenderRefusal = acceptedAsApplied;
  outcome.phase.solarAppliedEventCountAfterRequest = appliedAfter;
  outcome.phase.nativeStateContainsDuplicateKeys = true;
  outcome.phase.solarErrorEventsAfterRequest = newErrors;
  outcome.phase.nativeAuthorityRemainsMalformedUntilShutdown = true;
  return outcome;
}

const pageErrors = [];
const consoleErrors = [];
const networkFailures = [];
try {
  const port = await unusedLoopbackPort();
  serverOrigin = `http://127.0.0.1:${port}`;
  host = spawn(
    process.execPath,
    [
      resolve(root, "scripts/native-lsdp-local.mjs"),
      "--scene",
      archivePath,
      "--lsdp-bin",
      nativeBinary,
      "--port",
      String(port),
    ],
    {
      cwd: root,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  hostExit = new Promise((resolveExit) => host.once("exit", resolveExit));
  host.stdout.on("data", (chunk) => {
    hostStdout = (hostStdout + chunk.toString("utf8")).slice(-16_000);
  });
  host.stderr.on("data", (chunk) => {
    hostStderr = (hostStderr + chunk.toString("utf8")).slice(-16_000);
  });
  await waitForHealth();
  report.process.nativeHostPid = host.pid;

  const require = createRequire(resolve(playwrightRoot, "package.json"));
  const { chromium } = require("playwright");
  browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
  });
  report.process.browser = browser.version();
  page = await browser.newPage({ viewport: { width: 1100, height: 650 } });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      networkFailures.push({ status: response.status(), url: response.url() });
  });
  const health = await getHealth();
  const url = `${serverOrigin}/host.html?lsdp=${encodeURIComponent(health.native)}&resource=scene&mode=control`;
  const navigation = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  assert.equal(navigation?.status(), 200, "Solar host page failed to load");
  await page.waitForFunction(
    () => document.querySelectorAll("#scene canvas").length > 0,
    undefined,
    { timeout: 30_000 },
  );
  const initialState = await waitForStableSurface();
  report.initialSurface = initialState;
  report.initialNativeState = await readState();
  report.initialSolarEvents = (await getHealth()).events ?? [];
  if (initialState.brightBands.length < 7) {
    await page.screenshot({
      path: resolve(out, `${values.stamp}-initial-diagnostic.png`),
      fullPage: true,
    });
    throw new Error(
      `Initial repeated team/player text rows are missing: ${JSON.stringify(initialState)}`,
    );
  }
  const initial = await capture("repeat-initial");

  const scalar = await postMutations(
    "player-leaf-update",
    [
      {
        op: "replace",
        path: "/defaults/teams/0/players/0/score",
        value: "19",
      },
    ],
  );
  const scalarCapture = await capture("repeat-scalar-update");
  assert.notEqual(scalarCapture.sha256, initial.sha256, "Player leaf update did not change rendered pixels");
  assert.ok(scalarCapture.diffFromPreviousCapture?.changedPixels > 0);

  const reorderedTeams = [
    fixtureInput.defaults.teams[1],
    fixtureInput.defaults.teams[0],
  ];
  const reordered = await postMutations(
    "outer-team-reorder",
    [{ op: "replace", path: "/defaults/teams", value: reorderedTeams }],
  );
  const reorderedCapture = await capture("repeat-team-reordered");
  assert.notEqual(reorderedCapture.sha256, scalarCapture.sha256, "Keyed outer reorder did not change rendered pixels");

  const blueWithAddedPlayer = {
    ...reorderedTeams[0],
    players: [
      { id: "b-i", name: "IVY", score: "99" },
      ...reorderedTeams[0].players,
    ],
  };
  const added = await postMutations(
    "scoped-player-addition",
    [{ op: "replace", path: "/defaults/teams/0/players", value: blueWithAddedPlayer.players }],
  );
  const addedCapture = await capture("repeat-player-added");
  assert.notEqual(addedCapture.sha256, reorderedCapture.sha256, "Added player within the limit did not change rendered pixels");

  const blueAfterRemoval = {
    ...blueWithAddedPlayer,
    players: blueWithAddedPlayer.players.slice(1),
  };
  const removed = await postMutations(
    "scoped-player-removal",
    [{ op: "replace", path: "/defaults/teams/0/players", value: blueAfterRemoval.players }],
  );
  const removedCapture = await capture("repeat-player-removed");
  assert.notEqual(removedCapture.sha256, addedCapture.sha256, "Removed player did not change rendered pixels");
  report.visibilityInstrumentation = {
    setup: await instrumentSceneLayerOpacity(),
  };

  const malformedBlue = [
    { ...blueAfterRemoval.players[0], id: "duplicate" },
    { ...blueAfterRemoval.players[1], id: "duplicate" },
    ...blueAfterRemoval.players.slice(2),
  ];
  const rejected = await postMutations(
    "duplicate-key-rejection",
    [{ op: "replace", path: "/defaults/teams/0/players", value: malformedBlue }],
    false,
  );
  const rejectedCapture = await capture("repeat-duplicate-key-rejected", {
    expectedVisible: true,
  });
  report.visibilityInstrumentation.errorWrites = await page.evaluate(
    () => window.__solarRepeatOpacityWrites ?? [],
  );
  report.visibilityInstrumentation.mappedErrorWrites =
    await mapOpacityWriteStacks(report.visibilityInstrumentation.errorWrites);
  report.visibilityDiagnosis = {
    nativeReceiptLevel: rejected.phase.response?.receipt?.level ?? null,
    rendererError: rejected.phase.solarEvent?.message ?? null,
    retainedCanvasHashBeforeAndAfter: {
      before: removedCapture.sha256,
      after: rejectedCapture.sha256,
      unchanged: removedCapture.sha256 === rejectedCapture.sha256,
    },
    pageScreenshotHashBeforeAndAfter: {
      before: removedCapture.screenshotSha256,
      after: rejectedCapture.screenshotSha256,
      unchanged: removedCapture.screenshotSha256 === rejectedCapture.screenshotSha256,
    },
    computedLayerOpacity: rejectedCapture.visibility.layerOpacity,
    layerBecameHiddenAfterError: report.visibilityInstrumentation.errorWrites.some(
      (write) => write.before === "1" && write.after === "0",
    ),
    opacityWriteSourceMaps:
      report.visibilityInstrumentation.mappedErrorWrites.map(
        ({ sourceMap }) => sourceMap,
      ),
  };
  assert.equal(
    rejectedCapture.sha256,
    removedCapture.sha256,
    "Rejected duplicate-key update changed retained front-canvas backing pixels",
  );
  assert.equal(
    rejectedCapture.diffFromPreviousCapture?.changedPixels,
    0,
    "Rejected update changed retained front-canvas backing pixels",
  );
  assert.equal(
    rejectedCapture.frontCanvasVisible,
    true,
    "Duplicate-key rejection hid the last accepted frame",
  );
  assert.equal(
    rejectedCapture.screenshotSha256,
    removedCapture.screenshotSha256,
    "Duplicate-key rejection changed the page-level screenshot",
  );
  assert.equal(
    rejected.phase.acceptedNativeReceiptBeforeRenderRefusal,
    true,
    "Malformed collection did not reach Vision through the native receiver",
  );
  assert.ok(
    String(rejected.phase.solarEvent?.message ?? "").includes("Vision load:"),
    "Duplicate-key update did not preserve the surfaced Vision load error",
  );

  const statusBeforeCorrection = await readSolarStatus();
  assert.notEqual(
    statusBeforeCorrection,
    "live",
    "Solar unexpectedly reported live while its native snapshot was malformed",
  );
  const correction = await sendMutation(
    "valid-collection-snapshot-correction",
    [
      {
        op: "replace",
        path: "/defaults/teams/0/players",
        value: blueAfterRemoval.players,
      },
    ],
    "native-only",
  );
  assert.ok(
    correction.phase.stateHashChanged,
    "Corrected collection did not change the native snapshot hash",
  );
  const correctedPlayers = correction.state?.defaults?.teams?.[0]?.players;
  assert.ok(Array.isArray(correctedPlayers));
  assert.equal(
    new Set(correctedPlayers.map((player) => player.id)).size,
    correctedPlayers.length,
    "Corrected native snapshot still contains duplicate Repeat keys",
  );
  assert.equal(
    correction.phase.solarEvent,
    null,
    "Native correction unexpectedly manufactured a Solar presentation receipt",
  );
  const liveStatus = await waitForSolarStatus("live");
  const healthAfterSnapshot = await getHealth();
  const appliedAfterSnapshot = (healthAfterSnapshot.events ?? []).filter(
    (event) => event.type === "applied",
  ).length;
  assert.equal(
    appliedAfterSnapshot,
    correction.phase.appliedEventsBefore,
    "Snapshot recovery emitted an unexpected completed-frame event before a live mutation",
  );
  correction.phase.solarStatusBeforeCorrection = statusBeforeCorrection;
  correction.phase.solarStatusAfterCorrectionSnapshot = liveStatus;
  correction.phase.snapshotReceiptExpected = false;
  correction.phase.appliedEventsAfterCorrectionSnapshot = appliedAfterSnapshot;
  const recoveredCapture = await capture("repeat-corrected-snapshot-live");
  assert.equal(recoveredCapture.solarStatus, "live");
  assert.equal(
    recoveredCapture.frontCanvasVisible,
    true,
    "Corrected valid collection snapshot did not retain a visible scene",
  );
  assert.deepEqual(
    recoveredCapture.brightBands.map(({ top, bottom }) => [top, bottom]),
    removedCapture.brightBands.map(({ top, bottom }) => [top, bottom]),
    "Corrected snapshot changed the last accepted text row positions",
  );

  const playersAfterRecoveryReorder = [...blueAfterRemoval.players].reverse();
  const recovered = await postMutations(
    "valid-collection-reorder-after-snapshot-recovery",
    [
      {
        op: "replace",
        path: "/defaults/teams/0/players",
        value: playersAfterRecoveryReorder,
      },
    ],
  );
  const reorderedAfterRecoveryCapture = await capture(
    "repeat-valid-collection-reordered-after-recovery",
  );
  assert.notEqual(
    reorderedAfterRecoveryCapture.sha256,
    removedCapture.sha256,
    "Post-recovery collection mutation did not change visible pixels",
  );
  assert.ok(
    reorderedAfterRecoveryCapture.diffFromPreviousCapture?.changedPixels > 0,
    "Post-recovery collection mutation did not change canvas pixels",
  );
  assert.ok(
    recovered.phase.solarEvent,
    "Post-recovery collection mutation did not receive a Solar presentation event",
  );

  const resumedValue = "73";
  const resumed = await postMutations(
    "valid-scalar-after-duplicate-key-recovery",
    [
      {
        op: "replace",
        path: "/defaults/teams/0/players/0/score",
        value: resumedValue,
      },
    ],
  );
  const resumedCapture = await capture("repeat-valid-scalar-resumed");
  assert.notEqual(
    resumedCapture.sha256,
    reorderedAfterRecoveryCapture.sha256,
    "Valid scalar mutation after recovery did not change visible pixels",
  );
  assert.ok(resumedCapture.diffFromPreviousCapture?.changedPixels > 0);
  assert.equal(resumedCapture.frontCanvasVisible, true);
  assert.ok(resumed.phase.solarEvent, "Post-recovery scalar mutation was not presented");

  const latestState = await readState();
  assert.equal(latestState.value.scene_id, exported.bundle.scene_id);
  assert.equal(latestState.value.scene_version, exported.bundle.scene_version);
  assert.equal(
    latestState.value.defaults.teams[0].players[0].score,
    resumedValue,
    "Private native server did not retain the valid post-recovery scalar value",
  );
  const finalPlayers = latestState.value.defaults.teams[0].players;
  assert.equal(
    new Set(finalPlayers.map((player) => player.id)).size,
    finalPlayers.length,
    "Corrected native snapshot still contains duplicate Repeat keys",
  );
  assert.deepEqual(
    finalPlayers.map((player) => player.id),
    playersAfterRecoveryReorder.map((player) => player.id),
    "Post-recovery structural mutation did not retain its keyed collection order",
  );
  assert.deepEqual(pageErrors, [], "Unexpected browser page exceptions");

  report.result = {
    passed: true,
    status: "qualified-last-valid-frame-retention-and-mutation-recovery",
    validMultiItemRenderingQualified: true,
    malformedUpdateBehavior: {
      nativeReceiverAcceptedMalformedCollection: rejected.phase.acceptedNativeReceiptBeforeRenderRefusal,
      visionRejectedDuringLoad: String(rejected.phase.solarEvent?.message ?? "").includes("Vision load:"),
      solarAppliedEventCountDidNotAdvance: true,
      retainedCanvasBackingPixelsUnchanged: true,
      lastValidFrameRemainedVisible: rejectedCapture.frontCanvasVisible,
      pageScreenshotUnchangedFromLastValidFrame:
        rejectedCapture.screenshotSha256 === removedCapture.screenshotSha256,
      opacityAfterRejection: rejectedCapture.visibility.layerOpacity,
      errorWasPreserved: String(rejected.phase.solarEvent?.message ?? "").includes("Vision load:"),
      clearScenePostedBeforeRecovery: true,
      correctedCollectionSnapshotReturnedToLive: correction.phase.solarStatusAfterCorrectionSnapshot === "live",
      correctedSnapshotDidNotClaimApplied: correction.phase.solarEvent === null,
      subsequentCollectionMutationPresented: Boolean(recovered.phase.solarEvent),
      subsequentCollectionPixelsChanged: reorderedAfterRecoveryCapture.diffFromPreviousCapture?.changedPixels ?? null,
      subsequentScalarMutationPresented: Boolean(resumed.phase.solarEvent),
      subsequentScalarPixelsChanged: resumedCapture.diffFromPreviousCapture?.changedPixels ?? null,
    },
    oneSceneIdentityPreserved: true,
    sceneVersionPreservedAcrossLiveUpdates: true,
    updateTypes: [
      "nested-scope text leaf",
      "outer keyed collection reorder",
      "inner scoped collection insertion under limit 2",
      "inner scoped collection removal under limit 2",
      "duplicate-key collection rejected by Vision after native acceptance; prior visible front canvas retained",
      "corrected valid native snapshot reconnected without an invented applied presentation event",
      "subsequent valid keyed collection reorder received a real applied event and changed pixels",
      "subsequent valid scalar text mutation received a real applied event and changed pixels",
    ],
    initialCanvas: initial,
    scalarCanvas: scalarCapture,
    reorderedCanvas: reorderedCapture,
    addedCanvas: addedCapture,
    removedCanvas: removedCapture,
    rejectedCanvas: rejectedCapture,
    correctedSnapshotCanvas: recoveredCapture,
    recoveredCanvas: recoveredCapture,
    recoveredCollectionCanvas: reorderedAfterRecoveryCapture,
    resumedCanvas: resumedCapture,
    scalarMutation: scalar.phase,
    reorderMutation: reordered.phase,
    addMutation: added.phase,
    removeMutation: removed.phase,
    rejectedMutation: rejected.phase,
    correctedSnapshot: correction.phase,
    recoveryMutation: recovered.phase,
    resumedMutation: resumed.phase,
    finalAuthoritativeScene: {
      sceneId: latestState.value.scene_id,
      sceneVersion: latestState.value.scene_version,
      stateHash: latestState.stateHash,
      duplicateKeysRemainInPrivateServerUntilShutdown: false,
      malformedCollectionCorrected: true,
      postRecoveryScore: resumedValue,
    },
    pageErrors,
    consoleErrors,
    limits: [
      "Vision's opaque WASM implementation was exercised through Solar; no decompilation or rebuild occurred.",
      "Nested team/player scopes and the inner limit of 2 were exercised; other scope grammars were not exhaustively tested.",
      "Keyed reorder was observed in pixels; internal retained node ids are not exposed by Solar's public host.",
      "Canvas pixels and computed CSS visibility are measured separately; screenshots capture the page-level composition, but do not prove physical display scanout.",
      "The duplicate-key request changed only this private Rust receiver's RAM before Vision refused the state; Solar reported the failure without an applied presentation event and kept the previous front canvas visible through clear-scene.",
      "The valid corrective collection is adopted through a successful native snapshot; snapshots have no solar:lsdp-applied event, so no presentation receipt is claimed. A later valid keyed collection reorder and then a distinct scalar patch each produced a real Solar applied event and changed visible pixels; the private receiver is stopped in cleanup.",
    ],
  };

  const cleanup = await stopOwnedProcesses();
  assert.ok(cleanup.hostProcessExited, "Owned Solar/native local host did not exit cleanly");
  assert.ok(cleanup.nativeProcessExited, "Owned private Rust LSDP process remained after cleanup");

  const exportedEvidence = resolve(out, `${values.stamp}-repeat-prism-export.lsml`);
  await writeFile(exportedEvidence, exportedLsml);
  workFiles.push(exportedEvidence);
  workFiles.push(rebuiltEvidence, archivePath);
  if (evidence)
    for (const phase of report.phases)
      if (phase.surface?.screenshot)
        phase.surface.screenshot = resolve(
          evidence,
          basename(phase.surface.screenshot),
        );
  const reportPath = resolve(out, `${values.stamp}-repeat-report.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  workFiles.push(reportPath);

  if (evidence) {
    await mkdir(evidence, { recursive: true });
    for (const file of workFiles)
      if (file !== reportPath)
      await copyFile(
        file,
        resolve(evidence, `${values.stamp}-${file.split(values.stamp + "-").at(-1)}`),
        fsConstants.COPYFILE_EXCL,
      );
    const finalReportPath = resolve(evidence, `${values.stamp}-repeat-report.json`);
    report.evidence = {
      directory: evidence,
      files: workFiles.map((file) => `${values.stamp}-${file.split(values.stamp + "-").at(-1)}`),
    };
    await writeFile(finalReportPath, JSON.stringify(report, null, 2) + "\n", {
      flag: "wx",
    });
  }

  process.stdout.write(
    JSON.stringify({
      completed: true,
      passed: report.result.passed,
      prismHead: sourceHead,
      sceneId: exported.bundle.scene_id,
      sceneVersion: exported.bundle.scene_version,
      nativeBinarySha256: nativeSha256,
      phases: report.phases.map((phase) => phase.label),
      evidence: evidence ?? out,
      report: evidence
        ? resolve(evidence, `${values.stamp}-repeat-report.json`)
        : reportPath,
    }) + "\n",
  );
} catch (error) {
  const failurePath = resolve(out, `${values.stamp}-repeat-failure.json`);
  const diagnostics = {
    nativeState: serverOrigin
      ? await readState().catch((diagnosticError) => ({
          error: String(diagnosticError),
        }))
      : null,
    health: serverOrigin
      ? await getHealth().catch((diagnosticError) => ({
          error: String(diagnosticError),
        }))
      : null,
    surface: report.initialSurface ?? null,
  };
  await writeFile(
    failurePath,
    JSON.stringify(
      {
        message: error instanceof Error ? error.stack ?? error.message : String(error),
        prismHead: sourceHead,
        nativeStdout: hostStdout,
        nativeStderr: hostStderr,
        pageErrors,
        consoleErrors,
        networkFailures,
        diagnostics,
        phases: report.phases,
      },
      null,
      2,
    ) + "\n",
  );
  throw error;
  } finally {
  if (!hostProcessExited || !report.process.nativeProcessExited) {
    await stopOwnedProcesses();
  }
}
