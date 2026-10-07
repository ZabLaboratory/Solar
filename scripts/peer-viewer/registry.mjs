import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
// MeetViewer builds one aggregate MediaStream per authored peer. Chromium can
// deliver that stream's audio track before its video track, so the same object
// is intentionally published more than once while it becomes usable. The
// original registry treated same-object writes as no-ops and the LIVE
// primitive could stay attached to an audio-only stream until the next room
// handoff. Keep the re-emit behaviour in the consumed dist/webrtc entry.
async function patchPeerStreamRegistry(path) {
  let source = await readFile(path, "utf8");
  if (source.includes("Re-publish the same object")) return;
  const needles = [
    "      if (streams.get(peerLabel) === stream) return; // idempotent re-emit guard\n",
    "      if (streams.get(peerLabel) === stream) return;\n",
    "            if (streams.get(peerLabel) === stream)\n                return; // idempotent re-emit guard\n",
    "        if (streams.get(peerLabel) === stream)\n            return;\n",
  ];
  const needle = needles.find((value) => source.includes(value));
  if (needle === undefined) {
    throw new Error(
      `unsupported @lumencast/runtime peer-stream registry contract: ${path}`,
    );
  }
  const replacement =
    "      // MeetViewer fills one aggregate MediaStream incrementally (audio first, video second).\n" +
    "      // Re-publish the same object so consumers waiting for video observe the second edge.\n";
  source = source.replace(needle, replacement);
  await writeFile(path, source);
}
// A publisher can reconnect under the same stable peer label before the
// signaling server delivers the old peer's `peer-left`. The shared registry is
// label-keyed, so the stale leave used to remove the replacement stream even
// though its new RTCPeerConnection was connected and receiving frames. Track
// the peer id that most recently published each label and let only that
// generation withdraw it.
async function patchRegistryPeerGeneration(path) {
  let source = await readFile(path, "utf8");
  const before = source;
  {
    source = source.replace(
      `): void {\n  // Index the registry by the NORMALISED label`,
      `): void {\n  const activePeerIds = new Map<string, string>();\n  // Index the registry by the NORMALISED label`,
    );
    source = source.replace(
      `    if (claim.acquire(key, viewer)) registry.set(key, e.stream);`,
      `    if (claim.acquire(key, viewer)) {\n      activePeerIds.set(key, e.peerId);\n      registry.set(key, e.stream);\n    }`,
    );
    source = source.replace(
      `    if (claim.acquire(key, viewer)) {\n      registry.remove(key);\n      claim.release(key, viewer);\n    }`,
      `    if (\n      activePeerIds.get(key) === e.peerId &&\n      claim.acquire(key, viewer)\n    ) {\n      activePeerIds.delete(key);\n      registry.remove(key);\n      claim.release(key, viewer);\n    }`,
    );
    // The emitted JS has no type parameters and braces the one-line set.
    source = source.replace(
      `function wireViewer(viewer, registry, claim) {\n    // Index`,
      `function wireViewer(viewer, registry, claim) {\n    const activePeerIds = new Map();\n    // Index`,
    );
    source = source.replace(
      `        if (claim.acquire(key, viewer))\n            registry.set(key, e.stream);`,
      `        if (claim.acquire(key, viewer)) {\n            activePeerIds.set(key, e.peerId);\n            registry.set(key, e.stream);\n        }`,
    );
    source = source.replace(
      `        if (claim.acquire(key, viewer)) {\n            registry.remove(key);\n            claim.release(key, viewer);\n        }`,
      `        if (activePeerIds.get(key) === e.peerId && claim.acquire(key, viewer)) {\n            activePeerIds.delete(key);\n            registry.remove(key);\n            claim.release(key, viewer);\n        }`,
    );
  }
  if (
    !source.includes("activePeerIds") ||
    !source.includes("e.peerId") ||
    false
  ) {
    throw new Error(
      `unsupported @lumencast/runtime registry generation contract: ${path}`,
    );
  }
  if (source !== before) await writeFile(path, source);
}
export async function patchRegistry(runtimeRoot) {
  await patchPeerStreamRegistry(
    join(runtimeRoot, "dist", "webrtc", "peer-stream-registry.js"),
  );
  await patchRegistryPeerGeneration(
    join(runtimeRoot, "dist", "webrtc", "index.js"),
  );
}
