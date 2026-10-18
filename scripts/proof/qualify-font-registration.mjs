/** Private browser/WASM font admission; never attaches to the shared application. */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    "installed-root": { type: "string" },
    "cache-index": { type: "string" },
    "playwright-root": { type: "string" },
    report: { type: "string" },
  },
});
for (const key of [
  "installed-root",
  "cache-index",
  "playwright-root",
  "report",
])
  if (!values[key]) throw new Error(`Missing --${key}`);
const installed = resolve(values["installed-root"]);
const indexPath = resolve(values["cache-index"]);
const cache = dirname(indexPath);
const reportPath = resolve(values.report);
const indexBytes = await readFile(indexPath);
const index = JSON.parse(indexBytes);
assert.equal(index.schema, "solar.installation-fonts.v1");
assert.ok(Array.isArray(index.sources));
assert.ok(index.sources.length <= 2048);
const entries = new Map();
for (const row of index.sources) {
  assert.match(row.hash, /^[a-f0-9]{64}$/);
  assert.ok(
    Number.isSafeInteger(row.size) &&
      row.size > 0 &&
      row.size <= 64 * 1024 * 1024,
  );
  entries.set(row.hash, row.size);
}
assert.ok([...entries.values()].reduce((a, b) => a + b, 0) <= 1024 ** 3);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const privateToken = randomBytes(32).toString("hex");
const batchSource = stripTypeScriptTypes(
  await readFile(
    new URL("../../src/scenes/installation-fonts.ts", import.meta.url),
    "utf8",
  ),
);
const artifacts = new Map([
  [
    "/pkg/lumencast_vision_web.js",
    join(installed, "vision/pkg/lumencast_vision_web.js"),
  ],
  [
    "/pkg/lumencast_vision_web_bg.wasm",
    join(installed, "vision/pkg/lumencast_vision_web_bg.wasm"),
  ],
]);
const provenance = {};
for (const [route, path] of artifacts) {
  const bytes = await readFile(path);
  provenance[route] = { sha256: hash(bytes), bytes: bytes.length };
}
const requestErrors = [];
const server = createServer(async (request, response) => {
  try {
    const route = new URL(request.url, "http://127.0.0.1").pathname;
    if (request.method !== "GET") {
      response.writeHead(405).end();
      return;
    }
    if (route === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end(
        '<!doctype html><title>Private font registry proof</title><canvas id="canvas" width="320" height="180"></canvas>',
      );
    } else if (route === "/installation-font-batches.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(batchSource);
    } else if (artifacts.has(route)) {
      response.setHeader(
        "Content-Type",
        route.endsWith(".wasm") ? "application/wasm" : "text/javascript",
      );
      response.end(await readFile(artifacts.get(route)));
    } else if (route === "/catalog" || route.startsWith("/catalog/")) {
      if (request.headers.authorization !== `Bearer ${privateToken}`) {
        response.writeHead(401).end();
        return;
      }
      if (route === "/catalog") {
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify(
            [...entries].map(([hash, bytes]) => ({ hash, bytes })),
          ),
        );
      } else {
        const digest = route.slice("/catalog/".length);
        if (!entries.has(digest)) {
          response.writeHead(404).end();
          return;
        }
        const bytes = await readFile(join(cache, digest));
        assert.equal(bytes.length, entries.get(digest));
        assert.equal(hash(bytes), digest);
        response.setHeader("Content-Type", "application/octet-stream");
        response.end(bytes);
      }
    } else response.writeHead(404).end();
  } catch (error) {
    requestErrors.push(error.code ?? error.name);
    if (!response.headersSent) response.writeHead(500);
    response.end();
  }
});
const require = createRequire(
  join(resolve(values["playwright-root"]), "package.json"),
);
const { chromium } = require("playwright");
let browser, timer;
const report = {
  capturedUtc: new Date().toISOString(),
  passed: false,
  privateBrowser: true,
  sharedApplicationTouched: false,
  fontsChanged: false,
  indexSha256: hash(indexBytes),
  uniqueEncodedFiles: entries.size,
  encodedBytes: [...entries.values()].reduce((a, b) => a + b, 0),
  artifacts: provenance,
  counterSemantics:
    "registered_fonts and registration_count count distinct decoded font resources, not individual TTC faces or glyph coverage.",
  scope:
    "Real private Rust/WASM registry admission using existing Solar installationFontBatches, two passes in one empty engine. No scene, glyph rendering or shared-runtime registration is claimed.",
};
try {
  await new Promise((yes, no) => {
    server.once("error", no);
    server.listen(0, "127.0.0.1", yes);
  });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  report.browserVersion = browser.version();
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  report.registry = await Promise.race([
    page.evaluate(
      async ({ token, count }) => {
        const wasm = await import("/pkg/lumencast_vision_web.js");
        await wasm.default();
        const { installationFontBatches } =
          await import("/installation-font-batches.js");
        const engine = await wasm.VisionGpuEngine.create_empty_html_canvas(
          globalThis.document.querySelector("canvas"),
          320,
          180,
        );
        const passes = [];
        try {
          for (let pass = 0; pass < 2; pass++) {
            const started = performance.now();
            const batches = [];
            let files = 0;
            for await (const fonts of installationFontBatches({
              url: `${globalThis.location.origin}/catalog`,
              token,
            })) {
              const info = JSON.parse(engine.preload_fonts(fonts));
              files += fonts.length;
              batches.push({ files: fonts.length, info });
            }
            if (files !== count)
              throw new Error("Font batch coverage mismatch");
            passes.push({
              files,
              batches,
              elapsedMs: performance.now() - started,
              final: JSON.parse(engine.font_registry_info_json()),
            });
          }
          return { engineCreations: 1, sceneLoads: 0, passes };
        } finally {
          engine.free();
        }
      },
      { token: privateToken, count: entries.size },
    ),
    new Promise((_, no) => {
      timer = setTimeout(
        () => no(new Error("Private font proof exceeded 120s")),
        120000,
      );
    }),
  ]);
  const [cold, warm] = report.registry.passes;
  assert.ok(cold.final.registered_fonts > 0);
  assert.equal(cold.final.decode_count, entries.size);
  assert.deepEqual(warm.final, cold.final);
  assert.deepEqual(requestErrors, []);
  report.passed = true;
} catch (error) {
  report.failure = String(error.message).replaceAll(privateToken, "[redacted]");
} finally {
  clearTimeout(timer);
  await browser?.close();
  server.closeAllConnections();
  await new Promise((yes) => server.close(yes));
}
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", {
  flag: "wx",
});
console.log(
  JSON.stringify({
    report: reportPath,
    passed: report.passed,
    registry: report.registry?.passes.map(({ files, elapsedMs, final }) => ({
      files,
      elapsedMs,
      final,
    })),
    failure: report.failure,
  }),
);
if (!report.passed) process.exitCode = 1;
