// Private real presenter qualification. Never attaches to the shared Prism app.
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createServer as createHttpServer } from "node:http";
import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "vite";

const { values } = parseArgs({
  options: {
    "out-prefix": { type: "string" },
    "playwright-root": { type: "string" },
    "baseline-ref": { type: "string" },
  },
});
if (!values["out-prefix"] || !values["playwright-root"])
  throw Error("--out-prefix and --playwright-root are required");
const prefix = resolve(values["out-prefix"]);
await mkdir(dirname(prefix), { recursive: true });
const require = createRequire(
  resolve(values["playwright-root"], "package.json"),
);
const { chromium } = require("playwright");
const baselineRef = values["baseline-ref"];
if (baselineRef && !/^[a-f0-9]{40}$/.test(baselineRef))
  throw Error("--baseline-ref must be an exact Git commit SHA");
const baselinePresenter = baselineRef
  ? execFileSync(
      "git",
      ["show", `${baselineRef}:src/engine/vision-presenter.ts`],
      {
        cwd: resolve(import.meta.dirname, ".."),
        encoding: "utf8",
      },
    )
  : null;
const vite = await createServer({
  configFile: false,
  root: resolve(import.meta.dirname, ".."),
  cacheDir: resolve(import.meta.dirname, "../.cache/qualify-native-media"),
  server: { middlewareMode: true, hmr: false },
  plugins: baselinePresenter
    ? [
        {
          name: "native-media-old-presenter-negative-control",
          enforce: "pre",
          transform(_source, id) {
            if (
              id
                .replaceAll("\\", "/")
                .endsWith("/src/engine/vision-presenter.ts")
            )
              return { code: baselinePresenter, map: null };
          },
        },
      ]
    : [],
});
const server = createHttpServer(vite.middlewares);
let browser;
const pageErrors = [];
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: [
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
    ],
  });
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(
    `http://127.0.0.1:${server.address().port}/tests/browser/native-media-ownership.html`,
  );
  await page
    .locator('#result[data-status="passed"], #result[data-status="failed"]')
    .waitFor({ timeout: 60000 });
  const report = JSON.parse(await page.locator("#result").textContent());
  const expectedNegativeControl = Boolean(
    baselineRef &&
    !report.passed &&
    report.captures > 0 &&
    report.error?.includes("native capture escaped"),
  );
  await writeFile(
    `${prefix}-result.json`,
    JSON.stringify(
      {
        ...report,
        browser: browser.version(),
        pageErrors,
        baselineRef,
        baselinePresenterSha256: baselinePresenter
          ? createHash("sha256").update(baselinePresenter).digest("hex")
          : null,
        expectedNegativeControl,
      },
      null,
      2,
    ) + "\n",
  );
  if (
    pageErrors.length ||
    (baselineRef ? !expectedNegativeControl : !report.passed)
  )
    throw Error(JSON.stringify({ error: report.error, pageErrors }));
  process.stdout.write(
    JSON.stringify({
      passed: report.passed,
      expectedNegativeControl,
      captures: report.captures,
      subscriptions: report.subscriptions,
      retirements: report.retirements,
      phases: report.samples.map((sample) => sample.phase),
      prefix,
    }) + "\n",
  );
} finally {
  await browser?.close();
  await vite.close();
  await new Promise((resolve) => server.close(resolve));
}
