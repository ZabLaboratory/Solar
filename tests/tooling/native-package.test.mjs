import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import test from "node:test";

const packageScript = resolve(
  import.meta.dirname,
  "../../scripts/package-native-server.mjs",
);
const checkScript = resolve(
  import.meta.dirname,
  "../../scripts/check-native-package.mjs",
);
const revision = "a".repeat(40);
const otherRevision = "b".repeat(40);

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "solar-native-package-"));
  assert.ok(root.startsWith(tmpdir() + sep));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function put(root, relative, bytes) {
  const path = resolve(root, relative);
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, bytes);
  return path;
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function seedPackage(root, options = {}) {
  const bytes = Buffer.from("existing packaged receiver bytes");
  const relative = "dist/native/win32-x64/lsdpd.exe";
  const manifest = {
    schema: options.schema ?? "solar.native-server.v1",
    wire: "LSDP-TCP/2.0-draft2",
    source_revision: revision,
    binaries: {
      "win32-x64": {
        file: "win32-x64/lsdpd.exe",
        sha256: digest(bytes),
      },
    },
  };
  const target = put(root, relative, bytes);
  const manifestPath = put(
    root,
    "dist/native/manifest.json",
    JSON.stringify(manifest, null, 2) + "\n",
  );
  return { bytes, target, manifest, manifestPath };
}

function snapshotPackage(root) {
  const packageRoot = join(root, "dist/native");
  if (!existsSync(packageRoot)) return null;
  const files = {};
  function visit(directory, prefix = "") {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? prefix + "/" + entry.name : entry.name;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path, relative);
      else files[relative] = readFileSync(path).toString("hex");
    }
  }
  visit(packageRoot);
  return Object.fromEntries(
    Object.entries(files).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function packageBinary(
  root,
  binary,
  platform = "win32-x64",
  sourceRevision = revision,
) {
  return spawnSync(
    process.execPath,
    [
      packageScript,
      "--binary",
      binary,
      "--platform",
      platform,
      "--revision",
      sourceRevision,
    ],
    { cwd: root, encoding: "utf8" },
  );
}

function checkPackage(root, ...platforms) {
  return spawnSync(process.execPath, [checkScript, ...platforms], {
    cwd: root,
    encoding: "utf8",
  });
}

test("a different source revision refuses before changing the packaged binary or manifest", () =>
  fixture((root) => {
    const initial = seedPackage(root);
    const incoming = put(
      root,
      "incoming/lsdpd.exe",
      Buffer.from("new receiver"),
    );
    const before = snapshotPackage(root);
    const result = packageBinary(root, incoming, "win32-x64", otherRevision);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /same native source revision/);
    assert.deepEqual(snapshotPackage(root), before);
    assert.deepEqual(readFileSync(initial.target), initial.bytes);
  }));

test("an invalid existing manifest schema refuses before package mutation", () =>
  fixture((root) => {
    seedPackage(root, { schema: "solar.native-server.v2" });
    const incoming = put(
      root,
      "incoming/lsdpd.exe",
      Buffer.from("new receiver"),
    );
    const before = snapshotPackage(root);
    const result = packageBinary(root, incoming);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Invalid existing native package manifest/);
    assert.deepEqual(snapshotPackage(root), before);
  }));

test("invalid arguments refuse without touching an existing package", () =>
  fixture((root) => {
    seedPackage(root);
    const incoming = put(
      root,
      "incoming/lsdpd.exe",
      Buffer.from("new receiver"),
    );
    const before = snapshotPackage(root);
    const result = packageBinary(root, incoming, "win32", revision);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Usage: package-native-server/);
    assert.deepEqual(snapshotPackage(root), before);
  }));

test("a missing source binary refuses before changing the packaged files", () =>
  fixture((root) => {
    seedPackage(root);
    const before = snapshotPackage(root);
    const result = packageBinary(root, join(root, "missing/lsdpd.exe"));

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ENOENT/);
    assert.deepEqual(snapshotPackage(root), before);
  }));

test("matching source revision adds another platform and keeps the package verifiable", () =>
  fixture((root) => {
    const initial = seedPackage(root);
    const linuxBytes = Buffer.from("matching linux receiver");
    const linuxBinary = put(root, "incoming/lsdpd", linuxBytes);
    const result = packageBinary(root, linuxBinary, "linux-x64", revision);

    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(readFileSync(initial.manifestPath, "utf8"));
    assert.equal(manifest.source_revision, revision);
    assert.equal(manifest.binaries["win32-x64"].sha256, digest(initial.bytes));
    assert.equal(manifest.binaries["linux-x64"].sha256, digest(linuxBytes));
    assert.deepEqual(readFileSync(initial.target), initial.bytes);
    assert.deepEqual(
      readFileSync(join(root, "dist/native/linux-x64/lsdpd")),
      linuxBytes,
    );

    const checked = checkPackage(root, "win32-x64", "linux-x64");
    assert.equal(checked.status, 0, checked.stderr);
    assert.match(checked.stdout, /"result":"PASS"/);
  }));
