import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import ts from "typescript";

const { values } = parseArgs({
  options: {
    baseline: { type: "string" },
    output: { type: "string", default: "test-results/editable-preview-bench" },
  },
});
assert(
  values.baseline,
  "Pass --baseline <git commit/ref> for the unoptimized source.",
);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = "src/internal/editable-preview";
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const baselineRevision = git(
  "rev-parse",
  "--verify",
  `${values.baseline}^{commit}`,
);
const output = resolve(root, values.output);
await mkdir(output, { recursive: true });

// Compile the actual entrypoint and its relative imports, without substituting
// a hand-written optimized implementation for either side of the comparison.
async function bundle(readSource) {
  const modules = new Map();
  const sources = new Map();
  async function visit(id) {
    if (modules.has(id)) return;
    assert.match(id, /^\.\/[a-z-]+$/);
    const source = await readSource(`${sourceDir}/${id.slice(2)}.ts`);
    sources.set(id, source);
    const compiled = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    }).outputText;
    modules.set(id, compiled);
    for (const match of compiled.matchAll(/require\("(\.\/[a-z-]+)"\)/g)) {
      await visit(match[1]);
    }
  }
  await visit("./sideband");
  return {
    hash: sha256(JSON.stringify([...sources].sort())),
    code: `(() => {
      const factories = {${[...modules].map(([id, code]) => `${JSON.stringify(id)}: (module, exports, require) => {${code}\n}`).join(",")}};
      const loaded = new Map();
      const require = (id) => {
        if (!loaded.has(id)) {
          const module = { exports: {} };
          loaded.set(id, module);
          factories[id](module, module.exports, require);
        }
        return loaded.get(id).exports;
      };
      globalThis.installBenchmarkSideband = require("./sideband").installEditablePreviewSideband;
    })();`,
  };
}

const baseline = await bundle((path) =>
  git("show", `${baselineRevision}:${path}`),
);
const candidate = await bundle((path) => readFile(resolve(root, path), "utf8"));
const browser = await chromium.launch({
  headless: true,
  channel:
    process.env.SOLAR_E2E_BROWSER === "system-chrome" ? "chrome" : undefined,
});
const scenarios = [
  { wrappers: 100, patches: 4 },
  { wrappers: 500, patches: 4 },
  { wrappers: 1000, patches: 1 },
  { wrappers: 1000, patches: 4 },
  { wrappers: 1000, patches: 8 },
  { wrappers: 1000, patches: 4, replaceEvery: 15 },
];
const report = {
  baselineRevision,
  candidateHead: git("rev-parse", "HEAD"),
  sourceHashes: { baseline: baseline.hash, candidate: candidate.hash },
  browser: browser.version(),
  frames: 75,
  samples: 7,
  method:
    "Synthetic DOM with decoded images and SVG. Real sideband/MutationObserver; controlled RAF and WebSocket. CPU timings include microtasks, exclude layout/paint and network.",
  results: [],
};

async function measure(page, scenario) {
  return page.evaluate(
    async ({ scenario, frames }) => {
      const { document, performance, EventTarget, MessageEvent, TextEncoder } =
        globalThis;
      const image = (colour) =>
        `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="${colour}"/><circle cx="12" cy="12" r="7" fill="#fff"/></svg>`)}`;
      const scene = document.getElementById("scene");
      scene.innerHTML = Array.from(
        { length: scenario.wrappers },
        (_, i) =>
          `<div class="tile" data-lumencast-bind-animate="component-${i}"><div><span>Item ${i}</span><svg width="24" height="24"><rect width="24" height="24" fill="#456"/></svg><img src="${image("#e86")}"/></div></div>`,
      ).join("");
      await Promise.all(
        [...scene.querySelectorAll("img")].map((img) => img.decode()),
      );
      await document.fonts.ready;
      const definitions = [
        ["opacity", 0.5],
        ["width", 64],
        ["fontSize", 12],
        ["fill", "#ff0066"],
        ["translate", [4, 2]],
        ["value", "Updated"],
        ["src", image("#26a")],
        ["background", "#804"],
      ];
      const indices = Array.from({ length: scenario.patches }, (_, i) =>
        Math.floor(((i + 1) * scenario.wrappers) / (scenario.patches + 1)),
      );
      const patches = indices.map((index, i) => ({
        path: `__editable.${Array.from(new TextEncoder().encode(`component-${index}`), (byte) => byte.toString(16).padStart(2, "0")).join("")}.${definitions[i][0]}`,
        value: definitions[i][1],
      }));

      let id = 0;
      let bindingQueries = 0;
      const callbacks = new Map();
      const nativeRAF = globalThis.requestAnimationFrame;
      const nativeCancelRAF = globalThis.cancelAnimationFrame;
      const nativeQueryAll = document.querySelectorAll;
      globalThis.requestAnimationFrame = (callback) => {
        callbacks.set(++id, callback);
        return id;
      };
      globalThis.cancelAnimationFrame = (key) => callbacks.delete(key);
      document.querySelectorAll = function (selector) {
        if (selector === "[data-lumencast-bind-animate]") bindingQueries++;
        return nativeQueryAll.call(this, selector);
      };
      const sockets = [];
      class Socket extends EventTarget {
        constructor() {
          super();
          sockets.push(this);
        }
        close() {
          this.closed = true;
        }
      }
      const stop = globalThis.installBenchmarkSideband(
        "ws://127.0.0.1/benchmark",
        document,
        Socket,
      );
      try {
        const initialStart = performance.now();
        sockets[0].dispatchEvent(
          new MessageEvent("message", {
            data: JSON.stringify({ type: "accepted_patch", patches }),
          }),
        );
        await Promise.resolve();
        const initialMs = performance.now() - initialStart;
        let frameMs = 0;
        for (let frame = 0; frame < frames; frame++) {
          // Runtime writes are deliberately restored on every frame. A cache
          // must still reapply accepted state instead of merely doing no work.
          const opacityNode = scene.children[indices[0]];
          opacityNode.style.opacity = "1";
          if (
            scenario.replaceEvery &&
            frame > 0 &&
            frame % scenario.replaceEvery === 0
          ) {
            const index = indices[1];
            const replacement = scene.children[index].cloneNode(true);
            replacement.style.width = "1px";
            for (const element of replacement.querySelectorAll(
              "div,svg,img,video,canvas",
            )) {
              element.style.width = "1px";
            }
            scene.children[index].replaceWith(replacement);
          }
          if (callbacks.size !== 1)
            throw new Error("Convergence lease expired during benchmark");
          const start = performance.now();
          const pending = [...callbacks.values()];
          callbacks.clear();
          for (const callback of pending) callback(start);
          await Promise.resolve();
          frameMs += performance.now() - start;
          if (opacityNode.style.opacity !== "0.5")
            throw new Error("Accepted opacity was not restored");
        }
        await Promise.all(
          [...scene.querySelectorAll("img")].map((img) => img.decode()),
        );
        return {
          initialMs,
          frameMs,
          totalMs: initialMs + frameMs,
          bindingQueries,
          html: scene.innerHTML,
        };
      } finally {
        stop();
        globalThis.requestAnimationFrame = nativeRAF;
        globalThis.cancelAnimationFrame = nativeCancelRAF;
        document.querySelectorAll = nativeQueryAll;
      }
    },
    { scenario, frames: report.frames },
  );
}

