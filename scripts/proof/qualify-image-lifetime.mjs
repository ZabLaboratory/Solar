/* global document, location, window */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { unzipSync } from "fflate";
import { createImageLifetimeFixture } from "./image-lifetime-fixture.mjs";
import {
  startImageLifetimeHost,
  waitForOwnedHostExit,
} from "./image-lifetime-host.mjs";
import { readNative, withNative } from "../native-lsdp-tools.mjs";

const { values } = parseArgs({
  options: {
    "playwright-root": { type: "string" },
    "lsdp-bin": { type: "string" },
    count: { type: "string", default: "512" },
    "evidence-dir": {
      type: "string",
      default: "evidence/local-20261015-image-lifetime-adoption/eleven",
    },
  },
});
if (!values["playwright-root"] || !values["lsdp-bin"])
  throw new Error("--playwright-root and --lsdp-bin are required.");
const count = Number(values.count);
if (!Number.isSafeInteger(count) || count < 129 || count > 1024)
  throw new Error("--count must be an integer from 129 through 1024.");

const root = resolve(import.meta.dirname, "../..");
const nativeBinary = resolve(root, values["lsdp-bin"]);
const evidenceDir = resolve(root, values["evidence-dir"]);
const stamp = new Date()
  .toISOString()
  .replace(/[-:]/g, "")
  .replace(/\.\d{3}Z$/, "Z");
const prefix = resolve(evidenceDir, `${stamp}-native-image-lifetime`);
const scenePath = `${prefix}-scene.lsmlz`;
const sceneSourcePath = `${prefix}-scene.lsml`;
const initialImagePath = `${prefix}-source.png`;
const finalPixelsPath = `${prefix}-final.png`;
const stablePixelsPath = `${prefix}-refused-path-stable.png`;
const reportPath = `${prefix}.json`;
const nativeServerPath = resolve(root, "scripts/native-lsdp-local.mjs");
const IMAGE_BYTES_LIMIT = 8 * 1024 * 1024;

const result = {
  schema: "solar.native-image-lifetime-browser-qualification.v1",
  startedAt: new Date().toISOString(),
  scenario: "single-document sequential dynamic-image lifetime",
  scope: {
    imageUpdates: count,
    oneImageBinding: "defaults.logo -> layout image.bind.src",
    browser:
      "private headless Chrome with actual Solar host, Rust LSDP daemon, pinned Vision WASM and WebGL2 presenter",
    source:
      "private immutable LSMLZ fixture; private loopback HTTP PNG server; no shared development server",
    publication: "none",
    excluded: [
      "scene switch",
      "transition/readiness",
      "public output",
      "audio",
      "camera",
      "deployment",
    ],
    presentationBoundary:
      "Solar solar:lsdp-applied after Vision frame submission plus exact retained-front-canvas pixel read; no GPU-completion or physical-scanout claim",
  },
  artifacts: {
    scenePath,
    sceneSourcePath,
    initialImagePath,
    finalPixelsPath,
    stablePixelsPath,
    reportPath,
    nativeBinary,
  },
  validImageMutations: [],
  imageServer: { requests: [], rejectedRequests: [] },
  failures: [],
  checks: {},
};

let hostProcess;
let browser;
let page;
let imageServer;
let imageServerOrigin;
let hostOrigin;
let serverReady;
let resultWritten = false;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function imageUrl(index) {
  return `${imageServerOrigin}/image/${index}.png`;
}

async function startImageServer(images) {
  const imageByPath = new Map(
    [...images].map(([index, image]) => [`/image/${index}.png`, image]),
  );
  imageServer = createServer((request, response) => {
    const path = new URL(request.url, "http://127.0.0.1").pathname;
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    };
    const image = imageByPath.get(path);
    if (image) {
      result.imageServer.requests.push({
        path,
        index: image.index,
        sha256: image.sha256,
        bytes: image.bytes.length,
      });
      response.writeHead(200, {
        ...cors,
        "Content-Type": "image/png",
        "Content-Length": image.bytes.length,
      });
      response.end(image.bytes);
      return;
    }
    if (path === "/image/reject.png") {
      result.imageServer.rejectedRequests.push({
        path,
        status: 404,
        epochMs: Date.now(),
      });
      response.writeHead(404, {
        ...cors,
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Length": 13,
      });
      response.end("not an image\n");
      return;
    }
    response.writeHead(404, cors).end();
  });
  await new Promise((yes, no) => {
    imageServer.once("error", no);
    imageServer.listen(0, "127.0.0.1", yes);
  });
  const address = imageServer.address();
  imageServerOrigin = `http://127.0.0.1:${address.port}`;
}

