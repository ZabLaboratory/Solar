import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const [runtimeArchive, protocolArchive] = process.argv.slice(2);
if (!runtimeArchive || !protocolArchive)
  throw new Error(
    "Usage: test-peer-install <lock-pinned-runtime.tgz> <lock-pinned-protocol.tgz>",
  );
const base = resolve(root, "build");
await mkdir(base, { recursive: true });
const isolated = await mkdtemp(join(base, "peer-install-"));
if (!isolated.startsWith(base + sep))
  throw new Error("Invalid owned test directory");
const digest = (bytes, algorithm = "sha256") =>
  createHash(algorithm)
    .update(bytes)
    .digest(algorithm === "sha512" ? "base64" : "hex");
async function inventory(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const output = {};
  for (const entry of entries) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) {
      for (const [name, hash] of Object.entries(await inventory(file)))
        output[`${entry.name}/${name}`] = hash;
    } else output[entry.name] = digest(await readFile(file));
  }
  return output;
}
try {
  const lock = JSON.parse(
    await readFile(join(root, "package-lock.json"), "utf8"),
  );
  for (const [name, archive] of [
    ["runtime", runtimeArchive],
    ["protocol", protocolArchive],
  ]) {
    const bytes = await readFile(resolve(archive));
    assert.equal(
      `sha512-${digest(bytes, "sha512")}`,
      lock.packages[`node_modules/@lumencast/${name}`].integrity,
    );
    const destination = join(isolated, "node_modules/@lumencast", name);
    await mkdir(destination, { recursive: true });
    await exec("tar", [
      "-xzf",
      resolve(archive),
      "--strip-components=1",
      "-C",
      destination,
    ]);
  }
  const runtime = join(isolated, "node_modules/@lumencast/runtime");
  const protocol = join(isolated, "node_modules/@lumencast/protocol");
  const before = await inventory(runtime),
    protocolBefore = await inventory(protocol);
  const solar = join(isolated, "node_modules/@zablab/solar");
  await mkdir(join(solar, "scripts"), { recursive: true });
  await cp(
    join(root, "scripts/patch-peer-viewer.mjs"),
    join(solar, "scripts/patch-peer-viewer.mjs"),
  );
  await cp(
    join(root, "scripts/peer-viewer"),
    join(solar, "scripts/peer-viewer"),
    { recursive: true },
  );
  const entry = join(solar, "scripts/patch-peer-viewer.mjs");
  await exec(process.execPath, [entry]);
  const first = await inventory(runtime);
  const changed = Object.keys(first)
    .filter((file) => first[file] !== before[file])
    .sort();
  assert.deepEqual(changed, [
    "dist/webrtc/index.js",
    "dist/webrtc/meet-viewer.js",
    "dist/webrtc/peer-stream-registry.js",
  ]);
  assert.deepEqual(await inventory(protocol), protocolBefore);
  await exec(process.execPath, [entry]);
  assert.deepEqual(await inventory(runtime), first);
  console.log(
    JSON.stringify({
      result: "PASS",
      freshHoistedInstall: true,
      lockfileIntegrity: true,
      onlyConsumedViewerPatched: changed,
      protocolUnchanged: true,
      idempotent: true,
    }),
  );
} finally {
  await rm(isolated, { recursive: true, force: true });
}
