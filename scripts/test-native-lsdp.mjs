import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { randomBytes } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import { bundleAddress } from "@lumencast/canonical";
import jsonPatch from "fast-json-patch";
import {
  startNative,
  readNative,
  withNative,
  nativeTreeHash,
} from "./native-lsdp-tools.mjs";
import { BrowserLSDP } from "../vendor/lsdp-native-browser/src/browser.js";

const { values } = parseArgs({
  options: { "lsdp-bin": { type: "string" }, scene: { type: "string" } },
});
const binary = values["lsdp-bin"] ?? process.env.LUMENCAST_LSDP_BIN;
if (!binary)
  throw new Error(
    "test:native requires --lsdp-bin <lsdpd.exe> or LUMENCAST_LSDP_BIN.",
  );
let seed = {
  lsml: "1.1",
  scene_id: "native-interop",
  scene_version: `sha256:${"0".repeat(64)}`,
  layout: { type: "frame", children: [] },
  defaults: { title: "before", "escaped/key~": [1, 2] },
};
if (values.scene)
  seed = JSON.parse(
    strFromU8(unzipSync(await readFile(values.scene))["scene.lsml"]),
  );
else seed.scene_version = await bundleAddress(seed);
const sourceBefore = values.scene ? await readFile(values.scene) : null;
const native = await startNative(binary, seed, "http://127.0.0.1:8099");
let reader, writer;
try {
  writer = new BrowserLSDP(native.url);
  reader = new BrowserLSDP(native.url);
  await Promise.all([writer.ready, reader.ready]);
  let baseline = await readNative(reader);
  assert.deepEqual(baseline.state, seed);
  let received;
  reader.options.onTransaction = async (event) => {
    assert.equal(event.kind, "applied_change");
    assert.equal(event.mutation.beforeHash, baseline.stateHash);
    const next = jsonPatch.applyPatch(
      structuredClone(baseline.state),
      event.mutation.operations,
      true,
    ).newDocument;
    baseline = { state: next, stateHash: nativeTreeHash(next) };
    received?.(event);
    return { level: "applied", transactionId: event.mutation.id };
  };
  await reader.transaction({
    kind: "subscribe",
    target: "scene",
    stateHash: baseline.stateHash,
  });
  const originalVersion = seed.scene_version;
  const mutations = [
    [{ op: "add", path: "/defaults/native-proof", value: "native → Vision" }],
    [
      {
        op: "add",
        path: "/layout/native-proof",
        value: { items: [1, 2], "a/b~": true },
      },
    ],
    [
      { op: "test", path: "/layout/native-proof/a~1b~0", value: true },
      { op: "add", path: "/layout/native-proof/items/1", value: 3 },
      { op: "remove", path: "/layout/native-proof/items/0" },
    ],
    [
      {
        op: "replace",
        path: "/defaults/native-proof",
        value: "fragmented " + "é".repeat(70_000),
      },
    ],
    [
      { op: "remove", path: "/defaults/native-proof" },
      { op: "remove", path: "/layout/native-proof" },
    ],
  ];
  for (const operations of mutations) {
    const id = randomBytes(16).toString("hex");
    let timeout;
    const observed = new Promise((resolve, reject) => {
      received = resolve;
      timeout = setTimeout(
        () => reject(new Error("Native subscription notification missing.")),
        10_000,
      );
    });
    const mutation = {
      format: "lsdp.apply/1",
      id,
      target: "scene",
      beforeHash: baseline.stateHash,
      operations,
      require: "applied",
    };
    try {
      const [receipt, event] = await Promise.all([
        writer.transaction(mutation),
        observed,
      ]);
      assert.deepEqual(receipt, {
        transactionId: id,
        target: "scene",
        level: "applied",
      });
      assert.equal(event.mutation.id, id);
      assert.deepEqual(await writer.transaction(mutation), receipt); // idempotency
    } finally {
      clearTimeout(timeout);
    }
  }
  assert.deepEqual(baseline.state, seed);
  // Server and browser agree on the normative state hash, even on the real scene.
  const serverState = await readNative(writer);
  assert.equal(serverState.stateHash, baseline.stateHash);
  assert.equal(serverState.state.scene_version, originalVersion);
  const invalid = {
    format: "lsdp.apply/1",
    id: randomBytes(16).toString("hex"),
    target: "scene",
    beforeHash: baseline.stateHash,
    operations: [
      { op: "add", path: "/defaults/native-proof", value: 1 },
      { op: "test", path: "/defaults/native-proof", value: 2 },
    ],
    require: "applied",
  };
  await assert.rejects(writer.transaction(invalid));
  assert.deepEqual((await readNative(writer)).state, seed);
  const stale = {
    ...invalid,
    id: randomBytes(16).toString("hex"),
    beforeHash: `tree-sha256:${"0".repeat(64)}`,
    operations: [{ op: "add", path: "/defaults/native-proof", value: 1 }],
  };
  await assert.rejects(writer.transaction(stale));
  const stats = await writer.transaction({ kind: "stats" });
  assert.equal(stats.commits, mutations.length);
  if (sourceBefore)
    assert.deepEqual(await readFile(values.scene), sourceBefore);
  await reader.transaction({ kind: "unsubscribe", target: "scene" });
  reader.close();
  writer.close();
  await native.stop();
  const reset = await startNative(binary, seed, "http://127.0.0.1:8099");
  try {
    await withNative(reset.url, async (peer) => {
      assert.deepEqual((await readNative(peer)).state, seed);
      assert.equal((await peer.transaction({ kind: "stats" })).commits, 0);
    });
  } finally {
    await reset.stop();
  }
  console.log(
    JSON.stringify({
      result: "PASS",
      nativeBinary: binary,
      realScene: !!values.scene,
      mutations: mutations.length,
      fragmentedPayload: true,
      rejectedBatchAtomicity: true,
      staleBaseRejected: true,
      duplicateIdempotency: true,
      unchangedSource: true,
      restartResetsState: true,
      persistence: "memory-only",
    }),
  );
} finally {
  reader?.close();
  writer?.close();
  await native.stop();
}
