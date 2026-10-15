/* global window */
// Private browser qualification only; no Prism, shared runtime or live source is attached.
import { createRequire } from "node:module";
import { mkdir, unlink, writeFile } from "node:fs/promises";
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
for (const name of ["result.json", "failure.json", "pixels.png"]) {
  try {
    await unlink(resolve(out, name));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const require = createRequire(
  resolve(values["--playwright-root"], "package.json"),
);
const { chromium } = require("playwright");
const contextOnly = values["--context-only"] === "true";
const server = await createServer({
  configFile: false,
  cacheDir: resolve(import.meta.dirname, "../.cache/qualify-instance-runtime"),
  root: resolve(import.meta.dirname, ".."),
  server: { middlewareMode: true, hmr: false },
});
const httpServer = createHttpServer(server.middlewares);
const imageFixtures = new Map();
const imageRequests = [];
const imageServer = createHttpServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }
  const name = new URL(request.url ?? "/", "http://127.0.0.1").pathname.slice(1);
  if (request.method === "PUT") {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    imageFixtures.set(name, new Uint8Array(Buffer.concat(chunks)));
    response.writeHead(204).end();
    return;
  }
  if (request.method === "GET") {
    const bytes = imageFixtures.get(name);
    imageRequests.push({ name, status: bytes ? 200 : 404 });
    if (!bytes) {
      response.writeHead(404, { "Cache-Control": "no-store" }).end();
      return;
    }
    response
      .writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": bytes.byteLength,
        "Content-Type": "image/png",
      })
      .end(bytes);
    return;
  }
  response.writeHead(405).end();
});
let browser, page;
const pageErrors = [];
try {
  await new Promise((resolveListen) =>
    httpServer.listen(0, "127.0.0.1", resolveListen),
  );
  const address = httpServer.address();
  await new Promise((resolveListen) =>
    imageServer.listen(0, "127.0.0.1", resolveListen),
  );
  const imageAddress = imageServer.address();
  browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: [
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
    ],
  });
  page = await browser.newPage({ viewport: { width: 1100, height: 500 } });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(
    `http://127.0.0.1:${address.port}/tests/browser/instance-runtime.html${contextOnly ? "?context-only=1" : ""}`,
  );
  await page.waitForFunction(
    () => typeof window.runQualification === "function",
  );
  await page.evaluate((origin) => {
    window.__INSTANCE_IMAGE_ORIGIN__ = origin;
  }, `http://127.0.0.1:${imageAddress.port}`);
  const result = await page.evaluate(() =>
    Promise.race([
      window.runQualification(),
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error("Instance runtime qualification exceeded 120 seconds"),
            ),
          120000,
        ),
      ),
    ]),
  );
  await page.screenshot({ path: resolve(out, "pixels.png"), fullPage: true });
  result.remoteImageRequests = imageRequests;
  await writeFile(
    resolve(out, "result.json"),
    JSON.stringify(
      {
        ...result,
        browser: browser.version(),
        node: process.version,
        pageErrors,
      },
      null,
      2,
    ) + "\n",
  );
  if (pageErrors.length) throw Error(JSON.stringify(pageErrors));
  process.stdout.write(
    JSON.stringify({
      passed: result.passed,
      samples: result.samples.length,
      browser: browser.version(),
      out,
    }) + "\n",
  );
} catch (error) {
  const diagnostics = await page
    ?.evaluate(
      () =>
        window.qualificationFailure ?? {
          phase: window.qualificationPhase,
          context: window.contextDiagnostics ?? null,
        },
    )
    .catch(() => null);
  await writeFile(
    resolve(out, "failure.json"),
    JSON.stringify(
      { message: String(error), pageErrors, diagnostics },
      null,
      2,
    ) + "\n",
  );
  throw error;
} finally {
  await browser?.close();
  await server.close();
  await new Promise((resolveClose) => httpServer.close(resolveClose));
  if (imageServer.listening)
    await new Promise((resolveClose) => imageServer.close(resolveClose));
}
