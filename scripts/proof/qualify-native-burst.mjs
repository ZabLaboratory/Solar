/* global document, location, window */

import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  correlateTransactions,
  matchesFinalPixelText,
  summarizePerformance,
  summarizePresentations,
  summarizeProducer,
  summarizePostAckDrain,
  summarizeReceiveToPresentation,
} from "./native-burst-analysis.mjs";
import { readNative, withNative } from "../native-lsdp-tools.mjs";

const parsed = parseArgs({
  options: {
    mode: { type: "string", default: "paced" },
    duration: { type: "string", default: "3900" },
    "max-drain-ms": { type: "string", default: "15000" },
    "playwright-root": { type: "string" },
    "evidence-dir": {
      type: "string",
      default: "evidence/local-20261015-native-burst-qualification/eleven",
    },
    scene: {
      type: "string",
      default: "fixtures/native-burst/native-burst.lsmlz",
    },
    "lsdp-bin": {
      type: "string",
      default: "dist/native/win32-x64/lsdpd.exe",
    },
  },
});
const values = parsed.values;
if (!values["playwright-root"])
  throw new Error("--playwright-root is required for the private Chrome run.");
if (!["paced", "burst"].includes(values.mode))
  throw new Error("--mode must be paced or burst.");
const durationMs = Number(values.duration);
const maxDrainMs = Number(values["max-drain-ms"]);
if (!Number.isSafeInteger(durationMs) || durationMs <= 0)
  throw new Error("--duration must be a positive integer.");
if (!Number.isSafeInteger(maxDrainMs) || maxDrainMs < 1000)
  throw new Error("--max-drain-ms must be an integer of at least 1000.");

const root = resolve(import.meta.dirname, "../..");
const scene = resolve(root, values.scene);
const nativeBinary = resolve(root, values["lsdp-bin"]);
const evidenceDir = resolve(root, values["evidence-dir"]);
const runStamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const scenarioName = values.mode === "paced" ? "native-burst-sustained" : "native-burst-burst";
const prefix = resolve(evidenceDir, `${runStamp}-${scenarioName}`);
const resultPath = `${prefix}.json`;
const pixelsPath = `${prefix}-pixels.png`;
const producerPath = resolve(root, "scripts/proof/native-burst-producer.mjs");
const localServerPath = resolve(root, "scripts/native-lsdp-local.mjs");
const tesseractPath = "C:\\Program Files\\Tesseract-OCR\\tesseract.exe";
const expectedFinalValue = "0512/0512";
const expectedOperations = 512;

const result = {
  schema: "solar.native-burst-browser-qualification.v1",
  scenario: values.mode,
  startedAt: new Date().toISOString(),
  scope: {
    operations: expectedOperations,
    scene: "native-burst-qualification",
    source: "real private Rust LSDP daemon + Solar host dist + pinned Vision dist",
    browser: "private headless Chrome; no CEF, no physical camera, no audio, no scene switch",
    publication: "none",
    presentationBoundary:
      "Vision frame-submitted followed by Solar CanvasPresentation retained-front-canvas copy; no GPU-completion or physical-scanout claim",
  },
  artifacts: { resultPath, pixelsPath, scene, nativeBinary },
  serverLogs: { stdout: [], stderr: [] },
  producerLogs: { stdout: [], stderr: [] },
  failures: [],
};

let serverProcess;
let producerProcess;
let browser;
let page;
let progressServer;
let serverLineReader;
let producerLineReader;
let finalPixelData = null;
let currentPhase = "setup";
const phaseTimeline = [{ phase: currentPhase, epochMs: Date.now() }];

function markPhase(phase) {
  currentPhase = phase;
  phaseTimeline.push({ phase, epochMs: Date.now() });
}

function observedError(source, message, extra = {}) {
  return {
    source,
    phase: currentPhase,
    captureEpochMs: Date.now(),
    message,
    ...extra,
  };
}

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function recordLines(stream, destination, onLine) {
  const reader = createInterface({ input: stream });
  reader.on("line", (line) => {
    destination.push(line);
    onLine?.(line);
  });
  return reader;
}

