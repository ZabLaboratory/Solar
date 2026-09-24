// Local, reproducible Solar served-host integration probe. It loads the built
// CEF page without Vite/import maps, speaks LSDP/1.1 on loopback, and uses the
// real Zab Blue canvas-chat-sponso bundle with hash-checked surrogate images.
/* global URL, URLSearchParams, setTimeout, window, document, HTMLImageElement, console, fetch, process, Buffer */
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import WebSocket, { WebSocketServer } from "ws";
import { encodeFrame, sceneChanged, sceneRoster, snapshot } from "@lumencast/protocol";
import { hashInlineBundle } from "@lumencast/protocol/conformance";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const hostDir = join(repo, "dist", "host");
const fixturePath = "D:/Documents/Zab/Orion/tests/e2e/testdata/canvas-chat-sponso.scene-bundle.json";
const assetDir = "C:/Users/Mathias/.codex/visualizations/2026/09/18/01a0b4c9-a426-7450-8ba2-1d64f13e85d5/zab-blue-image-assets";
const cefGenerationMode = process.argv.some((arg) => arg.startsWith("--cef-generation="));
const cefRemoteMode = cefGenerationMode || process.argv.some((arg) => arg.startsWith("--cef-remote="));
const cefRemoteWarm = process.argv.includes("--cef-remote=warm") || process.argv.includes("--cef-generation=warm");
if (cefRemoteMode && !process.argv.some((arg) => [
  "--cef-remote=warm", "--cef-remote=cold", "--cef-generation=warm", "--cef-generation=cold",
].includes(arg))) {
  throw new Error("CEF remote mode must be --cef-remote=warm/cold or --cef-generation=warm/cold");
}
const cefMode = process.argv.includes("--cef") || cefRemoteMode;
const fixtureBytes = await readFile(fixturePath);
const fixture = JSON.parse(fixtureBytes.toString("utf8"));
const layout = Object.values(fixture.canvas_layouts)[0];
let blueVersion = `sha256:${layout.version}`;
const stageVersion = `sha256:${"1".repeat(64)}`;
const blueBundle = {
  scene_version: blueVersion,
  root: layout.root,
  operator_inputs: layout.operator_inputs,
  assets: layout.assets,
};
const stageBundle = {
  scene_version: stageVersion,
  root: {
    kind: "frame", id: "stage", props: { width: 1920, height: 1080, background: "#101820" },
    children: [{ kind: "text", id: "title", props: { value: "STAGING", size: 48, colour: "#fff" } }],
  },
};
const blueState = {};
function collectBindings(node) {
  for (const [prop, path] of Object.entries(node.bindings ?? {})) {
    if (node.props?.[prop] !== undefined) blueState[path] = node.props[prop];
  }
  for (const child of node.children ?? []) collectBindings(child);
}
collectBindings(layout.root);

const manifest = JSON.parse(await readFile(join(assetDir, "manifest.json"), "utf8"));
const assets = new Map();
for (const [id, item] of Object.entries(manifest.assets)) {
  const path = join(assetDir, item.file);
  const bytes = await readFile(path);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== item.sha256) throw new Error(`asset hash mismatch: ${path}`);
  assets.set(id, { path, bytes, contentType: item.contentType, sha256: hash });
}
if (assets.size !== 3) throw new Error(`expected three distinct Blue image assets, got ${assets.size}`);

