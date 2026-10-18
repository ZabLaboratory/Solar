/* global window */
// Development qualification: private Vite/Chrome only; never attaches to Prism.
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";
import { createServer as createHttpServer } from "node:http";

const values = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, array) => {
    if (index % 2 === 0) pairs.push([value, array[index + 1]]);
    return pairs;
  }, []),
);
if (!values["--out"] || !values["--playwright-root"])
  throw Error("--out and --playwright-root are required");
const out = resolve(values["--out"]);
await mkdir(out, { recursive: true });
const require = createRequire(
  resolve(values["--playwright-root"], "package.json"),
);
const { chromium } = require("playwright");
const server = await createServer({
  configFile: false,
  cacheDir: resolve(out, "vite-cache"),
  root: resolve(import.meta.dirname, ".."),
  server: { middlewareMode: true, hmr: false },
});
const httpServer = createHttpServer(server.middlewares);
let browser, page;
const errors = [];
try {
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: [
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
    ],
  });
  page = await browser.newPage({ viewport: { width: 1600, height: 800 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(
    `http://127.0.0.1:${address.port}/tests/browser/meet-framing.html`,
  );
  await page.waitForFunction(
    () => typeof window.runQualification === "function",
  );
  const result = await page.evaluate(() =>
    Promise.race([
      window.runQualification(),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Qualification exceeded 45 seconds")),
          45000,
        ),
      ),
    ]),
  );
  const performanceProbe = await page.evaluate(() => {
    try {
      performance.measure("solar:live-media-stage-probe", {
        start: performance.now(),
        detail: { gpuCompletionAvailable: false, gpuCompletionMs: null },
      });
      const entries = performance.getEntriesByName("solar:live-media-stage-probe");
      performance.clearMeasures("solar:live-media-stage-probe");
      return { supported: entries.length === 1, error: null };
    } catch (error) {
      return { supported: false, error: String(error) };
    }
  });
  const metricsReady = await page.waitForFunction(
    () => performance.getEntriesByName("solar:live-media-stage").length > 0,
    undefined,
    { timeout: 5000 },
  ).then(() => true, () => false);
  if (!metricsReady) {
    const diagnostic = await page.evaluate(() => {
      try {
        performance.measure("solar:live-media-stage-probe", {
          start: performance.now(),
          detail: { gpuCompletionAvailable: false, gpuCompletionMs: null },
        });
        const supported =
          performance.getEntriesByName("solar:live-media-stage-probe").length === 1;
        performance.clearMeasures("solar:live-media-stage-probe");
        return {
          metricEntryCount: performance.getEntriesByName("solar:live-media-stage").length,
          measureDetailSupported: supported,
          timeOrigin: performance.timeOrigin,
          now: performance.now(),
        };
      } catch (error) {
        return {
          metricEntryCount: performance.getEntriesByName("solar:live-media-stage").length,
          measureDetailSupported: false,
          error: String(error),
        };
      }
    });
    throw Error(`No bounded live-media Performance entry was published: ${JSON.stringify(diagnostic)}`);
  }
  const stageMetrics = await page.evaluate(() =>
    performance
      .getEntriesByName("solar:live-media-stage")
      .map((entry) => ({ emittedAtMs: entry.startTime, sample: entry.detail })),
  );
  if (stageMetrics.length > 64)
    throw Error(`Live-media metric history exceeded its cap: ${stageMetrics.length}`);
  for (let index = 0; index < stageMetrics.length; index += 1) {
    const { emittedAtMs, sample } = stageMetrics[index];
    if (!Number.isFinite(sample?.windowMs) || sample.windowMs < 1000)
      throw Error("A live-media sample covered less than one second.");
    if (sample?.gpuCompletionAvailable !== false || sample?.gpuCompletionMs !== null)
      throw Error("GPU completion must remain explicitly unavailable.");
    if (index > 0 && emittedAtMs - stageMetrics[index - 1].emittedAtMs < 1000)
      throw Error("Live-media samples were emitted more than once per second.");
  }
  const resultWithMetrics = { ...result, performanceProbe, stageMetrics };
  await page.screenshot({ path: resolve(out, "pixels.png"), fullPage: true });
  await writeFile(
    resolve(out, "result.json"),
    JSON.stringify(
      { ...resultWithMetrics, browser: browser.version(), pageErrors: errors },
      null,
      2,
    ) + "\n",
  );
  if (errors.length) throw Error(JSON.stringify(errors));
  process.stdout.write(
    JSON.stringify({
      passed: result.passed,
      states: result.samples.length,
      uploads: result.uploads,
      metricsEntries: stageMetrics.length,
      gpuCompletionAvailable: false,
      browser: browser.version(),
      out,
    }) + "\n",
  );
} catch (error) {
  const diagnostics = await page
    ?.evaluate(
      () => window.qualificationFailure ?? { phase: window.qualificationPhase },
    )
    .catch(() => null);
  await writeFile(
    resolve(out, "failure.json"),
    JSON.stringify(
      { message: String(error), pageErrors: errors, diagnostics },
      null,
      2,
    ) + "\n",
  );
  throw error;
} finally {
  await browser?.close();
  await server.close();
  await new Promise((resolve) => httpServer.close(resolve));
}
