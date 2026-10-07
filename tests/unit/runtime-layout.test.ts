// @vitest-environment node
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const ownedBuild = join(root, "build");
const script = join(root, "scripts/check-runtime-layout.mjs");
let fixture: string;
let dist: string;
let source: string;

function write(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

function check(): string {
  return execFileSync(process.execPath, [script, dist, source], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

beforeEach(() => {
  mkdirSync(ownedBuild, { recursive: true });
  fixture = mkdtempSync(join(ownedBuild, "runtime-layout-"));
  dist = join(fixture, "dist");
  source = join(fixture, "public/vision");
  write(join(dist, "host/index.html"), "Solar host");
  write(join(dist, "solar.js"), "Library API");
  write(join(dist, "server/index.mjs"), "Reception host");
  write(join(source, "pkg/engine.wasm"), "Pinned engine");
  write(join(source, "ui/mainpresenter.mjs"), "Pinned presenter");
  cpSync(source, join(dist, "host/vision"), { recursive: true });
});

afterEach(() => {
  if (!resolve(fixture).startsWith(ownedBuild + sep)) {
    throw new Error("Invalid owned layout test directory");
  }
  rmSync(fixture, { recursive: true, force: true });
});

describe("Solar combined library/host release layout", () => {
  it("accepts one pinned asset copy with library and server outputs", () => {
    expect(check()).toContain("2 Vision assets, one copy each");
  });

  it("rejects an identical library public copy", () => {
    cpSync(source, join(dist, "vision"), { recursive: true });
    expect(check).toThrow(/layout collision: host\/vision and vision/);
  });

  it("rejects other host/root collisions even when their bytes match", () => {
    write(join(dist, "host/assets/entry.js"), "Entry");
    write(join(dist, "assets/entry.js"), "Entry");
    expect(check).toThrow(/layout collision: host\/assets and assets/);
  });

  it("rejects a Vision copy hidden in another output directory", () => {
    cpSync(source, join(dist, "backup/vision"), { recursive: true });
    expect(check).toThrow(/must be emitted once/);
  });

  it("rejects a missing emitted engine", () => {
    rmSync(join(dist, "host/vision/pkg/engine.wasm"));
    expect(check).toThrow(/Vision asset is missing/);
  });

  it("rejects a stale engine despite the correct layout", () => {
    write(join(dist, "host/vision/pkg/engine.wasm"), "Different engine");
    expect(check).toThrow(/differs from its source/);
  });
});