if (cefRemoteMode) {
  // The historic Figma URLs are expired. Use three live HTTPS images from a
  // host already allowed by the authored Blue bundle, with unique query keys
  // so each Pulsar process measures a fresh network transfer.
  const nonce = randomBytes(8).toString("hex");
  const urls = [
    "https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Jinx_0.jpg",
    "https://ddragon.leagueoflegends.com/cdn/14.24.1/img/champion/Jinx.png",
    "https://ddragon.leagueoflegends.com/cdn/14.24.1/img/champion/Ahri.png",
  ].map((url, index) => `${url}?roster_probe=${nonce}-${index}`);
  const remoteByUrl = new Map([...assets.keys()].map((id, index) =>
    [`https://www.figma.com/api/mcp/asset/${id}`, urls[index]]));
  const visit = (node) => {
    if (node.props?.src && remoteByUrl.has(node.props.src)) {
      node.props.src = remoteByUrl.get(node.props.src);
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(blueBundle.root);
  for (const [path, value] of Object.entries(blueState)) {
    if (remoteByUrl.has(value)) blueState[path] = remoteByUrl.get(value);
  }
  blueVersion = await hashInlineBundle(blueBundle);
  blueBundle.scene_version = blueVersion;
} else if (cefMode) {
  // The original Figma asset URLs in this historical fixture have expired.
  // CEF cannot use Playwright's request interception, so derive a new,
  // content-addressed test bundle with those same three checksum-verified
  // representative images inlined. This tests CEF scene rendering with images,
  // NOT remote-image preloading (the image warmer intentionally skips data:).
  const inlineByUrl = new Map();
  for (const [id, asset] of assets) {
    inlineByUrl.set(`https://www.figma.com/api/mcp/asset/${id}`,
      `data:${asset.contentType};base64,${asset.bytes.toString("base64")}`);
  }
  const visit = (node) => {
    if (node.props?.src && inlineByUrl.has(node.props.src)) {
      node.props.src = inlineByUrl.get(node.props.src);
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(blueBundle.root);
  for (const [path, value] of Object.entries(blueState)) {
    if (inlineByUrl.has(value)) blueState[path] = inlineByUrl.get(value);
  }
  blueVersion = await hashInlineBundle(blueBundle);
  blueBundle.scene_version = blueVersion;
}

const contentType = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".woff2": "font/woff2",
};
const peers = new Set();
const bundleRequests = [];
const probeEvents = [];
let generationSubscribeAt = null;
const cefProbeScript = `<script>
(() => {
  const send = (event) => { void fetch('/probe-event', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event)
  }).catch(() => undefined); };
  const originalDecode = HTMLImageElement.prototype.decode;
  HTMLImageElement.prototype.decode = async function() {
    const detached = !this.isConnected;
    const url = this.src;
    try {
      await originalDecode.call(this);
      if (detached) send({ kind: 'detached-decode', url, success: true });
    } catch (error) {
      if (detached) send({ kind: 'detached-decode', url, success: false });
      throw error;
    }
  };
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.name.startsWith('https://ddragon.leagueoflegends.com/')) {
        send({ kind: 'resource', url: entry.name, duration: entry.duration });
      }
    }
  }).observe({ type: 'resource', buffered: true });
  const timer = setInterval(() => {
    const scene = document.querySelector('#scene');
    if (!scene?.textContent?.includes('BROKEN BLADE')) return;
    const images = [...scene.querySelectorAll('img')];
    if (images.length >= 30 && images.every((image) => image.complete && image.naturalWidth > 0)) {
      clearInterval(timer);
      send({ kind: 'images-ready', count: images.length });
    }
  }, 16);
})();
</script>`;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/probe-event" && req.method === "POST" && cefRemoteMode) {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 4096) throw new Error("probe event too large");
      }
      probeEvents.push({ ...JSON.parse(body), receivedAt: Date.now() });
      res.writeHead(204).end();
      return;
    }
    if (url.pathname === "/switch" && req.method === "POST") {
      for (const ws of peers) {
        ws.send(encodeFrame(sceneChanged({ seq: 2, scene_id: "canvas-chat-sponso", scene_version: blueVersion })));
        ws.send(encodeFrame(snapshot({ seq: 1, scene_id: "canvas-chat-sponso", scene_version: blueVersion, state: blueState })));
      }
      res.writeHead(204).end();
      return;
    }
    const bundleMatch = url.pathname.match(/^\/orion\/api\/v1\/scenes\/([^/]+)\/render-bundle$/);
    if (bundleMatch) {
      const version = url.searchParams.get("v");
      const bundle = version === blueVersion ? blueBundle : version === stageVersion ? stageBundle : null;
      bundleRequests.push({ scene: decodeURIComponent(bundleMatch[1]), version, status: bundle ? 200 : 404 });
      res.writeHead(bundle ? 200 : 404, { "content-type": "application/json" });
      res.end(JSON.stringify(bundle ?? { error: "unknown bundle" }));
      return;
    }
    const prefix = "/orion/static/solar/v2.0.2/";
    if (url.pathname.startsWith(prefix)) {
      const relative = url.pathname.slice(prefix.length) || "index.html";
      const file = resolve(hostDir, relative);
      if (!file.startsWith(`${hostDir}\\`) && file !== join(hostDir, "index.html")) {
        res.writeHead(403).end();
        return;
      }
      let bytes = await readFile(file);
      if (cefRemoteMode && relative === "index.html") {
        bytes = Buffer.from(bytes.toString("utf8").replace("</head>", `${cefProbeScript}</head>`));
      }
      res.writeHead(200, { "content-type": contentType[extname(file)] ?? "application/octet-stream" });
      res.end(bytes);
      return;
    }
    res.writeHead(404).end();
  } catch (error) {
    res.writeHead(500).end(String(error));
  }
});
const wss = new WebSocketServer({ noServer: true, handleProtocols: (protocols) =>
  protocols.has("lsdp.v1.1") ? "lsdp.v1.1" : false });
