import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { SolarReceptionServer } from "../dist/server/index.mjs";

const recovery = [],
  failures = [],
  states = [];
const server = new SolarReceptionServer({
  origins: ["http://127.0.0.1:8099"],
  packageRoot: resolve("dist"),
  probeIntervalMs: 0,
  resources: {
    "orion/state": { type: "orion.state/1", initial: { counter: 0 } },
  },
  onRecovery: (event) => recovery.push(event),
  onFailure: (error) => failures.push(error.message),
});
let close, writer;
try {
  const first = await server.start();
  close = await server.watch(
    "orion/state",
    (state) => {
      states.push(state.counter);
      // External writer remains alive while this consumer deliberately falls behind.
      if (state.counter === 1)
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    },
    (error) => failures.push(error.message),
  );
  const tools = new URL("./native-lsdp-tools.mjs", import.meta.url).href;
  const code = `import {withNative,NativeState} from ${JSON.stringify(tools)};
await withNative(${JSON.stringify(first.websocketUrl)}, async peer => {
let state=NativeState.from({counter:0});
for(let counter=1;counter<=512;counter++){
const operations=[{op:'replace',path:'/counter',value:counter}];
const ack=await peer.transaction({format:'lsdp.apply/1',id:counter.toString(16).padStart(32,'0'),target:'orion/state',beforeHash:state.stateHash,operations,require:'applied'});
if(ack.level!=='applied')throw new Error('ACK missing');state=state.patch(operations);
}console.log('ACK_COUNT 512');});`;
  writer = spawn(process.execPath, ["--input-type=module", "-e", code], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  writer.stdout.on("data", (data) => {
    output += data;
  });
  writer.stderr.on("data", (data) => {
    output += data;
  });
  const exit = await new Promise((yes, no) => {
    writer.once("exit", yes);
    writer.once("error", no);
  });
  assert.equal(exit, 0, output);
  assert.match(output, /ACK_COUNT 512/);
  const until = Date.now() + 10000;
  while (!states.includes(512) && Date.now() < until)
    await new Promise((yes) => setTimeout(yes, 25));
  assert.ok(states.includes(512), "Lagging watcher did not catch up");
  assert.equal(
    server.status().pid,
    first.pid,
    "A lagging watcher restarted the healthy receiver",
  );
  assert.deepEqual((await server.read("orion/state")).state, { counter: 512 });
  assert.deepEqual(recovery, []);
  assert.deepEqual(failures, []);
  console.log(
    JSON.stringify({
      result: "PASS",
      nativeACKCount: 512,
      receiverPIDUnchanged: true,
      authoritativeFinalCounter: 512,
      watchFinalCounter: states.at(-1),
      receivedWatchEvents: states.length,
      recovery,
      failures,
    }),
  );
} finally {
  writer?.kill();
  close?.();
  await server.stop();
}
