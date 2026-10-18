import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { SolarReceptionServer } from "../dist/server/index.mjs";

const binaryPath = process.argv[2] ?? process.env.LUMENCAST_LSDP_BIN;
if (!binaryPath)
  throw new Error("Usage: test-composition-reception <lsdpd> [evidence.json]");

const seed = {
  schema: "solar.native-composition.state/1",
  producers: {},
  graphs: {},
};
const events = [];
const states = [];
const watchErrors = [];
const server = new SolarReceptionServer({
  binaryPath: resolve(binaryPath),
  origins: ["http://127.0.0.1:8099"],
  resources: {
    "solar/composition": {
      type: "solar.native-composition/1",
      initial: seed,
    },
  },
  probeIntervalMs: 0,
  recoveryAttempts: 2,
  onRecovery: (event) => events.push(event),
  onFailure: (error) => watchErrors.push(error.message),
});

const wait = async (predicate, label) => {
  const deadline = Date.now() + 10_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await new Promise((yes) => setTimeout(yes, 20));
  }
};
let first;
let recovered;
let stopWatch;
try {
  first = await server.start();
  assert.ok(first.resources.includes("solar/composition"));
  const baseline = await server.read("solar/composition");
  assert.deepEqual(baseline.state, seed);
  assert.match(baseline.stateHash, /^tree-sha256:[a-f0-9]{64}$/);
  stopWatch = await server.watch(
    "solar/composition",
    (state) => states.push(structuredClone(state)),
    (error) => watchErrors.push(error.message),
  );
  await server.apply("solar/composition", [
    { op: "add", path: "/producers/A", value: "host-a" },
  ]);
  await wait(
    () => states.some((state) => state.producers.A === "host-a"),
    "claim A watch",
  );
  assert.deepEqual((await server.read("solar/composition")).state, {
    ...seed,
    producers: { A: "host-a" },
  });

  const replacement = {
    ...seed,
    producers: { A: "host-a", B: "host-b" },
  };
  await server.replace("solar/composition", replacement);
  await wait(
    () => states.some((state) => state.producers.B === "host-b"),
    "replace watch",
  );
  assert.deepEqual((await server.read("solar/composition")).state, replacement);
  await assert.rejects(
    server.replace("solar/composition", {
      schema: "wrong/1",
      producers: {},
      graphs: {},
    }),
    /NATIVE_COMPOSITION_STATE_INVALID/,
  );
  await assert.rejects(
    server.apply(
      "solar/composition",
      [{ op: "remove", path: "/producers/B" }],
      { beforeHash: baseline.stateHash },
    ),
    /BASE_MISMATCH/,
  );
  assert.deepEqual((await server.read("solar/composition")).state, replacement);

  process.kill(first.pid);
  await wait(
    () => events.some((event) => event.state === "ready"),
    "native recovery",
  );
  recovered = await server.start();
  assert.notEqual(recovered.pid, first.pid);
  assert.equal(recovered.address, first.address);
  assert.equal(recovered.websocketUrl, first.websocketUrl);
  assert.deepEqual((await server.read("solar/composition")).state, seed);
  await wait(
    () => states.at(-1)?.producers.A === undefined,
    "recovery watch seed",
  );
  await server.apply("solar/composition", [
    { op: "add", path: "/producers/B", value: "host-b-recovered" },
  ]);
  await wait(
    () => states.at(-1)?.producers.B === "host-b-recovered",
    "recovered watch",
  );
  assert.deepEqual(watchErrors, []);

  const binary = await readFile(resolve(binaryPath));
  const builtServer = await readFile(resolve("dist/server/index.mjs"));
  const result = {
    schema: "solar.local-native-composition-reception/1",
    passed: true,
    binarySha256: createHash("sha256").update(binary).digest("hex"),
    serverSha256: createHash("sha256").update(builtServer).digest("hex"),
    resource: "solar/composition",
    type: "solar.native-composition/1",
    wire: first.wire,
    firstPid: first.pid,
    recoveredPid: recovered.pid,
    initialStateHash: baseline.stateHash,
    recoveryEvents: events,
    watchedStates: states,
    checks: [
      "declared resource capability",
      "seed read and normative hash",
      "apply claim and watch",
      "full replace and watch",
      "invalid replacement rejected before exchange",
      "stale apply rejected without mutation",
      "automatic recovery resets declared composition seed",
      "same TCP/WebSocket endpoint and watch reconnect",
      "post-recovery apply and watch",
      "owned native child reaped",
    ],
  };
  stopWatch();
  stopWatch = undefined;
  await server.stop();
  assert.throws(() => process.kill(recovered.pid, 0));
  if (process.argv[3])
    await writeFile(
      resolve(process.argv[3]),
      JSON.stringify(result, null, 2) + "\n",
    );
  console.log(
    JSON.stringify({
      passed: true,
      resource: result.resource,
      checks: result.checks.length,
    }),
  );
} finally {
  stopWatch?.();
  await server.stop();
}