server.on("upgrade", (request, socket, head) => {
  const expectedWire = cefGenerationMode ? "generation.lsdp" : "stream.lsdp";
  if (!request.url?.startsWith(`/orion/api/v1/show/${expectedWire}`)) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
});
wss.on("connection", (ws) => {
  peers.add(ws);
  ws.on("close", () => peers.delete(ws));
  ws.on("message", (raw) => {
    const frame = JSON.parse(String(raw));
    if (frame.type !== "subscribe") return;
    if (cefGenerationMode) {
      generationSubscribeAt = Date.now();
      ws.send(encodeFrame(snapshot({ seq: 1, scene_id: "canvas-chat-sponso", scene_version: blueVersion, state: blueState })));
      ws.send(encodeFrame(sceneRoster({ entries: [
        { scene_id: "canvas-chat-sponso", scene_version: blueVersion },
      ] })));
      return;
    }
    ws.send(encodeFrame(snapshot({ seq: 1, scene_id: "stage", scene_version: stageVersion, state: {} })));
    ws.send(encodeFrame(sceneRoster({ entries: [
      { scene_id: "stage", scene_version: stageVersion },
      { scene_id: "canvas-chat-sponso", scene_version: blueVersion },
    ] })));
  });
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
if (!address || typeof address === "string") throw new Error("server has no port");
const port = address.port;
const browser = cefMode ? null : await chromium.launch({ channel: "chrome", headless: true });

async function waitUntil(predicate, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for probe condition");
    await new Promise((done) => setTimeout(done, 25));
  }
}

async function trial(warm) {
  if (!browser) throw new Error("Chrome trial requires a browser");
  const trialBundleBaseline = bundleRequests.filter((entry) => entry.version === blueVersion).length;
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const assetRequests = [];
  const errors = [];
  page.on("request", (request) => {
    if (request.url().startsWith("https://www.figma.com/api/mcp/asset/")) {
      assetRequests.push({ id: request.url().split("/").pop(), t: Date.now() });
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await context.route("https://www.figma.com/api/mcp/asset/**", (route) => {
    const id = route.request().url().split("/").pop();
    const asset = assets.get(id);
    return asset
      ? route.fulfill({ status: 200, path: asset.path, contentType: asset.contentType })
      : route.fulfill({ status: 404, body: "unknown asset" });
  });
  await page.addInitScript(() => {
    window.__rosterProbe = { detachedDone: 0, detachedFailed: 0 };
    const original = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = async function() {
      const detached = !this.isConnected;
      try {
        await original.call(this);
        if (detached) window.__rosterProbe.detachedDone++;
      } catch (error) {
        if (detached) window.__rosterProbe.detachedFailed++;
        throw error;
      }
    };
  });
  const orion = `ws://127.0.0.1:${port}/orion/api/v1/show/stream.lsdp`;
  const params = new URLSearchParams({ orion, token: "local-probe", mode: "broadcast" });
  if (warm) params.set("preload_roster_images", "1");
  await page.goto(`http://127.0.0.1:${port}/orion/static/solar/v2.0.2/?${params}`, { waitUntil: "load" });
  await page.waitForFunction(() => document.querySelector("#scene")?.textContent?.includes("STAGING"), null, { timeout: 10_000 });
  await waitUntil(() => bundleRequests.filter((entry) => entry.version === blueVersion).length > trialBundleBaseline);
  if (warm) {
    await page.waitForFunction(() => window.__rosterProbe?.detachedDone === 3, null, { timeout: 10_000 });
  } else {
    await page.waitForTimeout(300);
  }
  const beforeSwitchAssets = assetRequests.length;
  const beforeSwitchBundleRequests = bundleRequests.filter((entry) => entry.version === blueVersion).length - trialBundleBaseline;
  const switchStart = Date.now();
  const response = await page.request.post(`http://127.0.0.1:${port}/switch`);
  if (response.status() !== 204) throw new Error(`switch status ${response.status()}`);
  await page.waitForFunction(() => {
    const scene = document.querySelector("#scene");
    return scene?.textContent?.includes("BROKEN BLADE") && scene.querySelectorAll("img").length >= 30;
  }, null, { timeout: 10_000 });
  const renderedAt = Date.now();
  const images = await page.evaluate(async () => {
    const elements = [...document.querySelectorAll("#scene img")];
    const values = await Promise.all(elements.map(async (img) => {
      try { await img.decode(); return { ok: img.naturalWidth > 0, width: img.naturalWidth, height: img.naturalHeight }; }
      catch { return { ok: false, width: 0, height: 0 }; }
    }));
    return { count: elements.length, decoded: values.filter((v) => v.ok).length, failed: values.filter((v) => !v.ok).length };
  });
  const imagesReadyAt = Date.now();
  await page.waitForTimeout(650);
  const screenshotPath = join(here, warm ? "warm.png" : "cold.png");
  const png = await page.screenshot({ path: screenshotPath });
  const probe = await page.evaluate(() => window.__rosterProbe);
  const result = {
    warm, beforeSwitchAssets, afterSwitchAssets: assetRequests.length - beforeSwitchAssets,
    beforeSwitchBundleRequests,
    afterSwitchBundleRequests: bundleRequests.filter((entry) => entry.version === blueVersion).length - trialBundleBaseline - beforeSwitchBundleRequests,
    detachedDecodes: probe, images, msToRender: renderedAt - switchStart,
    msToImagesReady: imagesReadyAt - switchStart,
    screenshotSha256: createHash("sha256").update(png).digest("hex"), errors,
  };
  await context.close();
  return result;
}

async function cefTrial() {
  const pulsarExe = "D:/Documents/Zab/Pulsar/upstream/build_x64/rundir/RelWithDebInfo/bin/64bit/pulsar.exe";
  const portHolder = createServer();
  await new Promise((done) => portHolder.listen(0, "127.0.0.1", done));
  const holderAddress = portHolder.address();
  if (!holderAddress || typeof holderAddress === "string") throw new Error("OBS port unavailable");
  const obsPort = holderAddress.port;
  await new Promise((done) => portHolder.close(done));
  const password = randomBytes(18).toString("base64url");
  const child = spawn(pulsarExe, [], {
    cwd: dirname(pulsarExe),
    env: { ...process.env, PULSAR_PORT: String(obsPort), PULSAR_PASSWORD: password },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let bootTail = "";
  let ready = null;
  let exited = false;
  child.on("exit", () => { exited = true; });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => {
      bootTail = (bootTail + String(chunk)).slice(-16_000);
      const match = bootTail.match(/PULSAR_READY ws=(\S+) password=(\S+)/);
      if (match) ready = { url: match[1], password: match[2] };
    });
  }
  let obs = null;
  let captureSucceeded = false;
  let cleanupRequest = null;
  let sceneCreated = false;
  let inputCreated = false;
  const sceneName = `solar-roster-probe-${randomBytes(4).toString("hex")}`;
  const inputName = `${sceneName}-browser`;
  try {
    await waitUntil(() => ready !== null || exited, 60_000);
    if (!ready) throw new Error(`Pulsar exited before ready: ${bootTail}`);
    obs = new WebSocket(ready.url, ["obswebsocket.json"]);
    const inbox = [];
    obs.on("message", (raw) => inbox.push(JSON.parse(String(raw))));
    await waitUntil(() => obs.readyState === WebSocket.OPEN, 10_000);
    async function take(predicate, timeout = 15_000) {
      await waitUntil(() => inbox.some(predicate), timeout);
      return inbox.splice(inbox.findIndex(predicate), 1)[0];
    }
    const hello = await take((msg) => msg.op === 0);
    const identify = { rpcVersion: hello.d.rpcVersion, eventSubscriptions: 0x7ff };
    if (hello.d.authentication) {
      const { salt, challenge } = hello.d.authentication;
      const secret = createHash("sha256").update(password + salt).digest("base64");
      identify.authentication = createHash("sha256").update(secret + challenge).digest("base64");
    }
    obs.send(JSON.stringify({ op: 1, d: identify }));
    await take((msg) => msg.op === 2);
    let seq = 0;
    async function request(requestType, requestData = {}) {
      const requestId = `solar-probe-${++seq}`;
      obs.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
      return (await take((msg) => msg.op === 7 && msg.d.requestId === requestId)).d;
    }
    cleanupRequest = request;
    async function mustRequest(requestType, requestData = {}) {
      const response = await request(requestType, requestData);
      if (!response.requestStatus?.result) {
        throw new Error(`${requestType} rejected: ${JSON.stringify(response.requestStatus)}`);
      }
      return response.responseData;
    }
    const kinds = await mustRequest("GetInputKindList");
    if (!kinds.inputKinds?.includes("browser_source")) throw new Error("Pulsar has no CEF browser_source");
    const wire = cefGenerationMode ? "generation.lsdp" : "stream.lsdp";
    const orion = `ws://127.0.0.1:${port}/orion/api/v1/show/${wire}`;
    const params = new URLSearchParams({ orion, token: "local-probe", mode: "broadcast" });
    if (!cefRemoteMode || cefRemoteWarm) params.set("preload_roster_images", "1");
    const pageUrl = `http://127.0.0.1:${port}/orion/static/solar/v2.0.2/?${params}`;
    await mustRequest("CreateScene", { sceneName });
    sceneCreated = true;
    await mustRequest("CreateInput", {
      sceneName, inputName, inputKind: "browser_source",
      inputSettings: {
        url: pageUrl, is_local_file: false, width: 1920, height: 1080,
        fps_custom: true, fps: 30, shutdown: false, restart_when_active: false,
        reroute_audio: false,
      },
      sceneItemEnabled: true,
    });
    inputCreated = true;
    await mustRequest("SetCurrentProgramScene", { sceneName });
    await waitUntil(() => peers.size > 0 && bundleRequests.some((entry) =>
      entry.version === (cefGenerationMode ? blueVersion : stageVersion)), 30_000);
    async function capture(name, previousHash = null) {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const response = await request("GetSourceScreenshot", {
          sourceName: inputName, imageFormat: "png", imageWidth: 1920, imageHeight: 1080,
        });
        if (response.requestStatus?.result && response.responseData?.imageData) {
          const png = Buffer.from(response.responseData.imageData.split(",").pop(), "base64");
          const hash = createHash("sha256").update(png).digest("hex");
          if (png.length > 10_000 && png.readUInt32BE(16) === 1920 && png.readUInt32BE(20) === 1080 && hash !== previousHash) {
            await writeFile(join(here, name), png);
            return { sha256: hash, bytes: png.length, width: 1920, height: 1080 };
          }
        }
        await new Promise((done) => setTimeout(done, 750));
      }
      throw new Error(`CEF ${name} capture did not become distinct/nonblank`);
    }
    if (cefGenerationMode) {
      await waitUntil(() => probeEvents.some((event) => event.kind === "images-ready"), 30_000);
      await waitUntil(() => probeEvents.filter((event) => event.kind === "resource").length === 3, 10_000);
      await new Promise((done) => setTimeout(done, 500));
      const detachedDecodes = probeEvents.filter((event) => event.kind === "detached-decode" && event.success).length;
      const failedDetachedDecodes = probeEvents.filter((event) => event.kind === "detached-decode" && !event.success).length;
      const imageCount = probeEvents.find((event) => event.kind === "images-ready").count;
      if (imageCount !== 30 || failedDetachedDecodes !== 0 ||
          detachedDecodes !== (cefRemoteWarm ? 3 : 0)) {
        throw new Error("CEF generation remote-image/decode invariant failed");
      }
      const blue = await capture(`cef-generation-${cefRemoteWarm ? "warm" : "cold"}-blue.png`);
      captureSucceeded = true;
      return {
        mode: "Pulsar CEF immutable generation wire: initial Blue snapshot, then one-entry roster",
        source: "derived Blue fixture with three HTTPS Data Dragon images, cache-busted per Pulsar run",
        warm: cefRemoteWarm,
        msFromSubscribeToImagesReady: probeEvents.find((event) => event.kind === "images-ready").receivedAt - generationSubscribeAt,
        resources: probeEvents.filter((event) => event.kind === "resource").length,
        detachedDecodes,
        failedDetachedDecodes,
        imageCount,
        blue, bundleRequests: bundleRequests.filter((entry) => entry.status === 200),
      };
    }
    const stage = await capture(cefRemoteMode
      ? `cef-remote-${cefRemoteWarm ? "warm" : "cold"}-stage.png` : "cef-stage.png");
    if (cefRemoteMode && cefRemoteWarm) {
      await waitUntil(() => probeEvents.filter((event) =>
        event.kind === "detached-decode" && event.success).length === 3, 20_000);
      await waitUntil(() => probeEvents.filter((event) => event.kind === "resource").length === 3, 20_000);
    } else if (cefRemoteMode) {
      await new Promise((done) => setTimeout(done, 300));
    }
    const beforeSwitchResources = probeEvents.filter((event) => event.kind === "resource").length;
    const beforeSwitchDecodes = probeEvents.filter((event) => event.kind === "detached-decode" && event.success).length;
    const switchStart = Date.now();
    const switched = await fetch(`http://127.0.0.1:${port}/switch`, { method: "POST" });
    if (switched.status !== 204) throw new Error(`CEF switch returned ${switched.status}`);
    await waitUntil(() => bundleRequests.some((entry) => entry.version === blueVersion), 10_000);
    if (cefRemoteMode) {
      await waitUntil(() => probeEvents.some((event) => event.kind === "images-ready"), 30_000);
      await waitUntil(() => probeEvents.filter((event) => event.kind === "resource").length === 3, 10_000);
    }
    await new Promise((done) => setTimeout(done, cefRemoteMode ? 500 : 1000));
    const blue = await capture(cefRemoteMode
      ? `cef-remote-${cefRemoteWarm ? "warm" : "cold"}-blue.png` : "cef-blue.png", stage.sha256);
    if (cefRemoteMode && (probeEvents.find((event) => event.kind === "images-ready")?.count !== 30 ||
        beforeSwitchResources !== (cefRemoteWarm ? 3 : 0) ||
        beforeSwitchDecodes !== (cefRemoteWarm ? 3 : 0) ||
        probeEvents.filter((event) => event.kind === "resource").length !== 3 ||
        probeEvents.some((event) => event.kind === "detached-decode" && !event.success))) {
      throw new Error("CEF persistent remote-image/decode invariant failed");
    }
    captureSucceeded = true;
    return {
      mode: "Pulsar CEF browser_source + OBS GetSourceScreenshot",
      source: cefRemoteMode
        ? "derived Blue fixture with three HTTPS Data Dragon images, cache-busted per Pulsar run"
        : "derived Blue fixture with three checksum-verified local images inlined as data URLs",
      remoteImagePreloadMeasured: cefRemoteMode,
      ...(cefRemoteMode ? {
        warm: cefRemoteWarm,
        beforeSwitchResources,
        afterSwitchResources: probeEvents.filter((event) => event.kind === "resource").length - beforeSwitchResources,
        beforeSwitchDecodes,
        afterSwitchDecodes: probeEvents.filter((event) => event.kind === "detached-decode" && event.success).length - beforeSwitchDecodes,
        failedDetachedDecodes: probeEvents.filter((event) => event.kind === "detached-decode" && !event.success).length,
        msToImagesReady: probeEvents.find((event) => event.kind === "images-ready").receivedAt - switchStart,
        imageCount: probeEvents.find((event) => event.kind === "images-ready").count,
        imageUrls: probeEvents.filter((event) => event.kind === "resource").map((event) => event.url),
      } : {}),
      stage, blue, bundleRequests: bundleRequests.filter((entry) => entry.status === 200),
    };
  } finally {
    if (obs?.readyState === WebSocket.OPEN && cleanupRequest) {
      try { if (inputCreated) await cleanupRequest("RemoveInput", { inputName }); }
      catch { /* process teardown is the fallback */ }
      try { if (sceneCreated) await cleanupRequest("RemoveScene", { sceneName }); }
      catch { /* process teardown is the fallback */ }
    }
    if (obs?.readyState === WebSocket.OPEN) {
      try { obs.close(); } catch { /* best effort */ }
    }
    if (!exited) {
      child.kill();
      try { await waitUntil(() => exited, 8_000); }
      catch { child.kill("SIGKILL"); }
    }
    if (!captureSucceeded && bootTail) {
      console.error(`CEF probe failed; Pulsar boot tail:\n${bootTail.slice(-4000)}`);
    }
  }
}

try {
  if (cefMode) {
    const result = await cefTrial();
    const outputFile = cefGenerationMode
      ? `cef-generation-${cefRemoteWarm ? "warm" : "cold"}-results.json`
      : cefRemoteMode
        ? `cef-remote-${cefRemoteWarm ? "warm" : "cold"}-results.json` : "cef-results.json";
    await writeFile(join(here, outputFile), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } else {
  const cold = await trial(false);
  const warm = await trial(true);
  const results = {
    fixtureSha256: createHash("sha256").update(fixtureBytes).digest("hex"),
    assetPolicy: "three checksum-verified representative local images, not original Figma bytes",
    hostBundle: "Solar dist/host, self-contained CEF page with local Lumencast dist overlaid in disposable node_modules at build time",
    cold, warm,
  };
  await writeFile(join(here, "served-host-results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  if (cold.beforeSwitchAssets !== 0 || warm.beforeSwitchAssets !== 3 ||
      cold.afterSwitchAssets !== 3 || warm.afterSwitchAssets !== 0 ||
      cold.images.decoded !== 30 || warm.images.decoded !== 30 ||
      cold.images.failed !== 0 || warm.images.failed !== 0 ||
      warm.detachedDecodes.detachedDone !== 3 || warm.detachedDecodes.detachedFailed !== 0 ||
      cold.screenshotSha256 !== warm.screenshotSha256 ||
      cold.errors.length > 0 || warm.errors.length > 0) {
    throw new Error("served-host roster image acceptance failed");
  }
  }
} finally {
  await browser?.close();
  for (const ws of peers) ws.terminate();
  await new Promise((done) => wss.close(done));
  await new Promise((done) => server.close(done));
}