function waitForExit(child, timeoutMs, label) {
  return new Promise((resolveExit, rejectExit) => {
    let timer;
    const onExit = (code, signal) => {
      clearTimeout(timer);
      resolveExit({ code, signal });
    };
    child.once("exit", onExit);
    timer = setTimeout(() => {
      child.kill("SIGTERM");
      rejectExit(new Error(`${label} did not exit within ${timeoutMs} ms.`));
    }, timeoutMs);
  });
}

function waitForServerReady(child) {
  return new Promise((resolveReady, rejectReady) => {
    const timer = setTimeout(() => {
      rejectReady(new Error("Private native Solar host did not become ready in 30 seconds."));
    }, 30000);
    serverLineReader = recordLines(child.stdout, result.serverLogs.stdout, (line) => {
      const value = parseJsonLine(line);
      if (value?.solar && value?.native && value?.nativePid) {
        clearTimeout(timer);
        resolveReady(value);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) =>
      result.serverLogs.stderr.push(
        observedError("native-host-stderr", String(chunk)),
      ),
    );
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectReady(error);
    });
    child.once("exit", (code) => {
      if (!result.server?.ready) {
        clearTimeout(timer);
        rejectReady(new Error(`Private native Solar host exited before ready (${code}).`));
      }
    });
  });
}

function collectProducer(child) {
  let resolveReady;
  let rejectReady;
  let resolveExit;
  let rejectExit;
  const ready = new Promise((yes, no) => {
    resolveReady = yes;
    rejectReady = no;
  });
  const exit = new Promise((yes, no) => {
    resolveExit = yes;
    rejectExit = no;
  });
  producerLineReader = recordLines(child.stdout, result.producerLogs.stdout, (line) => {
    const value = parseJsonLine(line);
    if (value?.ready === true) resolveReady(value);
    else if (Array.isArray(value?.receipts)) result.producer = value;
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) =>
    result.producerLogs.stderr.push(
      observedError("native-producer-stderr", String(chunk)),
    ),
  );
  child.once("error", rejectReady);
  child.once("exit", (code, signal) => {
    const value = { code, signal };
    if (code === 0) resolveExit(value);
    else rejectExit(new Error(`Native producer exited with code ${code} (${signal ?? "no signal"}).`));
  });
  return { ready, exit };
}

async function reservePort() {
  const server = createServer();
  await new Promise((yes, no) => {
    server.once("error", no);
    server.listen(0, "127.0.0.1", yes);
  });
  const address = server.address();
  const port = address.port;
  await new Promise((yes, no) => server.close((error) => (error ? no(error) : yes())));
  return port;
}

async function startProgressServer() {
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/bench/progress") {
      response.writeHead(404).end();
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    result.progressCallbacks.push({ body, epochMs: Date.now() });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ accepted: true }));
  });
  await new Promise((yes, no) => {
    server.once("error", no);
    server.listen(0, "127.0.0.1", yes);
  });
  const address = server.address();
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