async function readCanvas() {
  return page.evaluate(() => {
    const canvas = [
      ...document.querySelectorAll("#scene canvas[aria-hidden='true']"),
    ].at(-1);
    if (!canvas || canvas.width < 1 || canvas.height < 1)
      return { error: "retained-front-canvas-unavailable" };
    const context = canvas.getContext("2d");
    if (!context) return { error: "retained-front-2d-context-unavailable" };
    const x = Math.min(128, canvas.width - 1);
    const y = Math.min(128, canvas.height - 1);
    return {
      width: canvas.width,
      height: canvas.height,
      x,
      y,
      rgba: [...context.getImageData(x, y, 1, 1).data],
      dataUrl: canvas.toDataURL("image/png"),
      status: document.documentElement.dataset.solarStatus ?? null,
    };
  });
}

function colorMatches(actual, expected, tolerance = 12) {
  return (
    Array.isArray(actual) &&
    actual.length === 4 &&
    expected.every(
      (channel, index) => Math.abs(actual[index] - channel) <= tolerance,
    )
  );
}

async function waitForPixel(expected, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await readCanvas();
    if (
      !latest.error &&
      colorMatches(latest.rgba, [
        expected.r,
        expected.g,
        expected.b,
        expected.a,
      ])
    )
      return latest;
    await page.waitForTimeout(40);
  }
  throw new Error(
    `Retained canvas did not present expected RGBA ${JSON.stringify(expected)}; last=${JSON.stringify(latest)}`,
  );
}

