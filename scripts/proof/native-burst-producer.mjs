import { randomBytes } from "node:crypto";
import { readNative, withNative, NativeState } from "../native-lsdp-tools.mjs";

const [url, mode = "burst", duration = "1000"] = process.argv.slice(2);
if (!["burst", "paced"].includes(mode))
  throw new Error("Unknown measurement mode");
const total = 512;
const pacedDurationMs = Number(duration);
if (!Number.isFinite(pacedDurationMs) || pacedDurationMs <= 0)
  throw new Error("Invalid paced duration");
const path = "/defaults/__lit.text.text_msxz43eh_1";
const clock = () => performance.timeOrigin + performance.now();
await withNative(url, async (peer) => {
  const baseline = await readNative(peer, "scene");
  let state = NativeState.from(baseline.state);
  if (state.stateHash !== baseline.stateHash)
    throw new Error("Native baseline mismatch");
  const messages = [],
    hashes = [],
    prepared = performance.now();
  for (let index = 1; index <= total; index++) {
    const operations = [
      { op: "replace", path, value: String(index).padStart(4, "0") + "/0512" },
    ];
    messages.push({
      format: "lsdp.apply/1",
      id: randomBytes(16).toString("hex"),
      target: "scene",
      beforeHash: state.stateHash,
      operations,
      require: "applied",
    });
    state = state.patch(operations);
    hashes.push(state.stateHash);
  }
  const preparationMs = performance.now() - prepared;
  console.log(JSON.stringify({ ready: true, preparationMs }));
  let pending = "";
  const go = await new Promise((resolve, reject) => {
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      pending += chunk;
      if (pending.includes("\n")) resolve(JSON.parse(pending.split("\n")[0]));
    });
    process.stdin.on("error", reject);
  });
  const waitUntil = async (deadline) => {
    while (clock() < deadline) {
      const remaining = deadline - clock();
      // This dedicated load generator must not bunch 120 Hz input into Windows'
      // coarse timer ticks. Yield to I/O near the deadline; never alter the values.
      await new Promise((yes) =>
        remaining > 25 ? setTimeout(yes, remaining - 20) : setImmediate(yes),
      );
    }
  };
  await waitUntil(go.startEpochMs);
  const started = performance.now(),
    startedEpochMs = clock();
  let chain = Promise.resolve();
  const receipts = [],
    updates = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    chain = chain.then(async () => {
      if (mode === "paced")
        await waitUntil(startedEpochMs + (index * pacedDurationMs) / total);
      const sentEpochMs = clock();
      const receipt = await peer.transaction(message);
      if (receipt.level !== "applied" || receipt.transactionId !== message.id)
        throw new Error("Native receipt mismatch");
      if (receipt.stateHash && receipt.stateHash !== hashes[index])
        throw new Error("Native state hash mismatch");
      receipts.push({
        id: message.id,
        counter: index + 1,
        sentEpochMs,
        epochMs: clock(),
        level: receipt.level,
        stateHash: hashes[index],
      });
      if (receipts.length === total)
        updates.push(
          fetch(go.origin + "/bench/progress", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ native: receipts.length }),
          }).catch(() => {}),
        );
    });
  }
  const enqueueMs = performance.now() - started;
  await chain;
  const completed = clock();
  await Promise.all(updates);
  console.log(
    JSON.stringify({
      mode,
      operationCount: total,
      transactionCount: messages.length,
      preparationMs,
      enqueueMs,
      startedEpochMs,
      lastNativeAckEpochMs: receipts.at(-1).epochMs,
      nativeDrainMs: completed - startedEpochMs,
      receipts,
      finalValue: "0512/0512",
      finalStateHash: state.stateHash,
      pacedDurationMs: mode === "paced" ? pacedDurationMs : null,
      pacing: "deadline with setImmediate near deadline; dedicated producer CPU",
    }),
  );
});
process.stdin.destroy();