try {
  const pages = {};
  for (const [name, source] of Object.entries({ baseline, candidate })) {
    const page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<style>body{margin:0;background:#16212b;color:#fff;font:10px Arial}#scene{display:grid;grid-template-columns:repeat(40,48px)}.tile{height:40px;overflow:hidden}span{display:block;font-size:8px}svg,img{width:16px;height:16px}</style><main id="scene"></main>`,
    );
    await page.addScriptTag({ content: source.code });
    pages[name] = page;
  }
  for (const scenario of scenarios) {
    const samples = { baseline: [], candidate: [] };
    // One warm-up, then alternate order to reduce fixed-order/JIT bias.
    for (const page of Object.values(pages)) await measure(page, scenario);
    for (let round = 0; round < report.samples; round++) {
      for (const name of round % 2
        ? ["candidate", "baseline"]
        : ["baseline", "candidate"]) {
        samples[name].push(await measure(pages[name], scenario));
      }
    }
    const last = Object.fromEntries(
      Object.entries(samples).map(([key, entries]) => [key, entries.at(-1)]),
    );
    assert.equal(
      last.candidate.html,
      last.baseline.html,
      "DOM differs between baseline and candidate",
    );
    const name = `${scenario.wrappers}-${scenario.patches}-${scenario.replaceEvery ?? 0}`;
    const screenshots = {};
    for (const key of ["baseline", "candidate"]) {
      screenshots[key] = await pages[key].screenshot({
        path: resolve(output, `${name}-${key}.png`),
      });
    }
    assert(
      screenshots.baseline.equals(screenshots.candidate),
      `PNG differs for ${name}`,
    );
    const stats = (entries) => {
      const median = (key) =>
        entries.map((entry) => entry[key]).sort((a, b) => a - b)[
          Math.floor(entries.length / 2)
        ];
      return {
        initialMs: median("initialMs"),
        frameMs: median("frameMs"),
        totalMs: median("totalMs"),
        msPerFrame: median("frameMs") / report.frames,
        bindingQueries: entries.map((entry) => entry.bindingQueries),
        totalMsSamples: entries.map((entry) => entry.totalMs),
      };
    };
    const expectedQueries =
      1 +
      (scenario.replaceEvery
        ? Math.floor((report.frames - 1) / scenario.replaceEvery)
        : 0);
    assert(
      samples.candidate.every(
        (entry) => entry.bindingQueries === expectedQueries,
      ),
      "Unexpected repeated binding scan",
    );
    const result = {
      ...scenario,
      baseline: stats(samples.baseline),
      candidate: stats(samples.candidate),
      identicalDom: true,
      identicalPng: true,
      pngSHA256: sha256(screenshots.candidate),
    };
    result.cpuReductionPercent =
      100 * (1 - result.candidate.totalMs / result.baseline.totalMs);
    report.results.push(result);
    console.log(JSON.stringify(result));
  }
  await writeFile(
    resolve(output, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(`Report: ${resolve(output, "report.json")}`);
} finally {
  await browser.close();
}
