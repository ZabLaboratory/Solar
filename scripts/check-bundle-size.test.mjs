import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { analyzeBundle } from "./check-bundle-size.mjs";

async function fixture({ broadcastImportsOverlay = false } = {}) {
  const distDir = await mkdtemp(join(tmpdir(), "solar-bundle-check-"));
  await mkdir(join(distDir, "host"));

  const files = {
    "solar.js": 'import "./lumen-core.js";',
    "lumen-core.js": [
      'const broadcast = () => import("./mode-a.js").then((module) => ({ default: module.BroadcastMode }));',
      'const control = () => import("./merged-runtime.js").then((module) => ({ default: module.ControlMode }));',
      'const test = () => import("./merged-runtime.js").then((module) => ({ default: module.TestMode }));',
    ].join("\n"),
    "mode-a.js": [
      broadcastImportsOverlay ? 'import "./merged-runtime.js";' : "",
      "export class BroadcastMode {}",
    ].join("\n"),
    "merged-runtime.js": [
      'import "./operator-ui.js";',
      "export class ControlMode {}",
      "export class TestMode {}",
    ].join("\n"),
    "operator-ui.js": "export const status = true;",
    "host/host.js": "console.log('host');",
  };

  await Promise.all(
    Object.entries(files).map(([name, source]) =>
      writeFile(join(distDir, name), source),
    ),
  );
  return {
    distDir,
    cleanup: () => rm(distDir, { recursive: true, force: true }),
  };
}

test("follows renamed and merged runtime chunks", async () => {
  const { distDir, cleanup } = await fixture();
  try {
    const result = analyzeBundle({ distDir });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(
      result.modeRoots.get("control"),
      new Set(["merged-runtime.js"]),
    );
    assert.deepEqual(
      result.modeRoots.get("test"),
      new Set(["merged-runtime.js"]),
    );
    assert.ok(result.modes.get("broadcast")?.files.includes("mode-a.js"));
    assert.ok(
      !result.modes.get("broadcast")?.files.includes("merged-runtime.js"),
    );
    assert.deepEqual(result.modes.get("control")?.files, [
      "lumen-core.js",
      "merged-runtime.js",
      "operator-ui.js",
      "solar.js",
    ]);
  } finally {
    await cleanup();
  }
});

test("rejects a broadcast chunk that imports a distinct overlay entry", async () => {
  const { distDir, cleanup } = await fixture({ broadcastImportsOverlay: true });
  try {
    const result = analyzeBundle({ distDir });
    assert.ok(
      result.errors.some((error) =>
        error.includes("broadcast bundle imports distinct overlay mode entry"),
      ),
    );
  } finally {
    await cleanup();
  }
});