const browserInitScript = String.raw`(() => {
  const proof = {
    events: [],
    performanceEntries: [],
    droppedEvents: 0,
    droppedPerformanceEntries: 0,
    attached: false,
    startEpochMs: null,
  };
  Object.defineProperty(window, "__nativeBurstProof", { value: proof });
  const addEvent = (type, event) => {
    if (proof.events.length >= 4096) {
      proof.droppedEvents++;
      return;
    }
    let detail = {};
    try { detail = JSON.parse(JSON.stringify(event.detail ?? {})); }
    catch { detail = { serializationError: true }; }
    proof.events.push({
      type,
      captureEpochMs: performance.timeOrigin + performance.now(),
      detail,
    });
  };
  const attach = () => {
    const target = document.getElementById("scene");
    if (!target || target.dataset.nativeBurstProof === "attached") return;
    target.dataset.nativeBurstProof = "attached";
    proof.attached = true;
    for (const type of [
      "solar:lsdp-received",
      "solar:lsdp-applied",
      "solar:lsdp-resync",
    ]) target.addEventListener(type, (event) => addEvent(type, event));
  };
  new MutationObserver(attach).observe(document, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", attach, { once: true });
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (proof.performanceEntries.length >= 8192) {
        proof.droppedPerformanceEntries++;
        continue;
      }
      let detail = null;
      try { detail = JSON.parse(JSON.stringify(entry.detail ?? null)); }
      catch { detail = { serializationError: true }; }
      proof.performanceEntries.push({
        name: entry.name,
        startTime: entry.startTime,
        duration: entry.duration,
        observedEpochMs: performance.timeOrigin + performance.now(),
        detail,
      });
    }
  });
  observer.observe({ entryTypes: ["measure"] });
})();`;

async function readFrontCanvas() {
  return page.evaluate(() => {
    const canvas = [...document.querySelectorAll("#scene canvas[aria-hidden='true']")].at(-1);
    if (!canvas) return { error: "retained-front-canvas-unavailable" };
    if (canvas.width < 1 || canvas.height < 1)
      return { error: "retained-front-canvas-empty", width: canvas.width, height: canvas.height };
    return {
      width: canvas.width,
      height: canvas.height,
      dataUrl: canvas.toDataURL("image/png"),
    };
  });
}

function recognizeCounter(image) {
  const processResult = spawnSync(
    tesseractPath,
    ["stdin", "stdout", "--psm", "7", "-c", "tessedit_char_whitelist=0123456789/"],
    { input: image, encoding: "utf8", windowsHide: true, maxBuffer: 1024 * 1024 },
  );
  if (processResult.error) throw processResult.error;
  if (processResult.status !== 0)
    throw new Error(`Tesseract exited ${processResult.status}: ${processResult.stderr}`);
  return processResult.stdout.trim();
}

async function waitForFinalPixels(baseline, startEpochMs) {
  const started = Date.now();
  const deadline = started + maxDrainMs;
  const baselineBytes = Buffer.from(baseline.dataUrl.split(",")[1], "base64");
  const baselineHash = hash(baselineBytes);
  let candidateHash = null;
  let candidateImage = null;
  let ocrText = null;
  let lastOcrHash = null;
  let stablePolls = 0;
  let lastImage = baseline;
  let final = false;
  let retainedCanvasPollCount = 0;
  let retainedCanvasValidPollCount = 0;
  let ocrAttemptCount = 0;
  let matchingOcrCount = 0;
  const observedPixelHashes = new Set();
  while (Date.now() < deadline) {
    await page.waitForTimeout(200);
    const image = await readFrontCanvas();
    retainedCanvasPollCount++;
    if (image.error) continue;
    retainedCanvasValidPollCount++;
    const bytes = Buffer.from(image.dataUrl.split(",")[1], "base64");
    const imageHash = hash(bytes);
    observedPixelHashes.add(imageHash);
    lastImage = image;
    if (imageHash !== candidateHash) {
      candidateHash = imageHash;
      candidateImage = image;
      stablePolls = 0;
    } else stablePolls++;
    if (imageHash === baselineHash || stablePolls < 2 || imageHash === lastOcrHash) continue;
    lastOcrHash = imageHash;
    ocrAttemptCount++;
    ocrText = recognizeCounter(bytes);
    if (matchesFinalPixelText(ocrText, expectedFinalValue)) {
      matchingOcrCount++;
      candidateImage = image;
      finalPixelData = bytes;
      final = true;
      break;
    }
  }
  if (!final && candidateImage?.dataUrl)
    finalPixelData = Buffer.from(candidateImage.dataUrl.split(",")[1], "base64");
  const latestImage = candidateImage ?? lastImage;
  return {
    passed: final,
    source: "Solar CanvasPresentation retained front canvas (2D copy after Vision frame-submitted)",
    width: latestImage.width ?? null,
    height: latestImage.height ?? null,
    sha256: finalPixelData ? hash(finalPixelData) : null,
    ocrText,
    expectedText: expectedFinalValue,
    captureEpochMs: Date.now(),
    elapsedSinceProducerStartMs: Date.now() - startEpochMs,
    drainWaitMs: Date.now() - started,
    baselineSha256: baselineHash,
    finalSha256: candidateHash,
    changedFromBaseline: candidateHash !== null && candidateHash !== baselineHash,
    timedOut: !final,
    retainedCanvasPollCount,
    retainedCanvasValidPollCount,
    sampledDistinctPixelHashCount: observedPixelHashes.size,
    ocrAttemptCount,
    matchingOcrCount,
    actualDisplayFrameSampleCount: null,
    actualDisplayFrameSampleUnavailableReason:
      "Retained-canvas reads may observe the same displayed image repeatedly; no display-frame identity is exposed by this host proof.",
  };
}

