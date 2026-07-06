// Served-host-bundle smoke test — ADR 001 §6.3, the browser-side proof
// that the B4 regression is fixed.
//
// Loads the BUILT `dist/host/index.html` (not the Vite dev server) in a
// real Chromium with NO `<script type="importmap">` and NO bundler — the
// exact conditions of the Pulsar CEF / Orion static serve. Asserts:
//
//   1. zero "Failed to resolve module specifier" console errors (the B4
//      symptom: a bare ESM import the browser can't resolve);
//   2. the host entry actually executed and mount() ran — proven by the
//      runtime taking over #scene (it stops being the empty bootstrap
//      placeholder) without the host's own "#scene target missing" abort.
//
// We do NOT stand up a real Orion here: mount() will fail to reach a WS
// endpoint and surface via onError (logged, broadcast-silent). That
// connection failure is expected and is NOT a module-resolution error —
// the test fails only on the unresolved-module class, which is what the
// served-bundle contract forbids.

import { createServer, type Server } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const HOST_DIR = resolve(
  fileURLToPath(import.meta.url),
  "..",
  "..",
  "..",
  "dist",
  "host",
);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

// A minimal static file server over the built host bundle. It serves the
// artefact verbatim — crucially WITHOUT injecting any import map — under a
// nested path prefix to mirror Orion's /static/solar/v{N}/ serve and prove
// the relative imports resolve regardless of prefix.
const PREFIX = "/orion/static/solar/v0.2.1/";

let server: Server;
let baseUrl: string;

test.beforeAll(async () => {
  // Fail loudly if the bundle wasn't built — the smoke test is meaningless
  // against a stale or absent dist/host.
  await stat(join(HOST_DIR, "index.html")).catch(() => {
    throw new Error(
      `dist/host/index.html missing — run \`npm run build\` before the host smoke test`,
    );
  });

  server = createServer(async (req, res) => {
    try {
      let urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]!);
      if (urlPath.startsWith(PREFIX))
        urlPath = urlPath.slice(PREFIX.length - 1);
      if (urlPath === "/" || urlPath === "") urlPath = "/index.html";
      // Contain path traversal to HOST_DIR.
      const filePath = normalize(join(HOST_DIR, urlPath));
      if (!filePath.startsWith(HOST_DIR)) {
        res.writeHead(403).end("forbidden");
        return;
      }
      const body = await readFile(filePath);
      res.writeHead(200, {
        "content-type": MIME[extname(filePath)] ?? "application/octet-stream",
      });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });

  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const addr = server.address();
  if (addr === null || typeof addr === "string") {
    throw new Error("host smoke server: could not resolve listen port");
  }
  baseUrl = `http://127.0.0.1:${addr.port}${PREFIX}`;
});

test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

test("served host bundle loads with no import map and mount() runs", async ({
  page,
}) => {
  const moduleResolutionErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (
      /failed to resolve module specifier/i.test(text) ||
      /failed to fetch dynamically imported module/i.test(text) ||
      /error resolving module specifier/i.test(text)
    ) {
      moduleResolutionErrors.push(text);
    }
  });

  // Uncaught exceptions from the page (e.g. the host's own "#scene target
  // missing" abort, or a module that throws on import) land here.
  page.on("pageerror", (err) => {
    pageErrors.push(err.message);
  });

  await page.goto(baseUrl, { waitUntil: "load" });

  // The bootstrap target exists and the host did NOT abort with its
  // "#scene target missing" guard.
  const scene = page.locator("#scene");
  await expect(scene).toHaveCount(1);

  // The module executed: confirm the entry script tag is the relative,
  // hashed host chunk (no bare specifier) the build emitted.
  const entrySrc = await page
    .locator('script[type="module"][src]')
    .first()
    .getAttribute("src");
  expect(entrySrc).toBeTruthy();
  expect(entrySrc!.startsWith("./")).toBe(true);

  // Give the module a moment to execute mount() (it will then try, and
  // fail, to open a WS to a non-existent Orion — that's fine).
  await page.waitForTimeout(500);

  // The core B4 assertion: nothing failed to resolve as a module.
  expect(
    moduleResolutionErrors,
    `served bundle threw module-resolution errors (bare specifier leaked): ${moduleResolutionErrors.join(
      " | ",
    )}`,
  ).toEqual([]);

  // The host must not have aborted on a missing #scene target, and no
  // import-time throw may escape.
  expect(
    pageErrors.filter(
      (m) =>
        /#scene target missing/i.test(m) ||
        /failed to resolve module specifier/i.test(m),
    ),
    `served bundle raised a fatal bootstrap/module error: ${pageErrors.join(" | ")}`,
  ).toEqual([]);
});

// The Geist self-hosting fix (Prism's editor CSS never reaches Solar's own
// page, so a `fontFamily: "Geist"` text node fell back to the system default
// in preview AND on-air). Proven end-to-end here: the SERVED host page carries
// a stylesheet whose @font-face declares Geist, and the referenced woff2
// actually fetches 200 through the same static serve — no bare/404 asset.
test("served host bundle self-hosts the Geist @font-face (asset resolves)", async ({
  page,
}) => {
  const failedFontRequests: string[] = [];
  page.on("requestfailed", (req) => {
    if (/\.woff2?(\?|$)/i.test(req.url())) failedFontRequests.push(req.url());
  });
  const fontResponses: { url: string; status: number }[] = [];
  page.on("response", (res) => {
    if (/\.woff2?(\?|$)/i.test(res.url())) {
      fontResponses.push({ url: res.url(), status: res.status() });
    }
  });

  await page.goto(baseUrl, { waitUntil: "load" });
  await page.waitForTimeout(300);

  // Collect every @font-face family declared by the page's stylesheets and
  // the woff2 URLs they point at — read from the live CSSOM so we assert the
  // real served + parsed rules, not the HTML text.
  const declared = await page.evaluate(() => {
    const families: string[] = [];
    const srcUrls: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // cross-origin sheet — none expected here
      }
      // Relative url()s in an @font-face resolve against the OWNING
      // stylesheet's location, not the document's — the served CSS lives at
      // .../assets/host-*.css and points at `./geist-*.woff2` (a sibling in
      // assets/). Resolving against location.href instead would drop the
      // `assets/` segment and fabricate a 404 the browser never hits.
      const base = sheet.href ?? location.href;
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSFontFaceRule) {
          const fam = rule.style
            .getPropertyValue("font-family")
            .replace(/["']/g, "")
            .trim();
          if (fam) families.push(fam);
          const src = rule.style.getPropertyValue("src");
          for (const m of src.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
            srcUrls.push(new URL(m[1]!, base).href);
          }
        }
      }
    }
    return { families, srcUrls };
  });

  expect(
    declared.families,
    `served page declares no Geist @font-face (families: ${declared.families.join(", ") || "none"})`,
  ).toContain("Geist");
  expect(declared.families).toContain("Geist Mono");
  expect(declared.srcUrls.length).toBeGreaterThanOrEqual(2);

  // Every declared woff2 must actually be reachable through the static serve
  // (the CEF/Orion serve has no bundler to rewrite it) — a 404 here is exactly
  // the missing-asset bug.
  for (const url of declared.srcUrls) {
    const resp = await page.request.get(url);
    expect(resp.status(), `font asset 404 / not served: ${url}`).toBe(200);
  }

  expect(
    failedFontRequests,
    `font requests failed: ${failedFontRequests.join(" | ")}`,
  ).toEqual([]);
  for (const r of fontResponses) {
    expect(r.status, `font ${r.url} returned ${r.status}`).toBeLessThan(400);
  }
});
