import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { SolarReceptionServer } from "../dist/server/index.mjs";
import { BrowserLSDP } from "../vendor/lsdp-native-browser/src/browser.js";
const path = process.argv[2],
  bytes = await readFile(path);
const original = JSON.parse(strFromU8(unzipSync(bytes)["scene.lsml"]));
const events = [],
  states = [],
  failures = [];
const server = new SolarReceptionServer({
  origins: ["http://127.0.0.1:8099"],
  packageRoot: resolve("dist"),
  probeIntervalMs: 0,
  resources: {
    "solar/program": { type: "solar.lsml/1", initial: original },
    "orion/state": {
      type: "orion.state/1",
      initial: { selection: "program", revision: 0 },
    },
  },
  onRecovery: (event) => events.push(event),
  onFailure: (error) => failures.push(error.message),
});
let peer, close;
try {
  const first = await server.start();
  close = await server.watch(
    "orion/state",
    (state) => states.push(state),
    (error) => failures.push(error.message),
  );
  // External native writer, like Orion: not a host.replace shortcut.
  peer = new BrowserLSDP(first.websocketUrl);
  await peer.ready;
  const desired = structuredClone(original);
  desired.defaults.recovery_probe = "RAM only";
  await peer.transaction({
    kind: "route",
    id: "f".repeat(32),
    port: "solar/program",
    type: "solar.lsml/1",
    payload: desired,
  });
  await peer.transaction({
    kind: "route",
    id: "e".repeat(32),
    port: "orion/state",
    type: "orion.state/1",
    payload: { selection: "program", revision: 2 },
  });
  const wait = async (predicate) => {
    const until = Date.now() + 10000;
    while (!predicate()) {
      if (Date.now() > until) throw new Error("Recovery proof timed out");
      await new Promise((yes) => setTimeout(yes, 20));
    }
  };
  await wait(() => states.some((s) => s.revision === 2));
  // Host-side watcher checkpoints the accepted external state in RAM.
  await new Promise((yes) => setTimeout(yes, 50));
  process.kill(first.pid);
  await wait(() => events.some((e) => e.state === "ready"));
  const recovered = await server.start();
  assert.notEqual(recovered.pid, first.pid);
  assert.equal(recovered.address, first.address);
  assert.equal(recovered.websocketUrl, first.websocketUrl);
  assert.deepEqual((await server.read("solar/program")).state, desired);
  assert.deepEqual((await server.read("orion/state")).state, {
    selection: "program",
    revision: 2,
  });
  await server.apply("orion/state", [
    { op: "replace", path: "/revision", value: 3 },
  ]);
  await wait(() => states.some((s) => s.revision === 3));
  assert.deepEqual(failures, []);
  await server.stop();
  assert.throws(() => process.kill(recovered.pid, 0));
  const clean = await server.start();
  assert.deepEqual((await server.read("solar/program")).state, original);
  await server.stop();
  assert.throws(() => process.kill(clean.pid, 0));
  assert.deepEqual(await readFile(path), bytes);
  console.log(
    JSON.stringify({
      result: "PASS",
      checks: [
        "external-writer RAM checkpoint",
        "forced process death",
        "same TCP/WS endpoints",
        "automatic watch reconnect",
        "continued mutations",
        "explicit restart original",
        "owned children reaped",
        "archive unchanged",
      ],
      events,
      failures,
    }),
  );
} finally {
  close?.();
  peer?.close();
  await server.stop();
}