async function main() {
  markPhase("private-server-startup");
  await mkdir(evidenceDir, { recursive: true });
  if (!existsSync(scene)) throw new Error(`Scene fixture is missing: ${scene}`);
  if (!existsSync(nativeBinary)) throw new Error(`Native binary is missing: ${nativeBinary}`);
  if (!existsSync(tesseractPath)) throw new Error(`Tesseract is missing: ${tesseractPath}`);
  const require = createRequire(resolve(values["playwright-root"], "package.json"));
  const { chromium } = require("playwright");

  const port = await reservePort();
  serverProcess = spawn(
    process.execPath,
    [localServerPath, "--scene", scene, "--lsdp-bin", nativeBinary, "--port", String(port)],
    { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  serverProcess.once("error", (error) => result.failures.push(`native-server: ${error.message}`));
  const serverReadyPromise = waitForServerReady(serverProcess);
  const serverReady = await serverReadyPromise;
  result.server = {
    ready: true,
    solar: serverReady.solar,
    nativeUrl: serverReady.native,
    nativePid: serverReady.nativePid,
    sceneId: serverReady.sceneId,
    archiveDigest: serverReady.archiveDigest,
    port,
  };

  const progress = await startProgressServer();
  progressServer = progress.server;
  result.progressCallbacks = [];

  markPhase("private-chrome-startup");
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
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const pageErrors = [];
  const consoleErrors = [];
  const requestFailures = [];
  const badResponses = [];
  page.on("pageerror", (error) =>
    pageErrors.push(observedError("browser-page", error.message)),
  );
  page.on("console", (message) => {
    if (message.type() === "error")
      consoleErrors.push(observedError("browser-console", message.text()));
  });
  page.on("requestfailed", (request) =>
    requestFailures.push(
      observedError("browser-request", request.failure()?.errorText ?? null, {
        url: request.url(),
      }),
    ),
  );
  page.on("response", (response) => {
    if (response.status() >= 400)
      badResponses.push(
        observedError("browser-response", `HTTP ${response.status()}`, {
          url: response.url(),
          status: response.status(),
        }),
      );
  });
  await page.route("**/favicon.ico", (route) =>
    route.fulfill({ status: 204, body: "" }),
  );
  await page.addInitScript(browserInitScript);
  markPhase("browser-navigation");
  const navigation = await page.goto(serverReady.solar, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  result.browserNavigationStatus = navigation?.status() ?? null;
  let ready = false;
  markPhase("solar-vision-readiness");
  try {
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.solarStatus === "live" &&
        document.querySelector("#scene canvas[aria-hidden='true']")?.width > 0,
      null,
      { timeout: 15000 },
    );
    ready = true;
  } catch {
    result.startupDiagnostics = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      status: document.documentElement.dataset.solarStatus ?? null,
      bodyText: document.body?.innerText?.slice(0, 2000) ?? null,
      sceneHtml: document.getElementById("scene")?.outerHTML?.slice(0, 2000) ?? null,
      scripts: [...document.scripts].map((script) => script.src || "inline"),
      canvases: [...document.querySelectorAll("#scene canvas")].map((canvas) => ({
        width: canvas.width,
        height: canvas.height,
        ariaHidden: canvas.getAttribute("aria-hidden"),
      })),
      proofAttached: window.__nativeBurstProof?.attached ?? false,
      performanceResources: performance.getEntriesByType("resource")
        .slice(-30)
        .map((entry) => ({ name: entry.name, duration: entry.duration })),
    }));
    result.browser = {
      engine: "Chrome",
      version: browser.version(),
      headless: true,
      pageUrl: page.url(),
      pageErrors,
      consoleErrors,
      requestFailures,
      badResponses,
    };
    throw new Error(
      `Solar/Vision browser did not reach live status: ${JSON.stringify(result.startupDiagnostics)}; console=${JSON.stringify(consoleErrors)}; badResponses=${JSON.stringify(badResponses)}`,
    );
  }
  if (!ready) throw new Error("Solar/Vision browser did not reach live status.");
  result.browser = {
    engine: "Chrome",
    version: browser.version(),
    headless: true,
    pageUrl: page.url(),
    pageErrors,
    consoleErrors,
    requestFailures,
    badResponses,
  };
  markPhase("baseline-canvas-read");
  const baseline = await readFrontCanvas();
  if (baseline.error) throw new Error(`Initial Vision canvas missing: ${baseline.error}`);

  producerProcess = spawn(
    process.execPath,
    [producerPath, serverReady.native, values.mode, String(durationMs)],
    { cwd: root, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  const producer = collectProducer(producerProcess);
  const producerReady = await producer.ready;
  result.producerReady = producerReady;
  const startEpochMs = Date.now() + 250;
  result.benchmarkStartEpochMs = startEpochMs;
  await page.evaluate((start) => {
    window.__nativeBurstProof.startEpochMs = start;
  }, startEpochMs);
  producerProcess.stdin.write(
    JSON.stringify({ startEpochMs, origin: progress.origin }) + "\n",
  );
  markPhase("measured-transaction-window");
  const producerExit = await new Promise((resolveExit, rejectExit) => {
    const timer = setTimeout(() => {
      producerProcess.kill("SIGTERM");
      rejectExit(new Error("Native producer exceeded the 45 second run limit."));
    }, 45000);
    producer.exit.then(
      (value) => {
        clearTimeout(timer);
        resolveExit(value);
      },
      (error) => {
        clearTimeout(timer);
        rejectExit(error);
      },
    );
  });
  producerLineReader?.close();
  if (producerExit.code !== 0) throw new Error(`Native producer exit code ${producerExit.code}.`);
  result.producerExit = producerExit;
  if (!result.producer) throw new Error("Native producer did not emit its final receipt set.");
  result.producerSummary = summarizeProducer(result.producer);

  markPhase("authoritative-native-readback");
  const authoritative = await withNative(serverReady.native, (peer) => readNative(peer, "scene"));
  const actualFinalValue = authoritative.state?.defaults?.["__lit.text.text_msxz43eh_1"] ?? null;
  result.authoritative = {
    stateHash: authoritative.stateHash,
    value: actualFinalValue,
    expectedStateHash: result.producer.finalStateHash,
    expectedValue: expectedFinalValue,
    hashMatchesProducer: authoritative.stateHash === result.producer.finalStateHash,
    valueMatchesExpected: actualFinalValue === expectedFinalValue,
  };

  markPhase("retained-canvas-drain-and-ocr");
  const pixels = await waitForFinalPixels(baseline, startEpochMs);
  result.pixels = pixels;
  if (finalPixelData) await writeFile(pixelsPath, finalPixelData);

  markPhase("browser-diagnostics-capture");
  await page.waitForTimeout(150);
  const browserCapture = await page.evaluate(() => ({
    attached: window.__nativeBurstProof?.attached ?? false,
    droppedEvents: window.__nativeBurstProof?.droppedEvents ?? null,
    droppedPerformanceEntries: window.__nativeBurstProof?.droppedPerformanceEntries ?? null,
    events: window.__nativeBurstProof?.events ?? [],
    performanceEntries: window.__nativeBurstProof?.performanceEntries ?? [],
    solarStatus: document.documentElement.dataset.solarStatus ?? null,
    retainedCanvasCount: document.querySelectorAll("#scene canvas[aria-hidden='true']").length,
  }));
  result.browserCapture = {
    attached: browserCapture.attached,
    droppedEvents: browserCapture.droppedEvents,
    droppedPerformanceEntries: browserCapture.droppedPerformanceEntries,
    solarStatus: browserCapture.solarStatus,
    retainedCanvasCount: browserCapture.retainedCanvasCount,
  };
  const benchmarkEvents = browserCapture.events.filter(
    (event) => event.captureEpochMs >= startEpochMs,
  );
  const benchmarkPerformance = browserCapture.performanceEntries.filter(
    (entry) => entry.observedEpochMs >= startEpochMs,
  );
  const receivedEvents = benchmarkEvents.filter((event) => event.type === "solar:lsdp-received");
  const appliedEvents = benchmarkEvents.filter((event) => event.type === "solar:lsdp-applied");
  const resyncEvents = benchmarkEvents.filter((event) => event.type === "solar:lsdp-resync");
  const expectedReceipts = result.producer.receipts ?? [];
  const measurementEndEpochMs = Date.now();
  result.measurementWindow = {
    startEpochMs,
    endEpochMs: measurementEndEpochMs,
    definition: "producer start through final bounded browser event/performance snapshot; teardown starts after this boundary",
  };
  result.solar = {
    receivedCount: receivedEvents.length,
    appliedCount: appliedEvents.length,
    resyncCount: resyncEvents.length,
    resyncReasons: resyncEvents.map((event) => event.detail.reason ?? null),
    receivedTransactions: correlateTransactions(expectedReceipts, receivedEvents),
    appliedTransactions: correlateTransactions(expectedReceipts, appliedEvents),
    presentations: summarizePresentations(appliedEvents),
    receiveToPresentation: summarizeReceiveToPresentation(receivedEvents, appliedEvents),
    performance: summarizePerformance(benchmarkPerformance),
    postAckDrain: summarizePostAckDrain(result.producer, appliedEvents, pixels),
    rawEvents: benchmarkEvents,
    rawPerformanceEntries: benchmarkPerformance,
  };
  markPhase("host-diagnostics-snapshot");
  const healthResponse = await fetch(`${serverReady.solar}health`);
  result.hostDiagnostics = healthResponse.ok
    ? await healthResponse.json()
    : { status: healthResponse.status };
  result.hostDiagnosticsObservedEpochMs = Date.now();
  result.hostDiagnosticsObservedPhase = currentPhase;
  markPhase("browser-close");
  await browser.close();
  browser = null;
  markPhase("measurement-error-aggregation");
  const hostErrors = (result.hostDiagnostics.events ?? [])
    .filter((event) => event.type === "error")
    .map((event) => ({
      source: "native-host-health-event",
      phase: result.hostDiagnosticsObservedPhase,
      observedEpochMs: result.hostDiagnosticsObservedEpochMs,
      message: event.message ?? null,
    }));
  const errorRecords = [
    ...result.serverLogs.stderr,
    ...result.producerLogs.stderr,
    ...pageErrors,
    ...consoleErrors,
    ...requestFailures,
    ...badResponses,
    ...hostErrors,
  ];
  const teardownPhases = new Set([
    "browser-close",
    "private-server-stop",
    "progress-server-close",
  ]);
  const beforeTeardown = errorRecords.filter(
    (error) => !teardownPhases.has(error.phase),
  );
  const observedDuringMeasurement = errorRecords.filter((error) => {
    const observedAt = error.captureEpochMs ?? error.observedEpochMs;
    return Number.isFinite(observedAt) &&
      observedAt >= startEpochMs &&
      observedAt <= measurementEndEpochMs;
  });
  const postMeasurementBeforeTeardown = beforeTeardown.filter(
    (error) => !observedDuringMeasurement.includes(error),
  );
  result.errors = {
    producerStderr: result.producerLogs.stderr,
    nativeHostStderr: result.serverLogs.stderr,
    browserPageErrors: pageErrors,
    browserConsoleErrors: consoleErrors,
    browserRequestFailures: requestFailures,
    browserBadResponses: badResponses,
    hostErrors,
    count: errorRecords.length,
    observedDuringMeasurementCount: observedDuringMeasurement.length,
    observedBeforeTeardownCount: beforeTeardown.length,
    postMeasurementBeforeTeardownCount: postMeasurementBeforeTeardown.length,
    teardownObservedCount: errorRecords.length - beforeTeardown.length,
    countDefinition: "raw observations by source, including repeated reports of the same underlying issue",
  };
  result.browser = {
    engine: "Chrome",
    version: browser?.version?.() ?? result.browser.version,
    headless: true,
    pageUrl: result.browser.pageUrl,
    pageErrors,
    consoleErrors,
    requestFailures,
    badResponses,
  };
  result.capture = {
    cameraRequests: (result.hostDiagnostics.events ?? []).filter((event) => event.type === "camera").length,
    progressCallbackCount: result.progressCallbacks.length,
    progressCallbacks: result.progressCallbacks,
    noSharedProcessAttached: true,
  };
  const receiptSetComplete =
    result.producerSummary.receiptCount === expectedOperations &&
    result.producerSummary.uniqueReceiptCount === expectedOperations &&
    result.producerSummary.duplicateReceiptIds.length === 0;
  const observedEventDetailsConsistent =
    result.solar.receivedTransactions.unexpectedEvents.length === 0 &&
    result.solar.receivedTransactions.duplicateObservedIds.length === 0 &&
    result.solar.receivedTransactions.hashMismatches.length === 0 &&
    result.solar.receivedTransactions.hashUnavailableIds.length === 0 &&
    result.solar.appliedTransactions.unexpectedEvents.length === 0 &&
    result.solar.appliedTransactions.duplicateObservedIds.length === 0 &&
    result.solar.appliedTransactions.hashMismatches.length === 0 &&
    result.solar.appliedTransactions.hashUnavailableIds.length === 0;
  const nativeFinalMatches =
    result.authoritative.hashMatchesProducer && result.authoritative.valueMatchesExpected;
  const progressComplete =
    result.progressCallbacks.some((item) => item.body?.native === expectedOperations);
  const rateMatches =
    values.mode !== "paced" ||
    (result.producerSummary.sentToAckRatePerSecond !== null &&
      result.producerSummary.sentToAckRatePerSecond >= 130);
  result.checks = {
    receiptSetComplete,
    receivedIdentityAndHashesComplete: result.solar.receivedTransactions.complete,
    appliedIdentityAndHashesComplete: result.solar.appliedTransactions.complete,
    observedEventDetailsConsistent,
    nativeFinalMatches,
    finalVisionPixelsMatch: pixels.passed,
    progressCallbackComplete: progressComplete,
    sustainedRateAtLeast130PerSecond: values.mode === "paced" ? rateMatches : null,
    queueMetricsObserved:
      result.solar.performance.workerMainQueueHighWater !== null &&
      result.solar.performance.framePatchQueueHighWater !== null,
    diagnosticsCaptureBounded:
      browserCapture.events.length <= 4096 &&
      browserCapture.performanceEntries.length <= 8192 &&
      browserCapture.droppedEvents === 0 &&
      browserCapture.droppedPerformanceEntries === 0,
    noErrors: beforeTeardown.length === 0,
  };
  result.passed =
    receiptSetComplete &&
    observedEventDetailsConsistent &&
    nativeFinalMatches &&
    pixels.passed &&
    progressComplete &&
    rateMatches &&
    result.checks.diagnosticsCaptureBounded &&
    result.checks.queueMetricsObserved &&
    result.checks.noErrors;
  result.limitations = {
    gpuCompletion: "unavailable; Vision exposes frame-submitted and submission-call measurements only",
    physicalScanout: "not measured; evidence is the private browser retained front canvas",
    transactionAckHash: result.producerSummary.ackStateHashUnavailableCount
      ? "unavailable on the native apply ACK; observed Solar receive/applied hashes and final authoritative state are compared separately"
      : "captured per native ACK",
    browserCoverage:
      "received/applied event coverage includes only mutations observed before any explicit resync; resync snapshot recovery is reported separately",
  };
  result.completedAt = new Date().toISOString();

  if (result.solar.receivedTransactions.missingIds.length || result.solar.appliedTransactions.missingIds.length)
    result.passed = false;
}

try {
  result.progressCallbacks = [];
  await main();
} catch (error) {
  result.failures.push(error instanceof Error ? error.stack ?? error.message : String(error));
  result.passed = false;
  result.completedAt = new Date().toISOString();
} finally {
  try {
    if (producerProcess && producerProcess.exitCode === null) producerProcess.kill("SIGTERM");
    if (producerLineReader) producerLineReader.close();
    if (serverProcess && serverProcess.exitCode === null) {
      markPhase("private-server-stop");
      serverProcess.kill("SIGINT");
      await waitForExit(serverProcess, 10000, "Private Solar host").catch((error) =>
        result.failures.push(error.message),
      );
    }
    if (serverLineReader) serverLineReader.close();
    if (progressServer) {
      markPhase("progress-server-close");
      await new Promise((resolveClose) => progressServer.close(() => resolveClose()));
    }
    if (browser) {
      markPhase("browser-close");
      await browser.close();
      browser = null;
    }
  } catch (error) {
    result.failures.push(`cleanup: ${error instanceof Error ? error.message : String(error)}`);
    result.passed = false;
  }
  result.completedAt ??= new Date().toISOString();
  result.phaseTimeline = phaseTimeline;
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(resultPath, JSON.stringify(result, null, 2) + "\n");
}

process.stdout.write(
  JSON.stringify({
    passed: result.passed === true,
    scenario: result.scenario,
    receipts: result.producerSummary?.receiptCount ?? null,
    sentToAckRatePerSecond: result.producerSummary?.sentToAckRatePerSecond ?? null,
    received: result.solar?.receivedCount ?? null,
    applied: result.solar?.appliedCount ?? null,
    frames: result.solar?.presentations.submittedFrameCount ?? null,
    coalesced: result.solar?.presentations.coalescedMutationCount ?? null,
    resyncs: result.solar?.resyncCount ?? null,
    receiveToPresentationMs: result.solar?.receiveToPresentation?.latency ?? null,
    workerQueueHighWater: result.solar?.performance.workerMainQueueHighWater ?? null,
    patchQueueHighWater: result.solar?.performance.framePatchQueueHighWater ?? null,
    canvasPolls: result.pixels?.retainedCanvasPollCount ?? null,
    ocrAttempts: result.pixels?.ocrAttemptCount ?? null,
    nativeFinalMatches: result.checks?.nativeFinalMatches ?? false,
    finalPixelsMatch: result.checks?.finalVisionPixelsMatch ?? false,
    errors: result.errors?.observedDuringMeasurementCount ?? null,
    preTeardownErrors: result.errors?.observedBeforeTeardownCount ?? null,
    teardownErrors: result.errors?.teardownObservedCount ?? null,
    evidence: resultPath,
    pixels: existsSync(pixelsPath) ? pixelsPath : null,
    failures: result.failures,
  }) + "\n",
);
if (!result.passed) process.exitCode = 1;