async function postMutation(value) {
  const response = await fetch(`${hostOrigin}/mutations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify([{ op: "replace", path: "/defaults/logo", value }]),
    signal: AbortSignal.timeout(45000),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 2000) };
  }
  return { status: response.status, body };
}

async function waitForApplied(transactionId, timeoutMs = 15000) {
  if (!transactionId)
    throw new Error("Native receipt did not include transactionId.");
  await page.waitForFunction(
    (id) =>
      window.__imageLifetimeProof?.events.some(
        (event) =>
          event.type === "solar:lsdp-applied" &&
          event.detail.transactionId === id,
      ),
    transactionId,
    { timeout: timeoutMs },
  );
}

async function waitForStatus(status, timeoutMs = 30000) {
  await page.waitForFunction(
    (expected) => document.documentElement.dataset.solarStatus === expected,
    status,
    { timeout: timeoutMs },
  );
}

async function readAuthoritativeLogo() {
  return withNative(serverReady.native, async (peer) => {
    const snapshot = await readNative(peer, "scene");
    return {
      stateHash: snapshot.stateHash,
      logo: snapshot.state?.defaults?.logo ?? null,
    };
  });
}

async function main() {
  await mkdir(evidenceDir, { recursive: true });
  const fixture = await createImageLifetimeFixture({
    count,
    scenePath,
    sceneSourcePath,
    initialImagePath,
  });
  const {
    document,
    sourceImage,
    sourcePath,
    sourceSha1,
    dynamicImages,
    sourceBytes,
    archiveBytes,
  } = fixture;
  await startImageServer(dynamicImages);

  const localHost = await startImageLifetimeHost({
    nativeServerPath,
    scenePath,
    nativeBinary,
    root,
  });
  const port = localHost.port;
  hostProcess = localHost.process;
  hostOrigin = localHost.origin;
  serverReady = localHost.ready;
  result.hostStderr = localHost.stderr;
  const initialHealth = await fetch(`${hostOrigin}/health`).then((response) =>
    response.json(),
  );
  result.server = {
    ready: true,
    url: serverReady.solar,
    nativeUrl: serverReady.native,
    nativePid: serverReady.nativePid,
    sceneId: serverReady.sceneId,
    sceneVersion: document.scene_version,
    sourceDigest: initialHealth.sourceDigest,
    archiveDigest: serverReady.archiveDigest,
    persistence: "memory-only",
    httpPort: port,
    imageServerOrigin,
  };
  result.server.nativeAddress = initialHealth.nativeAddress;
  result.provenance = {
    solarBase: "73eaecb351ca3f521ba018973e7eb6b0936405e7",
    solarRecoveryCommit: "f8454836f2a98adeae2257aa7ed6327b75aa772e",
    solarRecoveryMergeCommit: "cc6901087be20a25685686b776709c2cab7081ce",
    solarBranch: "eleven/local-20261015-image-lifetime-adoption",
    visionRepository: "Lumencast/lumencast-vision",
    visionBase: "19493a3938e4a0bd2aede614450a3245bbf6989c",
    visionBranch: "eleven/local-20261015-dynamic-image-lifetime",
    visionCommit: "48a44d6567ec80563ee0955161be2503c6742e90",
    visionTree: "d2f188dc399ec1e75480a388f2940394720f8927",
    buildPipeline:
      "& .\\scripts\\vision\\build-web.ps1 (wasm-bindgen 0.2.129), then Solar npm run build",
    solarAssetsManifest: JSON.parse(
      await readFile(resolve(root, "public/vision/vision-assets.json"), "utf8"),
    ),
    nativeBinarySha256: sha256(await readFile(nativeBinary)),
    source: {
      archiveSha256: sha256(archiveBytes),
      archiveBytes: archiveBytes.length,
      lsmlSha256: sha256(sourceBytes),
      imagePath: sourcePath,
      imageSha1: sourceSha1,
      imageSha256: sha256(sourceImage),
      imageBytes: sourceImage.length,
    },
  };

  const require = createRequire(
    resolve(values["playwright-root"], "package.json"),
  );
  const { chromium } = require("playwright");
  browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: [
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
  page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const browserErrors = [];
  page.on("pageerror", (error) =>
    browserErrors.push({ kind: "pageerror", message: error.message }),
  );
  page.on("console", (message) => {
    if (message.type() === "error")
      browserErrors.push({ kind: "console", message: message.text() });
  });
  const initScript = String.raw`(() => {
    const proof = { events: [], statuses: [], context: [], attached: false };
    Object.defineProperty(window, "__imageLifetimeProof", { value: proof });
    const record = (type, detail = {}) => {
      if (proof.events.length < 4096) proof.events.push({ type, detail: JSON.parse(JSON.stringify(detail ?? {})), epochMs: Date.now() });
    };
    const attach = () => {
      const target = document.getElementById("scene");
      if (!target) return;
      if (!target.dataset.imageLifetimeEvents) {
        target.dataset.imageLifetimeEvents = "attached";
        proof.attached = true;
        for (const type of ["solar:lsdp-received", "solar:lsdp-applied", "solar:lsdp-resync"])
          target.addEventListener(type, event => record(type, event.detail));
      }
      const gpu = [...target.querySelectorAll("canvas[aria-hidden='true']")][0];
      if (gpu && !gpu.dataset.imageLifetimeContext) {
        gpu.dataset.imageLifetimeContext = "attached";
        for (const type of ["webglcontextlost", "webglcontextrestored"])
          gpu.addEventListener(type, () => proof.context.push({ type, epochMs: Date.now() }));
      }
    };
    const observeStatus = () => {
      const status = document.documentElement.dataset.solarStatus ?? null;
      const last = proof.statuses.at(-1)?.status;
      if (status !== last) proof.statuses.push({ status, epochMs: Date.now() });
    };
    new MutationObserver(() => { attach(); observeStatus(); }).observe(document, { attributes: true, childList: true, subtree: true });
    document.addEventListener("DOMContentLoaded", () => { attach(); observeStatus(); }, { once: true });
  })();`;
  await page.addInitScript(initScript);
  const hostUrl = new URL("/host.html", serverReady.solar);
  hostUrl.searchParams.set("lsdp", serverReady.native);
  hostUrl.searchParams.set("resource", "scene");
  hostUrl.searchParams.set("presenter", "webgl");
  const navigation = await page.goto(hostUrl.href, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  result.browser = {
    engine: "Chrome",
    version: browser.version(),
    headless: true,
    pageUrl: page.url(),
    navigationStatus: navigation?.status() ?? null,
    errors: browserErrors,
  };
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.solarStatus === "live" &&
      document.querySelectorAll("#scene canvas[aria-hidden='true']").length >=
        2,
    null,
    { timeout: 20000 },
  );
  const gpuInfo = await page.evaluate(() => {
    const canvases = [
      ...document.querySelectorAll("#scene canvas[aria-hidden='true']"),
    ];
    const gpu = canvases[0];
    const gl = gpu?.getContext("webgl2");
    return {
      count: canvases.length,
      gpuCanvas: gpu ? { width: gpu.width, height: gpu.height } : null,
      frontCanvas: canvases.at(-1)
        ? { width: canvases.at(-1).width, height: canvases.at(-1).height }
        : null,
      webgl2: Boolean(gl),
      contextAttributes: gl?.getContextAttributes() ?? null,
      profile: new URLSearchParams(location.search).get("presenter"),
      proofAttached: window.__imageLifetimeProof?.attached ?? false,
    };
  });
  result.browser.presenter = gpuInfo;
  if (!gpuInfo.webgl2 || gpuInfo.contextAttributes?.desynchronized !== true)
    throw new Error(
      `Solar did not initialize the expected real WebGL2 presenter: ${JSON.stringify(gpuInfo)}`,
    );
  if (!gpuInfo.proofAttached)
    throw new Error("Solar native event observation did not attach.");
  const initialPixel = await waitForPixel({ r: 0, g: 0, b: 255, a: 255 });
  result.initialPresentation = {
    pixel: initialPixel.rgba,
    width: initialPixel.width,
    height: initialPixel.height,
  };

  for (let index = 1; index <= count; index++) {
    const image = dynamicImages.get(index);
    const url = imageUrl(index);
    const startedAt = Date.now();
    const mutation = await postMutation(url);
    if (mutation.status !== 200 || mutation.body.receipt?.level !== "applied")
      throw new Error(
        `Valid image mutation ${index} failed: HTTP ${mutation.status} ${JSON.stringify(mutation.body).slice(0, 500)}`,
      );
    const transactionId = mutation.body.receipt.transactionId;
    await waitForApplied(transactionId);
    const pixel = await waitForPixel(image.color, 10000);
    result.validImageMutations.push({
      index,
      url,
      imageSha256: image.sha256,
      responseBytes: image.bytes.length,
      transactionId,
      pixel: pixel.rgba,
      presentationEpochMs: Date.now(),
      roundTripMs: Date.now() - startedAt,
    });
  }
  const lastGood = dynamicImages.get(count);
  const lastGoodUrl = imageUrl(count);
  const finalCanvas = await waitForPixel(lastGood.color);
  await writeFile(
    finalPixelsPath,
    Buffer.from(finalCanvas.dataUrl.split(",")[1], "base64"),
  );
  const authoritativeAfterSeries = await readAuthoritativeLogo();
  const imageEntries = result.imageServer.requests.filter(
    (entry) => entry.index >= 1 && entry.index <= count,
  );
  result.validImageSeries = {
    expectedCount: count,
    completedMutations: result.validImageMutations.length,
    distinctUrls: new Set(result.validImageMutations.map((entry) => entry.url))
      .size,
    distinctContentSha256: new Set(
      result.validImageMutations.map((entry) => entry.imageSha256),
    ).size,
    successfulHttpResponses: imageEntries.length,
    uniqueSuccessfulImageRequests: new Set(
      imageEntries.map((entry) => entry.path),
    ).size,
    uniqueSuccessfulContent: new Set(imageEntries.map((entry) => entry.sha256))
      .size,
    finalPresentedPixel: finalCanvas.rgba,
    finalExpectedPixel: [
      lastGood.color.r,
      lastGood.color.g,
      lastGood.color.b,
      lastGood.color.a,
    ],
    authoritativeLogoMatches: authoritativeAfterSeries.logo === lastGoodUrl,
  };
  result.authoritativeAfterSeries = authoritativeAfterSeries;
  if (
    result.validImageSeries.completedMutations !== count ||
    result.validImageSeries.distinctUrls !== count ||
    result.validImageSeries.distinctContentSha256 !== count ||
    result.validImageSeries.successfulHttpResponses !== count ||
    result.validImageSeries.uniqueSuccessfulContent !== count ||
    !result.validImageSeries.authoritativeLogoMatches
  )
    throw new Error(
      `The valid image series did not meet its distinctness/authoritative-state contract: ${JSON.stringify(result.validImageSeries)}`,
    );
  result.checks.validImageSeries = true;

  const contextState = await page.evaluate(() => {
    const gpu = [
      ...document.querySelectorAll("#scene canvas[aria-hidden='true']"),
    ][0];
    const gl = gpu?.getContext("webgl2");
    const extension = gl?.getExtension("WEBGL_lose_context");
    window.__imageLifetimeRestoreExtension = extension;
    return {
      gl: Boolean(gl),
      beforeLoss: gl?.isContextLost() ?? null,
      extension: Boolean(extension),
    };
  });
  result.contextRestore = {
    ...contextState,
    lostEvent: false,
    restoredEvent: false,
  };
  if (
    !contextState.gl ||
    !contextState.extension ||
    contextState.beforeLoss !== false
  )
    throw new Error(
      `Chrome WebGL context loss extension is unavailable: ${JSON.stringify(contextState)}`,
    );
  await page.evaluate(() => {
    const gpu = [
      ...document.querySelectorAll("#scene canvas[aria-hidden='true']"),
    ][0];
    gpu.getContext("webgl2").getExtension("WEBGL_lose_context").loseContext();
  });
  await page.waitForFunction(
    () =>
      window.__imageLifetimeProof?.context.some(
        (event) => event.type === "webglcontextlost",
      ),
    null,
    { timeout: 8000 },
  );
  result.contextRestore.lostEvent = true;
  result.contextRestore.isLost = await page.evaluate(() => {
    const gpu = [
      ...document.querySelectorAll("#scene canvas[aria-hidden='true']"),
    ][0];
    return gpu.getContext("webgl2").isContextLost();
  });
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    window.__imageLifetimeRestoreExtension?.restoreContext();
  });
  await page.waitForFunction(
    () =>
      window.__imageLifetimeProof?.context.some(
        (event) => event.type === "webglcontextrestored",
      ),
    null,
    { timeout: 20000 },
  );
  result.contextRestore.restoredEvent = true;
  result.contextRestore.isLostAfterRestore = await page.evaluate(() => {
    const gpu = [
      ...document.querySelectorAll("#scene canvas[aria-hidden='true']"),
    ][0];
    return gpu.getContext("webgl2").isContextLost();
  });

  const afterRestoreIndex = count + 1;
  const afterRestoreImage = dynamicImages.get(afterRestoreIndex);
  const afterRestoreUrl = imageUrl(afterRestoreIndex);
  const afterRestoreMutation = await postMutation(afterRestoreUrl);
  if (
    afterRestoreMutation.status !== 200 ||
    afterRestoreMutation.body.receipt?.level !== "applied"
  )
    throw new Error(
      `Post-restoration image mutation failed: HTTP ${afterRestoreMutation.status} ${JSON.stringify(afterRestoreMutation.body).slice(0, 500)}`,
    );
  await waitForApplied(afterRestoreMutation.body.receipt.transactionId);
  const restoredPixel = await waitForPixel(afterRestoreImage.color, 15000);
  result.contextRestore.postRestoreMutation = {
    transactionId: afterRestoreMutation.body.receipt.transactionId,
    url: afterRestoreUrl,
    pixel: restoredPixel.rgba,
    expectedPixel: [
      afterRestoreImage.color.r,
      afterRestoreImage.color.g,
      afterRestoreImage.color.b,
      afterRestoreImage.color.a,
    ],
  };
  result.checks.realContextRestore =
    result.contextRestore.lostEvent &&
    result.contextRestore.restoredEvent &&
    result.contextRestore.isLost === true &&
    result.contextRestore.isLostAfterRestore === false &&
    colorMatches(restoredPixel.rgba, [
      afterRestoreImage.color.r,
      afterRestoreImage.color.g,
      afterRestoreImage.color.b,
      afterRestoreImage.color.a,
    ]);

  const activeBeforeReject = restoredPixel;
  const rejectedUrl = `${imageServerOrigin}/image/reject.png`;
  const rejectionMutation = await postMutation(rejectedUrl);
  result.refusedPath = {
    url: rejectedUrl,
    httpMutationStatus: rejectionMutation.status,
    httpMutationResponse: rejectionMutation.body,
    expectedImageHttpStatus: 404,
  };
  const rejectionDeadline = Date.now() + 10000;
  while (
    Date.now() < rejectionDeadline &&
    result.imageServer.rejectedRequests.length === 0
  )
    await new Promise((yes) => setTimeout(yes, 20));
  result.refusedPath.imageRequest =
    result.imageServer.rejectedRequests.at(-1) ?? null;
  await page.waitForTimeout(500);
  const activeAfterReject = await readCanvas();
  await writeFile(
    stablePixelsPath,
    Buffer.from(activeAfterReject.dataUrl.split(",")[1], "base64"),
  );
  const authoritativeAfterReject = await readAuthoritativeLogo();
  result.refusedPath.activeBefore = activeBeforeReject.rgba;
  result.refusedPath.activeAfter = activeAfterReject.rgba;
  result.refusedPath.statusAfter = activeAfterReject.status;
  result.refusedPath.authoritativeLogoAfter = authoritativeAfterReject.logo;
  result.refusedPath.errors = browserErrors.filter((entry) =>
    /image|fetch|404|patch/i.test(entry.message),
  );
  result.checks.refusedPathPreservesActiveImage =
    result.refusedPath.imageRequest?.status === 404 &&
    colorMatches(activeAfterReject.rgba, [
      afterRestoreImage.color.r,
      afterRestoreImage.color.g,
      afterRestoreImage.color.b,
      afterRestoreImage.color.a,
    ]);
  if (
    rejectionMutation.status === 200 &&
    rejectionMutation.body.receipt?.level === "applied"
  )
    result.refusedPath.nativeMutationWasAuthoritativelyApplied = true;
  else result.refusedPath.nativeMutationWasAuthoritativelyApplied = false;

  const snapshotImage = dynamicImages.get(count + 2);
  const snapshotUrl = imageUrl(count + 2);
  const finalImage = dynamicImages.get(count + 3);
  const finalUrl = imageUrl(count + 3);
  result.postRefusalRecovery = {
    recoverySnapshot: { url: snapshotUrl },
    postSnapshotMutation: { url: finalUrl },
  };
  result.checks.postRefusalRecovery = false;
  try {
    await page.waitForFunction(
      () =>
        window.__imageLifetimeProof?.statuses.some(
          (entry) => entry.status === "connecting",
        ),
      null,
      { timeout: 10000 },
    );
    result.postRefusalRecovery.sawConnectingAfterRejectedImage = true;

    // Correct the authoritative graph while the Solar peer reconnects. The
    // ensuing state.read applies that current snapshot without inventing an
    // applied presentation receipt; the next distinct delta proves resumption.
    const snapshotCorrection = await postMutation(snapshotUrl);
    result.postRefusalRecovery.recoverySnapshot.httpStatus =
      snapshotCorrection.status;
    result.postRefusalRecovery.recoverySnapshot.response =
      snapshotCorrection.body;
    const correctionTransactionId =
      snapshotCorrection.body.receipt?.transactionId ?? null;
    result.postRefusalRecovery.recoverySnapshot.transactionId =
      correctionTransactionId;
    const nativeAfterCorrection = await readAuthoritativeLogo();
    result.postRefusalRecovery.recoverySnapshot.authoritativeLogo =
      nativeAfterCorrection.logo;
    result.postRefusalRecovery.recoverySnapshot.authoritativeLogoMatches =
      nativeAfterCorrection.logo === snapshotUrl;
    await waitForStatus("live", 30000);
    const snapshotPixel = await waitForPixel(snapshotImage.color, 15000);
    result.postRefusalRecovery.recoverySnapshot.statusAfterSnapshot =
      snapshotPixel.status;
    result.postRefusalRecovery.recoverySnapshot.pixel = snapshotPixel.rgba;
    result.postRefusalRecovery.recoverySnapshot.expectedPixel = [
      snapshotImage.color.r,
      snapshotImage.color.g,
      snapshotImage.color.b,
      snapshotImage.color.a,
    ];
    result.postRefusalRecovery.recoverySnapshot.appliedEventsForSnapshot =
      await page.evaluate(
        (id) =>
          window.__imageLifetimeProof?.events.filter(
            (event) =>
              event.type === "solar:lsdp-applied" &&
              event.detail.transactionId === id,
          ).length ?? 0,
        correctionTransactionId,
      );

    const followupMutation = await postMutation(finalUrl);
    result.postRefusalRecovery.postSnapshotMutation.httpStatus =
      followupMutation.status;
    result.postRefusalRecovery.postSnapshotMutation.response =
      followupMutation.body;
    const followupTransactionId =
      followupMutation.body.receipt?.transactionId ?? null;
    result.postRefusalRecovery.postSnapshotMutation.transactionId =
      followupTransactionId;
    if (
      followupMutation.status !== 200 ||
      followupMutation.body.receipt?.level !== "applied"
    )
      throw new Error(
        `Valid image mutation after snapshot recovery failed: HTTP ${followupMutation.status} ${JSON.stringify(followupMutation.body).slice(0, 500)}`,
      );
    await waitForApplied(followupTransactionId);
    const recoveredPixel = await waitForPixel(finalImage.color, 15000);
    result.postRefusalRecovery.postSnapshotMutation.pixel = recoveredPixel.rgba;
    result.postRefusalRecovery.postSnapshotMutation.expectedPixel = [
      finalImage.color.r,
      finalImage.color.g,
      finalImage.color.b,
      finalImage.color.a,
    ];
    await writeFile(
      finalPixelsPath,
      Buffer.from(recoveredPixel.dataUrl.split(",")[1], "base64"),
    );
    result.checks.postRefusalRecovery =
      result.postRefusalRecovery.sawConnectingAfterRejectedImage === true &&
      snapshotCorrection.status === 200 &&
      snapshotCorrection.body.receipt?.level === "applied" &&
      nativeAfterCorrection.logo === snapshotUrl &&
      snapshotPixel.status === "live" &&
      colorMatches(
        snapshotPixel.rgba,
        result.postRefusalRecovery.recoverySnapshot.expectedPixel,
      ) &&
      result.postRefusalRecovery.recoverySnapshot.appliedEventsForSnapshot ===
        0 &&
      followupMutation.status === 200 &&
      followupMutation.body.receipt?.level === "applied" &&
      colorMatches(
        recoveredPixel.rgba,
        result.postRefusalRecovery.postSnapshotMutation.expectedPixel,
      );
  } catch (error) {
    result.postRefusalRecovery.error =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    result.failures.push(
      `Post-refusal snapshot recovery: ${result.postRefusalRecovery.error}`,
    );
  }

  const sourceArchiveAfter = await readFile(scenePath);
  const unpackedAfter = unzipSync(sourceArchiveAfter);
  const sourceAssetAfter = Buffer.from(unpackedAfter[sourcePath] ?? []);
  const servedSource = await fetch(
    `${hostOrigin}/canvas/api/v1/scenes/${encodeURIComponent(document.scene_id)}/revisions/1/source.lsmlz?version=${encodeURIComponent(document.scene_version)}`,
  ).then(async (response) => ({
    status: response.status,
    bytes: Buffer.from(await response.arrayBuffer()),
  }));
  const finalHealth = await fetch(`${hostOrigin}/health`).then((response) =>
    response.json(),
  );
  result.immutability = {
    sourceArchiveSha256Before: sha256(archiveBytes),
    sourceArchiveSha256After: sha256(sourceArchiveAfter),
    sourceLsmlSha256Before: sha256(sourceBytes),
    sourceLsmlSha256After: sha256(
      Buffer.from(unpackedAfter["scene.lsml"] ?? []),
    ),
    sourceImagePath: sourcePath,
    sourceImageSha256Before: sha256(sourceImage),
    sourceImageSha256After: sha256(sourceAssetAfter),
    servedSourceStatus: servedSource.status,
    servedSourceSha256: sha256(servedSource.bytes),
    initialServerArchiveDigest: serverReady.archiveDigest,
    finalServerArchiveDigest: finalHealth.archiveDigest,
    initialServerSourceDigest: result.server.sourceDigest,
    finalServerSourceDigest: finalHealth.sourceDigest,
  };
  result.checks.immutableOrigin =
    sha256(sourceArchiveAfter) === sha256(archiveBytes) &&
    sha256(Buffer.from(unpackedAfter["scene.lsml"] ?? [])) ===
      sha256(sourceBytes) &&
    sha256(sourceAssetAfter) === sha256(sourceImage) &&
    servedSource.status === 200 &&
    sha256(servedSource.bytes) === sha256(archiveBytes) &&
    finalHealth.archiveDigest === serverReady.archiveDigest &&
    finalHealth.sourceDigest === result.server.sourceDigest;

  const pageDiagnostics = await page.evaluate(() => ({
    status: document.documentElement.dataset.solarStatus ?? null,
    events: window.__imageLifetimeProof?.events ?? [],
    statuses: window.__imageLifetimeProof?.statuses ?? [],
    contextEvents: window.__imageLifetimeProof?.context ?? [],
    retainedCanvasCount: document.querySelectorAll(
      "#scene canvas[aria-hidden='true']",
    ).length,
  }));
  result.browser.events = pageDiagnostics.events;
  result.browser.statuses = pageDiagnostics.statuses;
  result.browser.contextEvents = pageDiagnostics.contextEvents;
  result.browser.finalStatus = pageDiagnostics.status;
  result.browser.retainedCanvasCount = pageDiagnostics.retainedCanvasCount;
  result.browser.errors = browserErrors;
  result.imageServer.summary = {
    totalSuccessResponses: result.imageServer.requests.length,
    distinctSuccessPaths: new Set(
      result.imageServer.requests.map((entry) => entry.path),
    ).size,
    distinctSuccessContent: new Set(
      result.imageServer.requests.map((entry) => entry.sha256),
    ).size,
    refused404Count: result.imageServer.rejectedRequests.length,
    maxImageBytes: Math.max(
      0,
      ...result.imageServer.requests.map((entry) => entry.bytes),
    ),
  };
  const originAfter = await readAuthoritativeLogo();
  result.authoritativeFinal = originAfter;
  result.checks.activeFinalImageMatchesNativeState =
    originAfter.logo === finalUrl;
  result.checks.noBrowserPageErrors =
    browserErrors.filter((entry) => entry.kind === "pageerror").length === 0;
  result.checks.noUnexpectedImageOversize = result.imageServer.requests.every(
    (entry) => entry.bytes <= IMAGE_BYTES_LIMIT,
  );
  result.passed = Object.values(result.checks).every((value) => value === true);
  if (!result.checks.refusedPathPreservesActiveImage)
    result.failures.push(
      "The rejected dynamic image path did not preserve the previously presented image pixel.",
    );
  if (!result.checks.postRefusalRecovery)
    result.failures.push(
      "A valid image mutation after the rejected path did not recover to its expected pixel.",
    );
  if (!result.checks.immutableOrigin)
    result.failures.push(
      "The immutable source archive/asset or server source response changed.",
    );
  if (!result.checks.realContextRestore)
    result.failures.push(
      "Real WebGL context loss/restoration or post-restoration image rendering did not pass.",
    );
  if (!result.checks.activeFinalImageMatchesNativeState)
    result.failures.push(
      "The final native logo URL did not match the finally rendered image.",
    );
}

try {
  result.hostStderr = [];
  await main();
} catch (error) {
  result.failures.push(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  result.passed = false;
} finally {
  if (browser) {
    await browser
      .close()
      .catch((error) =>
        result.failures.push(`browser-close: ${error.message}`),
      );
    browser = null;
    page = null;
  }
  if (imageServer) {
    imageServer.closeAllConnections();
    await new Promise((yes) => imageServer.close(() => yes()));
  }
  if (hostProcess && hostProcess.exitCode === null) {
    hostProcess.kill("SIGINT");
    if (!(await waitForOwnedHostExit(hostProcess, 10000))) {
      hostProcess.kill();
      if (!(await waitForOwnedHostExit(hostProcess, 5000)))
        result.failures.push(
          "Private Solar host process did not stop after SIGINT/termination.",
        );
    }
  }
  result.completedAt = new Date().toISOString();
  if (serverReady) {
    result.server ??= {};
    result.server.hostExitCode = hostProcess?.exitCode ?? null;
    result.server.nativeHostStderr = result.hostStderr ?? [];
  }
  result.cleanup = {
    privateChromeStopped: browser === null,
    privateImageServerStopped: imageServer?.listening === false,
    privateNativeHostStopped:
      !hostProcess ||
      hostProcess.exitCode !== null ||
      hostProcess.signalCode !== null,
  };
  if (result.passed !== true) result.passed = false;
  if (!resultWritten) {
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`);
    resultWritten = true;
  }
}

process.stdout.write(
  `${JSON.stringify({
    passed: result.passed === true,
    updates: result.validImageMutations.length,
    distinctUrls: result.validImageSeries?.distinctUrls ?? null,
    contextRestore: result.checks.realContextRestore ?? false,
    refusedPathPreserved:
      result.checks.refusedPathPreservesActiveImage ?? false,
    immutableOrigin: result.checks.immutableOrigin ?? false,
    evidence: reportPath,
    failures: result.failures,
  })}\n`,
);
if (!result.passed) process.exitCode = 1;
