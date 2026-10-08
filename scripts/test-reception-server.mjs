import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { unzipSync, strFromU8 } from "fflate";
import {
  SolarReceptionServer,
  packagedNativeBinary,
} from "../dist/server/index.mjs";
import { BrowserLSDP } from "../vendor/lsdp-native-browser/src/browser.js";
import { readNative } from "./native-lsdp-tools.mjs";

const archivePath = process.argv[2];
if (!archivePath)
  throw new Error("Usage: test-reception-server <real-scene.lsmlz>");
const originalArchive = await readFile(archivePath);
const original = JSON.parse(
  strFromU8(unzipSync(originalArchive)["scene.lsml"]),
);
const options = {
  origins: ["http://127.0.0.1:8099"],
  packageRoot: resolve("dist"),
  probeIntervalMs: 0,
  resources: {
    "solar/program": { type: "solar.lsml/1", initial: original },
    "solar/preview": { type: "solar.lsml/1", initial: null },
    "solar/generations": { type: "orion.state/1", initial: {} },
    "solar/sessions": { type: "orion.state/1", initial: {} },
    "orion/state": { type: "orion.state/1", initial: { revision: 0 } },
  },
};
await packagedNativeBinary(options.packageRoot);
let failed;
const server = new SolarReceptionServer({
  ...options,
  recoveryAttempts: 0,
  onFailure: (error) => {
    failed?.(error);
  },
});
let subscriber;
try {
  const [first, concurrent] = await Promise.all([
    server.start(),
    server.start(),
  ]);
  assert.equal(first.pid, concurrent.pid);
  await server.check();
  if (process.argv[3]) {
    const result = await promisify(execFile)(
      "go",
      [
        "test",
        "-v",
        "-count=1",
        "-run",
        "TestRealSharedNative|TestRealNativeProducers|TestRealNativeBlueStructuralMutation|TestRealNativeTransportRecovery",
        "./internal/lsdpreception",
      ],
      {
        cwd: resolve(process.argv[3]),
        env: {
          ...process.env,
          ORION_TEST_LSDP_NATIVE_ADDRESS: first.address,
          ORION_TEST_LSML_PATH: resolve(archivePath).replace(
            /\.lsmlz$/,
            ".lsml",
          ),
        },
      },
    );
    console.log(result.stdout.trim());
    for (const [target, resource] of Object.entries(options.resources))
      await server.replace(target, resource.initial);
  }
  assert.deepEqual((await server.read("solar/program")).state, original);
  subscriber = new BrowserLSDP(first.websocketUrl);
  await subscriber.ready;
  const baseline = await readNative(subscriber, "solar/program");
  let observed;
  subscriber.options.onTransaction = async (event) => {
    observed?.(event);
    return { level: "applied" };
  };
  await subscriber.transaction({
    kind: "subscribe",
    target: "solar/program",
    stateHash: baseline.stateHash,
  });
  let timer;
  const eventPromise = new Promise((yes, no) => {
    observed = yes;
    timer = setTimeout(() => no(new Error("Missing native diff event")), 5000);
  });
  const desired = structuredClone(original);
  desired.defaults ??= {};
  desired.defaults["__lit.text.text_msxz43eh_1"] = "Full LSML, native diff";
  const id = randomBytes(16).toString("hex");
  const receipt = await server.replace("solar/program", desired, id);
  const event = await eventPromise.finally(() => clearTimeout(timer));
  assert.equal(receipt.status, "completed");
  assert.deepEqual(event.mutation.operations, [
    {
      op: Object.hasOwn(original.defaults ?? {}, "__lit.text.text_msxz43eh_1")
        ? "replace"
        : "add",
      path: "/defaults/__lit.text.text_msxz43eh_1",
      value: "Full LSML, native diff",
    },
  ]);
  assert.deepEqual(await server.replace("solar/program", desired, id), receipt);
  await assert.rejects(
    server.replace("solar/program", original, id),
    /ID_REUSED/,
  );
  assert.deepEqual((await server.read("solar/program")).state, desired);
  assert.deepEqual((await server.read("orion/state")).state, { revision: 0 });
  assert.equal((await server.read("solar/preview")).state, null);
  await server.replace("orion/state", { revision: 1, runtime: "Orion" });
  assert.deepEqual((await server.read("solar/program")).state, desired);
  await server.apply("orion/state", [
    { op: "replace", path: "/revision", value: 2 },
  ]);
  assert.deepEqual((await server.read("orion/state")).state, {
    revision: 2,
    runtime: "Orion",
  });
  await assert.rejects(
    server.apply(
      "orion/state",
      [{ op: "replace", path: "/revision", value: 3 }],
      { beforeHash: baseline.stateHash },
    ),
    /BASE_MISMATCH/,
  );
  await assert.rejects(
    server.apply("orion/state", [
      { op: "replace", path: "/revision", value: 3 },
      { op: "test", path: "/runtime", value: "bad" },
    ]),
    /TEST_FAILED/,
  );
  assert.deepEqual((await server.read("orion/state")).state, {
    revision: 2,
    runtime: "Orion",
  });
  await server.replace("solar/preview", original);
  assert.deepEqual((await server.read("solar/preview")).state, original);
  // Actual native watch used by Prism's overlay reconciler: fragmented seed,
  // routed full-state diff, applied leaf mutation and explicit unsubscribe.
  const watched = [];
  let watchFailure;
  const stopWatch = await server.watch(
    "orion/state",
    (state) => watched.push(structuredClone(state)),
    (error) => {
      watchFailure = error;
    },
  );
  await server.replace("orion/state", { overlay_running_test: true });
  await server.apply("orion/state", [
    { op: "add", path: "/overlay_on_air_test", value: false },
  ]);
  const deadline = Date.now() + 5000;
  while (watched.at(-1)?.overlay_on_air_test !== false && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(watchFailure, undefined);
  assert.deepEqual(watched.at(-1), {
    overlay_running_test: true,
    overlay_on_air_test: false,
  });
  stopWatch();
  subscriber.close();
  subscriber = null;
  await Promise.all([server.stop(), server.stop()]);
  assert.throws(() => process.kill(first.pid, 0));
  const restarted = await server.start();
  assert.notEqual(restarted.pid, first.pid);
  assert.deepEqual((await server.read("solar/program")).state, original);
  assert.deepEqual((await server.read("orion/state")).state, { revision: 0 });
  assert.equal((await server.read("solar/preview")).state, null);
  const death = new Promise((yes) => {
    failed = yes;
  });
  process.kill(restarted.pid);
  assert.match((await death).message, /LSDP_PROCESS_EXITED|CONNECTION_LOST/);
  await assert.rejects(server.read("solar/program"), /LSDP_NOT_READY/);
  await server.stop();
  assert.deepEqual(await readFile(archivePath), originalArchive);
  const missing = new SolarReceptionServer({
    ...options,
    binaryPath: resolve("dist/native/absent.exe"),
  });
  await assert.rejects(missing.start(), /ENOENT/);
  await missing.stop();
  const cancelled = new SolarReceptionServer(options);
  const pending = cancelled.start();
  await cancelled.stop();
  await assert.rejects(pending);
  await cancelled.stop();
  console.log(
    JSON.stringify({
      result: "PASS",
      wire: first.wire,
      resources: first.resources,
      nativeDiffOperations: event.mutation.operations,
      lifecycle: [
        "coalesced-start",
        "ready-handshake",
        "fragmented-read",
        "resource-isolation",
        "stable-retry",
        "stale-rejection",
        "atomic-rejection",
        "native-control-subscription",
        "stop-reaped",
        "restart-original",
        "unexpected-exit",
        "missing-binary",
        "cancelled-start",
      ],
      originalUnchanged: true,
    }),
  );
} finally {
  subscriber?.close();
  await server.stop();
}
