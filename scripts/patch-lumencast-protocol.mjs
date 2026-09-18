import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const packageRoot = join(root, "node_modules", "@lumencast", "protocol");
const targets = [
  join(packageRoot, "src", "host-allow.ts"),
  join(packageRoot, "dist", "host-allow.js"),
];
const supportedCurrentLimits = [
  "const MAX_URL_LEN = 8192;",
  "const MAX_URL_LEN = 262144;",
];
// Prism resolves authenticated Canvas images to bounded inline raster URLs.
// A full-HD authored PNG legitimately exceeds the old 256 KiB thumbnail cap
// once base64 encoded (Launch is ~4.9 MiB). Keep the no-network data:image
// contract, but give production scene artwork a still-bounded 16 MiB ceiling.
const patched = "const MAX_URL_LEN = 16777216;";

for (const path of targets) {
  let source;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`@lumencast/protocol target missing: ${path}`, { cause: error });
  }
  const current = supportedCurrentLimits.find((value) => source.includes(value));
  if (current !== undefined) {
    await writeFile(path, source.replace(current, patched));
    continue;
  }
  if (source.includes(patched)) continue;
  throw new Error(`unsupported @lumencast/protocol host-allow contract: ${path}`);
}

console.log("[solar] @lumencast/protocol local render image limit=16777216");

const runtimeRoot = join(root, "node_modules", "@lumencast", "runtime");
const runtimeSource = join(runtimeRoot, "src", "mount.ts");
const runtimeSourceNeedle = `    token: options.token,\n    ...(options.scene`;
const runtimeSourceReplacement =
  `    token: options.token,\n    ...(options.webSocketImpl !== undefined\n` +
  `      ? { webSocketImpl: options.webSocketImpl }\n` +
  `      : {}),\n    ...(options.scene`;

async function patchRuntimeFile(path, needle, replacement) {
  const source = await readFile(path, "utf8");
  if (source.includes(needle)) {
    await writeFile(path, source.replace(needle, replacement));
    return "patched";
  }
  if (source.includes(replacement)) return "already-patched";
  if (
    replacement.includes("const previousName = existing.info.name;") &&
    source.includes("const previousName = existing.info.name;") &&
    source.includes("existing.info.name = peer.name;") &&
    source.includes("existing.info.role = peer.role;")
  ) {
    return "already-patched";
  }
  throw new Error(`unsupported @lumencast/runtime mount contract: ${path}`);
}

await patchRuntimeFile(runtimeSource, runtimeSourceNeedle, runtimeSourceReplacement);
await patchRuntimeFile(
  join(runtimeRoot, "dist", "mount.js"),
  `        token: options.token,\n        ...(options.scene`,
  `        token: options.token,\n        ...(options.webSocketImpl !== undefined\n` +
    `            ? { webSocketImpl: options.webSocketImpl }\n` +
    `            : {}),\n        ...(options.scene`,
);

const runtimeDistFiles = await readdir(join(runtimeRoot, "dist"));
const runtimeIndexFile = runtimeDistFiles.find(
  (name) => /^index-.*\.js$/.test(name),
);
if (!runtimeIndexFile) {
  throw new Error("@lumencast/runtime bundled index missing");
}
await patchRuntimeFile(
  join(runtimeRoot, "dist", runtimeIndexFile),
  `    token: t.token,\n    ...t.scene`,
  `    token: t.token,\n    ...t.webSocketImpl !== void 0 ? { webSocketImpl: t.webSocketImpl } : {},\n    ...t.scene`,
);

console.log("[solar] @lumencast/runtime forwards webSocketImpl to WsClient");

// MeetViewer builds one aggregate MediaStream per authored peer. Chromium can
// deliver that stream's audio track before its video track, so the same object
// is intentionally published more than once while it becomes usable. The
// original registry treated same-object writes as no-ops and the LIVE
// primitive could stay attached to an audio-only stream until the next room
// handoff. Keep the re-emit behaviour in both readable modules and every
// bundled runtime variant shipped with the standalone Solar host.
async function patchPeerStreamRegistry(path) {
  let source = await readFile(path, "utf8");
  const original = source;
  const bundled = /index-.*\.js$/.test(path);

  if (bundled) {
    const needle = "if (t.get(i) === c) return;\n      const o = !t.has(i);";
    const replacement =
      "/* @prism-peer-stream-reemit */\n      const o = !t.has(i);";
    if (source.includes(needle)) source = source.replace(needle, replacement);
    if (source !== original) await writeFile(path, source);
    return;
  }

  if (source.includes("Re-publish the same object")) return;
  const needles = [
    "      if (streams.get(peerLabel) === stream) return;\n",
    "        if (streams.get(peerLabel) === stream)\n            return;\n",
  ];
  const needle = needles.find((value) => source.includes(value));
  if (needle === undefined) {
    throw new Error(`unsupported @lumencast/runtime peer-stream registry contract: ${path}`);
  }
  const replacement =
    "      // MeetViewer fills one aggregate MediaStream incrementally (audio first, video second).\n" +
    "      // Re-publish the same object so consumers waiting for video observe the second edge.\n";
  source = source.replace(needle, replacement);
  await writeFile(path, source);
}

await patchPeerStreamRegistry(join(runtimeRoot, "src", "webrtc", "peer-stream-registry.ts"));
await patchPeerStreamRegistry(join(runtimeRoot, "dist", "webrtc", "peer-stream-registry.js"));
for (const name of runtimeDistFiles.filter((entry) => /^index-.*\.js$/.test(entry))) {
  await patchPeerStreamRegistry(join(runtimeRoot, "dist", name));
}

console.log("[solar] @lumencast/runtime republishes aggregate peer streams as video arrives");

// A signaling `signal` can overtake `peer-joined`. Runtime 0.18.2 then creates
// the RTCPeerConnection with an UUID-derived fallback name and never replaces
// it when the authoritative PeerInfo arrives. The media flows, but the registry
// publishes it under the fallback key, leaving the authored camera slot empty.
// Reconcile that temporary identity in-place and re-key an already-received
// stream without recreating the peer connection or changing the wire protocol.
const identitySourceNeedle = `    const existing = this.remotes.get(peer.id);
    if (existing) return existing;`;
const identitySourceReplacement = `    const existing = this.remotes.get(peer.id);
    if (existing) {
      const previousName = existing.info.name;
      existing.info.name = peer.name;
      existing.info.role = peer.role;
      if (previousName !== peer.name && existing.stream.getTracks().length > 0) {
        this.emit("peer-left", { peerId: peer.id, peerName: previousName });
        this.emit("remote-track", {
          peerId: peer.id,
          peerName: peer.name,
          stream: existing.stream,
        });
      }
      return existing;
    }`;

const identityDistNeedle = `        const existing = this.remotes.get(peer.id);
        if (existing)
            return existing;`;
const identityDistReplacement = `        const existing = this.remotes.get(peer.id);
        if (existing) {
            const previousName = existing.info.name;
            existing.info.name = peer.name;
            existing.info.role = peer.role;
            if (previousName !== peer.name && existing.stream.getTracks().length > 0) {
                this.emit("peer-left", { peerId: peer.id, peerName: previousName });
                this.emit("remote-track", {
                    peerId: peer.id,
                    peerName: peer.name,
                    stream: existing.stream,
                });
            }
            return existing;
        }`;

async function upgradeIdentityMutation(path) {
  const source = await readFile(path, "utf8");
  const upgraded = source
    .replace(
      /^([ \t]*)existing\.info = peer;$/m,
      "$1existing.info.name = peer.name;\n$1existing.info.role = peer.role;",
    )
    .replace(
      /^([ \t]*)existing\.info\.name = peer\.name;\r?\n[ \t]*existing\.info\.role = peer\.role;$/m,
      "$1existing.info.name = peer.name;\n$1existing.info.role = peer.role;",
    );
  if (upgraded !== source) await writeFile(path, upgraded);
}

await upgradeIdentityMutation(join(runtimeRoot, "src", "webrtc", "meet-viewer.ts"));
await upgradeIdentityMutation(join(runtimeRoot, "dist", "webrtc", "meet-viewer.js"));
await patchRuntimeFile(
  join(runtimeRoot, "src", "webrtc", "meet-viewer.ts"),
  identitySourceNeedle,
  identitySourceReplacement,
);
await patchRuntimeFile(
  join(runtimeRoot, "dist", "webrtc", "meet-viewer.js"),
  identityDistNeedle,
  identityDistReplacement,
);

for (const name of runtimeDistFiles.filter((entry) => /^index-.*\.js$/.test(entry))) {
  const path = join(runtimeRoot, "dist", name);
  const original = await readFile(path, "utf8");
  const source = original.replace(
    /([A-Za-z_$][\w$]*)\.info = ([A-Za-z_$][\w$]*);/,
    "$1.info.name = $2.name;\n      $1.info.role = $2.role;",
  );
  if (source !== original) await writeFile(path, source);
  if (source.includes("previousName =") && source.includes('this.emit("remote-track"')) continue;
  const match = source.match(
    /(^[ \t]*)const ([A-Za-z_$][\w$]*) = this\.remotes\.get\(([A-Za-z_$][\w$]*)\.id\);\n\1if \(\2\) return \2;/m,
  );
  if (!match) {
    throw new Error(`unsupported @lumencast/runtime MeetViewer contract: ${path}`);
  }
  const [, indent, existing, peer] = match;
  const replacement =
    `${indent}const ${existing} = this.remotes.get(${peer}.id);\n` +
    `${indent}if (${existing}) {\n` +
    `${indent}  const previousName = ${existing}.info.name;\n` +
    `${indent}  ${existing}.info.name = ${peer}.name;\n` +
    `${indent}  ${existing}.info.role = ${peer}.role;\n` +
    `${indent}  if (previousName !== ${peer}.name && ${existing}.stream.getTracks().length > 0) {\n` +
    `${indent}    this.emit("peer-left", { peerId: ${peer}.id, peerName: previousName });\n` +
    `${indent}    this.emit("remote-track", { peerId: ${peer}.id, peerName: ${peer}.name, stream: ${existing}.stream });\n` +
    `${indent}  }\n` +
    `${indent}  return ${existing};\n` +
    `${indent}}`;
  await writeFile(path, source.replace(match[0], replacement));
}

console.log("[solar] @lumencast/runtime reconciles early signaling peer identity");

async function patchKnownPeerRoster(path) {
  let source = await readFile(path, "utf8");
  const before = source;
  const bundled = /index-.*\.js$/.test(path);

  if (bundled) {
    if (!source.includes("knownPeers =")) {
      source = source.replace(
        /(\n {2}remotes = [^\n]+;\n)/,
        "$1  knownPeers = /* @__PURE__ */ new Map();\n",
      );
    }
    source = source.replace(
      /for \(const ([A-Za-z_$][\w$]*) of ([A-Za-z_$][\w$]*)\.peers\) this\.ensureRemote\(\1\);/g,
      "for (const $1 of $2.peers) this.knownPeers.set($1.id, $1), this.ensureRemote($1);",
    );
    source = source.replace(
      /this\.emit\("peer-joined", ([A-Za-z_$][\w$]*)\.peer\), this\.ensureRemote\(\1\.peer\);/g,
      'this.knownPeers.set($1.peer.id, $1.peer), this.emit("peer-joined", $1.peer), this.ensureRemote($1.peer);',
    );
    source = source.replace(
      /(case "peer-left": \{\n\s+const [A-Za-z_$][\w$]* = this\.remotes\.get\(([A-Za-z_$][\w$]*)\.peerId\);)/g,
      "$1\n        this.knownPeers.delete($2.peerId);",
    );
    source = source.replace(
      /this\.ensureRemote\(\{ id: ([A-Za-z_$][\w$]*), name: \1\.slice\(0, 8\), role: "publisher" \}\)/g,
      'this.ensureRemote(this.knownPeers.get($1) ?? { id: $1, name: $1.slice(0, 8), role: "publisher" })',
    );
    source = source.replace(
      /(tearDown\(\) \{\n\s+for \(const [^\n]+\n\s+this\.remotes\.clear\(\);)(?!\n\s+this\.knownPeers\.clear)/,
      "$1\n    this.knownPeers.clear();",
    );
    source = source
      .replace(
        /(this\.knownPeers\.set\(([A-Za-z_$][\w$]*)\.peer\.id, \2\.peer\),\s*)+/g,
        "$1",
      )
      .replace(
        /((?: {8})this\.knownPeers\.delete\(([A-Za-z_$][\w$]*)\.peerId\);\n)(?:\1)+/g,
        "$1",
      );
  } else {
    if (!source.includes("knownPeers =")) {
      source = source.replace(
        /(private remotes = new Map<string, RemoteState>\(\);|remotes = new Map\(\);)/,
        "$1\n  private knownPeers = new Map<string, PeerInfo>();",
      );
      source = source.replace(
        "  private knownPeers = new Map<string, PeerInfo>();",
        path.endsWith(".js")
          ? "    knownPeers = new Map();"
          : "  private knownPeers = new Map<string, PeerInfo>();",
      );
    }
    source = source.replace(
      /for \(const peer of msg\.peers\) this\.ensureRemote\(peer\);/g,
      "for (const peer of msg.peers) {\n          this.knownPeers.set(peer.id, peer);\n          this.ensureRemote(peer);\n        }",
    );
    source = source.replace(
      /(case "peer-joined": \{\n)(\s*)this\.emit\("peer-joined", msg\.peer\);/g,
      '$1$2this.knownPeers.set(msg.peer.id, msg.peer);\n$2this.emit("peer-joined", msg.peer);',
    );
    source = source.replace(
      /(case "peer-left": \{\n)(\s*)const remote = this\.remotes\.get\(msg\.peerId\);/g,
      "$1$2this.knownPeers.delete(msg.peerId);\n$2const remote = this.remotes.get(msg.peerId);",
    );
    source = source.replace(
      /this\.ensureRemote\(\{ id: from, name: from\.slice\(0, 8\), role: "publisher" \}\)/g,
      'this.ensureRemote(this.knownPeers.get(from) ?? { id: from, name: from.slice(0, 8), role: "publisher" })',
    );
    source = source.replace(
      /(this\.remotes\.clear\(\);)(?!\r?\n\s*this\.knownPeers\.clear)/,
      "$1\n    this.knownPeers.clear();",
    );
    source = source
      .replace(
        /((?:\s*)this\.knownPeers\.set\(msg\.peer\.id, msg\.peer\);\r?\n)(?:\1)+/g,
        "$1",
      )
      .replace(
        /((?:\s*)this\.knownPeers\.delete\(msg\.peerId\);\r?\n)(?:\1)+/g,
        "$1",
      );
  }

  if (
    !source.includes("knownPeers") ||
    !source.includes("this.knownPeers.get(") ||
    !source.includes("this.knownPeers.set(")
  ) {
    throw new Error(`unsupported @lumencast/runtime known-peer contract: ${path}`);
  }
  if (source !== before) await writeFile(path, source);
}

await patchKnownPeerRoster(join(runtimeRoot, "src", "webrtc", "meet-viewer.ts"));
await patchKnownPeerRoster(join(runtimeRoot, "dist", "webrtc", "meet-viewer.js"));
for (const name of runtimeDistFiles.filter((entry) => /^index-.*\.js$/.test(entry))) {
  await patchKnownPeerRoster(join(runtimeRoot, "dist", name));
}

console.log("[solar] @lumencast/runtime retains authoritative peer roster across retries");

// A superseded RTCPeerConnection can report `failed` / `closed` after a retry
// has already installed a fresh RemoteState for the same peer. Its late event
// must not delete the fresh state nor withdraw that peer's live stream from the
// registry. Only the RemoteState that is still current owns removal.
async function patchRemoteGenerationGuard(path) {
  let source = await readFile(path, "utf8");
  const before = source;
  const bundled = /index-.*\.js$/.test(path);

  if (bundled) {
    source = source.replace(
      /\((\w+)\.connectionState === "failed" \|\| \1\.connectionState === "closed"\) && \(this\.remotes\.delete\((\w+)\.id\), this\.emit\("peer-left", \{ peerId: \2\.id, peerName: \2\.name \}\)\)/g,
      '($1.connectionState === "failed" || $1.connectionState === "closed") && this.remotes.get($2.id)?.pc === $1 && (this.remotes.delete($2.id), this.emit("peer-left", { peerId: $2.id, peerName: $2.name }))',
    );
  } else {
    source = source.replace(
      /if \(pc\.connectionState === "failed" \|\| pc\.connectionState === "closed"\) \{\r?\n(\s*)this\.remotes\.delete\(peer\.id\);\r?\n\s*this\.emit\("peer-left", \{ peerId: peer\.id, peerName: peer\.name \}\);\r?\n\s*\}/g,
      'if (\n$1  (pc.connectionState === "failed" || pc.connectionState === "closed") &&\n$1  this.remotes.get(peer.id)?.pc === pc\n$1) {\n$1  this.remotes.delete(peer.id);\n$1  this.emit("peer-left", { peerId: peer.id, peerName: peer.name });\n$1}',
    );
  }

  if (!source.includes("this.remotes.get(peer.id)?.pc === pc") && !bundled) {
    throw new Error(`unsupported @lumencast/runtime remote generation contract: ${path}`);
  }
  if (bundled && !/this\.remotes\.get\([A-Za-z_$][\w$]*\.id\)\?\.pc === [A-Za-z_$][\w$]*/.test(source)) {
    throw new Error(`unsupported @lumencast/runtime bundled generation contract: ${path}`);
  }
  if (source !== before) await writeFile(path, source);
}

await patchRemoteGenerationGuard(join(runtimeRoot, "src", "webrtc", "meet-viewer.ts"));
await patchRemoteGenerationGuard(join(runtimeRoot, "dist", "webrtc", "meet-viewer.js"));
for (const name of runtimeDistFiles.filter((entry) => /^index-.*\.js$/.test(entry))) {
  await patchRemoteGenerationGuard(join(runtimeRoot, "dist", name));
}

console.log("[solar] @lumencast/runtime ignores stale peer-connection terminal events");

// Chromium can expose a connected receiver with decoded frames after the
// initial `track` callback raced an identity reconciliation or registry
// subscription. Re-publishing the already-owned aggregate stream when the
// current peer connection reaches `connected` is idempotent (`registry.set`
// ignores the same stream) and restores the authored slot without creating a
// second connection, renderer, or cache.
async function patchConnectedStreamRepublish(path) {
  let source = await readFile(path, "utf8");
  const before = source;
  const bundled = /index-.*\.js$/.test(path);
  const connectedBlock = `      const current = this.remotes.get(peer.id);\n      if (\n        pc.connectionState === "connected" &&\n        current?.pc === pc &&\n        current.stream.getTracks().length > 0\n      ) {\n        this.emit("remote-track", {\n          peerId: peer.id,\n          peerName: current.info.name,\n          stream: current.stream,\n        });\n      }`;

  while (source.includes(`${connectedBlock}\n${connectedBlock}`)) {
    source = source.replace(`${connectedBlock}\n${connectedBlock}`, connectedBlock);
  }

  if (bundled) {
    source = source.replace(
      /this\.emit\("connection-state", \{ peerId: ([A-Za-z_$][\w$]*)\.id, state: ([A-Za-z_$][\w$]*)\.connectionState \}\), \(\2\.connectionState === "failed"/g,
      'this.emit("connection-state", { peerId: $1.id, state: $2.connectionState }), $2.connectionState === "connected" && this.remotes.get($1.id)?.pc === $2 && this.remotes.get($1.id).stream.getTracks().length > 0 && this.emit("remote-track", { peerId: $1.id, peerName: this.remotes.get($1.id).info.name, stream: this.remotes.get($1.id).stream }), ($2.connectionState === "failed"',
    );
  } else {
    if (!source.includes('pc.connectionState === "connected"')) {
      source = source.replace(
        `      this.emit("connection-state", { peerId: peer.id, state: pc.connectionState });`,
        `      this.emit("connection-state", { peerId: peer.id, state: pc.connectionState });\n${connectedBlock}`,
      );
    }
  }

  const marker = bundled
    ? 'connectionState === "connected" && this.remotes.get('
    : 'pc.connectionState === "connected"';
  if (!source.includes(marker)) {
    throw new Error(`unsupported @lumencast/runtime connected stream contract: ${path}`);
  }
  if (source !== before) await writeFile(path, source);
}

await patchConnectedStreamRepublish(join(runtimeRoot, "src", "webrtc", "meet-viewer.ts"));
await patchConnectedStreamRepublish(join(runtimeRoot, "dist", "webrtc", "meet-viewer.js"));
for (const name of runtimeDistFiles.filter((entry) => /^index-.*\.js$/.test(entry))) {
  await patchConnectedStreamRepublish(join(runtimeRoot, "dist", name));
}

console.log("[solar] @lumencast/runtime republishes connected aggregate streams");

// The signaling server may announce a stale `peer-left` while the current
// RTCPeerConnection is still connected and decoding frames (for example while
// the publisher is replaced under the same authored label). Do not tear down a
// live aggregate on that transient control message; the connection-state
// terminal event remains the authoritative cleanup path. A replacement peer
// can take the label through the registry generation guard below.
async function patchStalePeerLeave(path) {
  let source = await readFile(path, "utf8");
  const before = source;
  const bundled = /index-.*\.js$/.test(path);

  if (bundled) {
    source = source.replace(
      /case"peer-left":\{const ([A-Za-z_$][\w$]*)=this\.remotes\.get\(([A-Za-z_$][\w$]*)\.peerId\);this\.knownPeers\.delete\(\2\.peerId\),\1&&\(\1\.pc\.close\(\),this\.remotes\.delete\(\2\.peerId\),this\.emit\("peer-left",\{peerId:\2\.peerId,peerName:\1\.info\.name\}\)\);break\}/g,
      'case"peer-left":{const $1=this.remotes.get($2.peerId);this.knownPeers.delete($2.peerId),$1&&($1.pc.connectionState==="connected"&&$1.stream.getTracks().length>0||($1.pc.close(),this.remotes.delete($2.peerId),this.emit("peer-left",{peerId:$2.peerId,peerName:$1.info.name})));break}',
    );
  } else if (path.endsWith("meet-viewer.js")) {
    source = source.replace(
      `            case "peer-left": {\n                this.knownPeers.delete(msg.peerId);\n                const remote = this.remotes.get(msg.peerId);\n                if (remote) {\n                    // The pc owns the tracks — closing it ends them. The registry/consumer\n                    // are notified via the peer-left event (label-keyed).\n                    remote.pc.close();\n                    this.remotes.delete(msg.peerId);\n                    this.emit("peer-left", { peerId: msg.peerId, peerName: remote.info.name });\n                }\n                break;\n            }`,
      `            case "peer-left": {\n                this.knownPeers.delete(msg.peerId);\n                const remote = this.remotes.get(msg.peerId);\n                if (remote) {\n                    // Keep a still-connected aggregate alive. The terminal connection\n                    // event performs authoritative cleanup after a real disconnect.\n                    if (remote.pc.connectionState !== "connected" || remote.stream.getTracks().length === 0) {\n                        remote.pc.close();\n                        this.remotes.delete(msg.peerId);\n                        this.emit("peer-left", { peerId: msg.peerId, peerName: remote.info.name });\n                    }\n                }\n                break;\n            }`,
    );
  } else {
    const sourceNeedle = `      case "peer-left": {\n        this.knownPeers.delete(msg.peerId);\n        const remote = this.remotes.get(msg.peerId);\n        if (remote) {\n          // The pc owns the tracks — closing it ends them. The registry/consumer\n          // are notified via the peer-left event (label-keyed).\n          remote.pc.close();\n          this.remotes.delete(msg.peerId);\n          this.emit("peer-left", { peerId: msg.peerId, peerName: remote.info.name });\n        }\n        break;\n      }`;
    const sourceReplacement = `      case "peer-left": {\n        this.knownPeers.delete(msg.peerId);\n        const remote = this.remotes.get(msg.peerId);\n        if (remote) {\n          // Keep a still-connected aggregate alive. The terminal connection\n          // event performs authoritative cleanup after a real disconnect.\n          if (remote.pc.connectionState !== "connected" || remote.stream.getTracks().length === 0) {\n            remote.pc.close();\n            this.remotes.delete(msg.peerId);\n            this.emit("peer-left", { peerId: msg.peerId, peerName: remote.info.name });\n          }\n        }\n        break;\n      }`;
    source = source.replace(sourceNeedle, sourceReplacement);
  }

  if (!source.includes("connectionState") || !source.includes("stream.getTracks().length")) {
    throw new Error(`unsupported @lumencast/runtime stale peer-leave contract: ${path}`);
  }
  if (source !== before) await writeFile(path, source);
}

await patchStalePeerLeave(join(runtimeRoot, "src", "webrtc", "meet-viewer.ts"));
await patchStalePeerLeave(join(runtimeRoot, "dist", "webrtc", "meet-viewer.js"));
for (const name of runtimeDistFiles.filter((entry) => /^index-.*\.js$/.test(entry))) {
  await patchStalePeerLeave(join(runtimeRoot, "dist", name));
}

console.log("[solar] @lumencast/runtime preserves connected streams across stale peer leaves");

// A publisher can reconnect under the same stable peer label before the
// signaling server delivers the old peer's `peer-left`. The shared registry is
// label-keyed, so the stale leave used to remove the replacement stream even
// though its new RTCPeerConnection was connected and receiving frames. Track
// the peer id that most recently published each label and let only that
// generation withdraw it.
async function patchRegistryPeerGeneration(path) {
  let source = await readFile(path, "utf8");
  const before = source;
  const bundled = /index-.*\.js$/.test(path);

  if (bundled) {
    source = source.replace(
      /function ([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*), ([A-Za-z_$][\w$]*), ([A-Za-z_$][\w$]*)\) \{\n  \2\.on\("remote-track", \(([A-Za-z_$][\w$]*)\) => \{\n    const ([A-Za-z_$][\w$]*) = ([A-Za-z_$][\w$]*)\(\5\.peerName\);\n    \4\.acquire\(\6, \2\) && \3\.set\(\6, \5\.stream\);\n  \}\), \2\.on\("peer-left", \(([A-Za-z_$][\w$]*)\) => \{\n    const ([A-Za-z_$][\w$]*) = \7\(\8\.peerName\);\n    \4\.acquire\(\9, \2\) && \(\3\.remove\(\9\), \4\.release\(\9, \2\)\);\n  \}\);\n\}/,
      (_match, fn, viewer, registry, claim, trackEvent, trackKey, labelFn, leftEvent, leftKey) =>
        `function ${fn}(${viewer}, ${registry}, ${claim}) {\n` +
        `  const activePeerIds = /* @__PURE__ */ new Map();\n` +
        `  ${viewer}.on("remote-track", (${trackEvent}) => {\n` +
        `    const ${trackKey} = ${labelFn}(${trackEvent}.peerName);\n` +
        `    ${claim}.acquire(${trackKey}, ${viewer}) && (activePeerIds.set(${trackKey}, ${trackEvent}.peerId), ${registry}.set(${trackKey}, ${trackEvent}.stream));\n` +
        `  }), ${viewer}.on("peer-left", (${leftEvent}) => {\n` +
        `    const ${leftKey} = ${labelFn}(${leftEvent}.peerName);\n` +
        `    activePeerIds.get(${leftKey}) === ${leftEvent}.peerId && ${claim}.acquire(${leftKey}, ${viewer}) && (activePeerIds.delete(${leftKey}), ${registry}.remove(${leftKey}), ${claim}.release(${leftKey}, ${viewer}));\n` +
        `  });\n` +
        `}`,
    );
  } else {
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
    (!bundled && !source.includes("e.peerId")) ||
    (bundled && !source.includes("activePeerIds.get("))
  ) {
    throw new Error(`unsupported @lumencast/runtime registry generation contract: ${path}`);
  }
  if (source !== before) await writeFile(path, source);
}

await patchRegistryPeerGeneration(join(runtimeRoot, "src", "webrtc", "index.ts"));
await patchRegistryPeerGeneration(join(runtimeRoot, "dist", "webrtc", "index.js"));
for (const name of runtimeDistFiles.filter((entry) => /^index-.*\.js$/.test(entry))) {
  await patchRegistryPeerGeneration(join(runtimeRoot, "dist", name));
}

console.log("[solar] @lumencast/runtime ignores stale same-label peer leaves");

// Recover a viewer leg after a relay/ICE failure. Late trickle candidates are
// ignored until a fresh offer creates the next generation; otherwise an orphan
// ICE packet leaves a `new` RTCPeerConnection that can never carry a camera.
async function patchViewerRecovery(path) {
  let source = await readFile(path, "utf8");
  const before = source;
  const bundled = /index-.*\.js$/.test(path);
  if (source.includes("scheduleRemoteRetry")) return;

  if (bundled) {
    source = source.replace(
      "knownPeers = /* @__PURE__ */ new Map();",
      "knownPeers = /* @__PURE__ */ new Map();\n  retryTimers = /* @__PURE__ */ new Map();\n  retryAttempts = /* @__PURE__ */ new Map();",
    );
    source = source.replace(
      "  tearDown() {\n    for (const e of this.remotes.values()) e.pc.close();\n    this.remotes.clear();\n    this.knownPeers.clear();\n  }",
      "  tearDown() {\n    for (const e of this.retryTimers.values()) clearTimeout(e);\n    this.retryTimers.clear();\n    this.retryAttempts.clear();\n    for (const e of this.remotes.values()) e.pc.close();\n    this.remotes.clear();\n    this.knownPeers.clear();\n  }",
    );
    source = source.replace(
      "    n || (n = this.ensureRemote(this.knownPeers.get(e) ?? { id: e, name: e.slice(0, 8), role: \"publisher\" }));",
      "    if (!n && s.kind === \"ice\") return;\n    n || (n = this.ensureRemote(this.knownPeers.get(e) ?? { id: e, name: e.slice(0, 8), role: \"publisher\" }));",
    );
    source = source.replace(
      "      this.emit(\"connection-state\", { peerId: e.id, state: n.connectionState }), n.connectionState === \"connected\" && this.remotes.get(e.id)?.pc === n && this.remotes.get(e.id).stream.getTracks().length > 0 && this.emit(\"remote-track\", { peerId: e.id, peerName: this.remotes.get(e.id).info.name, stream: this.remotes.get(e.id).stream }), (n.connectionState === \"failed\" || n.connectionState === \"closed\") && this.remotes.get(e.id)?.pc === n && (this.remotes.delete(e.id), this.emit(\"peer-left\", { peerId: e.id, peerName: e.name }));",
      "      this.emit(\"connection-state\", { peerId: e.id, state: n.connectionState }), n.connectionState === \"connected\" && this.remotes.get(e.id)?.pc === n && this.remotes.get(e.id).stream.getTracks().length > 0 && (this.clearRemoteRetry(e.id), this.emit(\"remote-track\", { peerId: e.id, peerName: this.remotes.get(e.id).info.name, stream: this.remotes.get(e.id).stream })), (n.connectionState === \"failed\" || n.connectionState === \"closed\") && this.remotes.get(e.id)?.pc === n && (() => { const r = this.remotes.get(e.id); this.remotes.delete(e.id), n.close(), this.emit(\"peer-left\", { peerId: e.id, peerName: r?.info.name ?? e.name }), this.scheduleRemoteRetry(r?.info ?? e); })();",
    );
    source = source.replace(
      "  /* ---- Helpers ------------------------------------------------------ */",
      "  scheduleRemoteRetry(e) {\n    if (!this.knownPeers.has(e.id) || this.retryTimers.has(e.id)) return;\n    const s = (this.retryAttempts.get(e.id) ?? 0) + 1;\n    if (s > 3) return;\n    const n = Math.min(1e3, 250 * 2 ** (s - 1));\n    const r = setTimeout(() => {\n      this.retryTimers.delete(e.id);\n      if (!this.knownPeers.has(e.id) || this.remotes.has(e.id) || this.ws?.readyState !== this.deps.WebSocket.OPEN) return;\n      this.retryAttempts.set(e.id, s);\n      const i = this.ensureRemote(this.knownPeers.get(e.id) ?? e);\n      void this.dialRemote(e.id, i);\n    }, n);\n    this.retryTimers.set(e.id, r);\n  }\n  clearRemoteRetry(e) {\n    const s = this.retryTimers.get(e);\n    s !== void 0 && (clearTimeout(s), this.retryTimers.delete(e));\n    this.retryAttempts.delete(e);\n  }\n  async dialRemote(e, s) {\n    const n = this.remotes.get(e);\n    if (!n || s !== void 0 && n !== s || n.makingOffer || n.pc.signalingState !== \"stable\") return;\n    try {\n      n.makingOffer = !0, await n.pc.setLocalDescription(), n.pc.localDescription && this.sendSignal(e, { kind: \"sdp\", description: { type: n.pc.localDescription.type, sdp: n.pc.localDescription.sdp } });\n    } catch {\n    } finally {\n      n.makingOffer = !1;\n    }\n  }\n  /* ---- Helpers ------------------------------------------------------ */",
    );
  } else {
    const js = path.endsWith(".js");
    const field = js ? "    knownPeers = new Map();" : "  private knownPeers = new Map<string, PeerInfo>();";
    source = source.replace(
      field,
      js
        ? `${field}\n    retryTimers = new Map();\n    retryAttempts = new Map();`
        : `${field}\n  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();\n  private retryAttempts = new Map<string, number>();`,
    );
    const tearDown = js
      ? "    tearDown() {\n        for (const r of this.remotes.values())\n            r.pc.close();"
      : "  private tearDown(): void {\n    for (const r of this.remotes.values()) r.pc.close();";
    source = source.replace(
      tearDown,
      js
        ? "    tearDown() {\n        for (const timer of this.retryTimers.values()) clearTimeout(timer);\n        this.retryTimers.clear();\n        this.retryAttempts.clear();\n        for (const r of this.remotes.values())\n            r.pc.close();"
        : "  private tearDown(): void {\n    for (const timer of this.retryTimers.values()) clearTimeout(timer);\n    this.retryTimers.clear();\n    this.retryAttempts.clear();\n    for (const r of this.remotes.values()) r.pc.close();",
    );
    const signalNeedle = js
      ? "        if (!remote) {\n            remote = this.ensureRemote(this.knownPeers.get(from) ?? { id: from, name: from.slice(0, 8), role: \"publisher\" });"
      : "    if (!remote) {\n      remote = this.ensureRemote(this.knownPeers.get(from) ?? { id: from, name: from.slice(0, 8), role: \"publisher\" });";
    source = source.replace(
      signalNeedle,
      js
        ? "        if (!remote) {\n            if (payload.kind === \"ice\") return;\n            remote = this.ensureRemote(this.knownPeers.get(from) ?? { id: from, name: from.slice(0, 8), role: \"publisher\" });"
        : "    if (!remote) {\n      if (payload.kind === \"ice\") return;\n      remote = this.ensureRemote(this.knownPeers.get(from) ?? { id: from, name: from.slice(0, 8), role: \"publisher\" });",
    );
    const helper = js
      ? "    scheduleRemoteRetry(peer) {\n        if (!this.knownPeers.has(peer.id) || this.retryTimers.has(peer.id)) return;\n        const attempt = (this.retryAttempts.get(peer.id) ?? 0) + 1;\n        if (attempt > 3) return;\n        const delay = Math.min(1000, 250 * 2 ** (attempt - 1));\n        const timer = setTimeout(() => {\n            this.retryTimers.delete(peer.id);\n            if (!this.knownPeers.has(peer.id) || this.remotes.has(peer.id) || this.ws?.readyState !== this.deps.WebSocket.OPEN) return;\n            this.retryAttempts.set(peer.id, attempt);\n            const remote = this.ensureRemote(this.knownPeers.get(peer.id) ?? peer);\n            void this.dialRemote(peer.id, remote);\n        }, delay);\n        this.retryTimers.set(peer.id, timer);\n    }\n    clearRemoteRetry(peerId) {\n        const timer = this.retryTimers.get(peerId);\n        if (timer !== undefined) {\n            clearTimeout(timer);\n            this.retryTimers.delete(peerId);\n        }\n        this.retryAttempts.delete(peerId);\n    }\n    async dialRemote(peerId, expected) {\n        const remote = this.remotes.get(peerId);\n        if (!remote || expected !== undefined && remote !== expected || remote.makingOffer || remote.pc.signalingState !== \"stable\") return;\n        try {\n            remote.makingOffer = true;\n            await remote.pc.setLocalDescription();\n            if (remote.pc.localDescription) this.sendSignal(peerId, { kind: \"sdp\", description: { type: remote.pc.localDescription.type, sdp: remote.pc.localDescription.sdp } });\n        } catch {\n        } finally {\n            remote.makingOffer = false;\n        }\n    }\n"
      : "  private scheduleRemoteRetry(peer: PeerInfo): void {\n    if (!this.knownPeers.has(peer.id) || this.retryTimers.has(peer.id)) return;\n    const attempt = (this.retryAttempts.get(peer.id) ?? 0) + 1;\n    if (attempt > 3) return;\n    const delay = Math.min(1_000, 250 * 2 ** (attempt - 1));\n    const timer = setTimeout(() => {\n      this.retryTimers.delete(peer.id);\n      if (!this.knownPeers.has(peer.id) || this.remotes.has(peer.id) || this.ws?.readyState !== this.deps.WebSocket.OPEN) return;\n      this.retryAttempts.set(peer.id, attempt);\n      const remote = this.ensureRemote(this.knownPeers.get(peer.id) ?? peer);\n      void this.dialRemote(peer.id, remote);\n    }, delay);\n    this.retryTimers.set(peer.id, timer);\n  }\n\n  private clearRemoteRetry(peerId: string): void {\n    const timer = this.retryTimers.get(peerId);\n    if (timer !== undefined) {\n      clearTimeout(timer);\n      this.retryTimers.delete(peerId);\n    }\n    this.retryAttempts.delete(peerId);\n  }\n\n  private async dialRemote(peerId: string, expected?: RemoteState): Promise<void> {\n    const remote = this.remotes.get(peerId);\n    if (!remote || (expected !== undefined && remote !== expected) || remote.makingOffer || remote.pc.signalingState !== \"stable\") return;\n    try {\n      remote.makingOffer = true;\n      await remote.pc.setLocalDescription();\n      if (remote.pc.localDescription) this.sendSignal(peerId, { kind: \"sdp\", description: { type: remote.pc.localDescription.type as \"offer\" | \"answer\" | \"pranswer\" | \"rollback\", sdp: remote.pc.localDescription.sdp } });\n    } catch {\n    } finally {\n      remote.makingOffer = false;\n    }\n  }\n\n";
    const helperNeedle = js ? "    /* ---- Helpers ------------------------------------------------------ */" : "  /* ---- Helpers ------------------------------------------------------ */";
    source = source.replace(helperNeedle, `${helper}${helperNeedle}`);
  }

  if (!source.includes("scheduleRemoteRetry")) {
    throw new Error(`unsupported @lumencast/runtime viewer recovery contract: ${path}`);
  }
  if (source !== before) await writeFile(path, source);
}

await patchViewerRecovery(join(runtimeRoot, "src", "webrtc", "meet-viewer.ts"));
await patchViewerRecovery(join(runtimeRoot, "dist", "webrtc", "meet-viewer.js"));
for (const name of runtimeDistFiles.filter((entry) => /^index-.*\.js$/.test(entry))) {
  await patchViewerRecovery(join(runtimeRoot, "dist", name));
}

console.log("[solar] @lumencast/runtime recovers failed viewer camera legs");

// A recovered Solar receiver cannot rely on the runtime's automatic
// `negotiationneeded` offer: the Prism publisher owns the first offer and the
// preview injection deliberately suppresses that automatic viewer offer to
// avoid glare.  Once a receiver has actually failed, however, the retry path
// is the only party that can restart the leg if the publisher did not observe
// its terminal state.  Create an explicit offer for that retry.  The initial
// negotiation handler still calls the no-argument form and remains suppressed
// by the preview injection, so this does not change the steady-state wire.
async function patchViewerRetryOffer(path) {
  let source = await readFile(path, "utf8");
  const before = source;
  const bundled = /index-.*\.js$/.test(path);

  if (bundled) {
    source = source.replace(
      /await ([A-Za-z_$][\w$]*)\.pc\.setLocalDescription\(\), ([A-Za-z_$][\w$]*)\.pc\.localDescription/g,
      (_match, pcOwner, localOwner) =>
        `await ${pcOwner}.pc.setLocalDescription(await ${pcOwner}.pc.createOffer()), ${localOwner}.pc.localDescription`,
    );
  } else {
    source = source.replace(
      /await remote\.pc\.setLocalDescription\(\);/g,
      "const offer = await remote.pc.createOffer();\n      await remote.pc.setLocalDescription(offer);",
    );
  }

  if (
    !source.includes("pc.createOffer()") ||
    (!bundled && !source.includes("setLocalDescription(offer)"))
  ) {
    throw new Error(`unsupported @lumencast/runtime viewer retry-offer contract: ${path}`);
  }
  if (source !== before) await writeFile(path, source);
}

await patchViewerRetryOffer(join(runtimeRoot, "src", "webrtc", "meet-viewer.ts"));
await patchViewerRetryOffer(join(runtimeRoot, "dist", "webrtc", "meet-viewer.js"));
for (const name of runtimeDistFiles.filter((entry) => /^index-.*\.js$/.test(entry))) {
  await patchViewerRetryOffer(join(runtimeRoot, "dist", name));
}

console.log("[solar] @lumencast/runtime emits explicit offers for failed viewer retries");

// A retry offer can cross a publisher-owned retry offer in flight.  MeetViewer
// is receive-only in production, so the publisher's offer is authoritative:
// make the viewer polite and explicitly roll back its own retry offer before
// accepting that fresh publisher offer.  This keeps a failed slot from being
// stranded in `have-local-offer` while preserving the initial one-way dial.
async function patchViewerRetryCollision(path) {
  let source = await readFile(path, "utf8");
  const before = source;
  const bundled = /index-.*\.js$/.test(path);

  if (bundled) {
    source = source.replace(
      'if(r.ignoreOffer=!this.isPolite(a)&&d,r.ignoreOffer)return;await c.setRemoteDescription(f);',
      'if(r.ignoreOffer=!this.isPolite(a)&&d,r.ignoreOffer)return;d&&f.type==="offer"&&await c.setLocalDescription({type:"rollback"}).catch(()=>{});await c.setRemoteDescription(f);',
    );
    source = source.replace(
      /if \(([A-Za-z_$][\w$]*)\.ignoreOffer = !this\.isPolite\(([A-Za-z_$][\w$]*)\) && ([A-Za-z_$][\w$]*), \1\.ignoreOffer\) return;\s*await ([A-Za-z_$][\w$]*)\.setRemoteDescription\(([A-Za-z_$][\w$]*)\);/g,
      (_match, remote, from, collision, pc, desc) =>
        `if (${remote}.ignoreOffer = !this.isPolite(${from}) && ${collision}, ${remote}.ignoreOffer) return; ${collision} && ${desc}.type === "offer" && await ${pc}.setLocalDescription({type:"rollback"}).catch(()=>{}); await ${pc}.setRemoteDescription(${desc});`,
    );
    source = source.replace(
      'isPolite(a){return this.selfId?this.selfId>a:!1}',
      'isPolite(){return!0}',
    );
    source = source.replace(
      /isPolite\(([A-Za-z_$][\w$]*)\)\s*\{\s*return this\.selfId\s*\?\s*this\.selfId\s*>\s*\1\s*:\s*!1\s*\}/g,
      "isPolite(){return!0}",
    );
    // Vite's published runtime chunks use the readable class-method form
    // (`isPolite(e) { ... }`) even though they are consumed as bundled
    // dependencies.  Keep the receive-only viewer polite in those chunks too;
    // otherwise a retry offer can be ignored by id ordering and strand a slot
    // in `have-local-offer`.
    source = source.replace(
      /isPolite\(([A-Za-z_$][\w$]*)\)\s*\{\s*return this\.selfId\s*\?\s*this\.selfId\s*>\s*\1\s*:\s*!1;?\s*\}/g,
      "isPolite(){return!0}",
    );
  } else {
    source = source.replace(
      `      if (remote.ignoreOffer) return;\n\n      await pc.setRemoteDescription(desc);`,
      `      if (remote.ignoreOffer) return;\n      if (offerCollision && desc.type === "offer") {\n        try {\n          await pc.setLocalDescription({ type: "rollback" });\n        } catch {\n          /* a stable receiver has nothing to roll back */\n        }\n      }\n\n      await pc.setRemoteDescription(desc);`,
    );
    source = source.replace(
      `  private isPolite(otherId: string): boolean {\n    if (!this.selfId) return false;\n    return this.selfId > otherId;\n  }`,
      `  private isPolite(_otherId: string): boolean {\n    // MeetViewer is receive-only; a publisher offer always wins a retry glare.\n    return true;\n  }`,
    );
    source = source.replace(
      `    if (remote.ignoreOffer) return;\n\n        await pc.setRemoteDescription(desc);`,
      `    if (remote.ignoreOffer) return;\n    if (offerCollision && desc.type === "offer") {\n        try {\n            await pc.setLocalDescription({ type: "rollback" });\n        } catch {\n            /* a stable receiver has nothing to roll back */\n        }\n    }\n\n        await pc.setRemoteDescription(desc);`,
    );
    source = source.replace(
      `        if (remote.ignoreOffer)\n            return;\n        await pc.setRemoteDescription(desc);`,
      `        if (remote.ignoreOffer)\n            return;\n        if (offerCollision && desc.type === "offer") {\n            try {\n                await pc.setLocalDescription({ type: "rollback" });\n            } catch {\n                /* a stable receiver has nothing to roll back */\n            }\n        }\n        await pc.setRemoteDescription(desc);`,
    );
    source = source.replace(
      `            if (remote.ignoreOffer)\n                return;\n            await pc.setRemoteDescription(desc);`,
      `            if (remote.ignoreOffer)\n                return;\n            if (offerCollision && desc.type === "offer") {\n                try {\n                    await pc.setLocalDescription({ type: "rollback" });\n                } catch {\n                    /* a stable receiver has nothing to roll back */\n                }\n            }\n            await pc.setRemoteDescription(desc);`,
    );
    source = source.replace(
      `    isPolite(otherId) {\n        if (!this.selfId)\n            return false;\n        return this.selfId > otherId;\n    }`,
      `    isPolite(_otherId) {\n        return true;\n    }`,
    );
    source = source.replace(
      `    isPolite(otherId) {\n        if (!this.selfId)\n            return false;\n        return this.selfId > otherId;\n    }`,
      `    isPolite(_otherId) {\n        return true;\n    }`,
    );
  }

  if (
    !source.includes("setLocalDescription({ type: \"rollback\" })") &&
    !source.includes('setLocalDescription({type:"rollback"})')
  ) {
    throw new Error(`unsupported @lumencast/runtime viewer retry-collision contract: ${path}`);
  }
  if (source !== before) await writeFile(path, source);
}

await patchViewerRetryCollision(join(runtimeRoot, "src", "webrtc", "meet-viewer.ts"));
await patchViewerRetryCollision(join(runtimeRoot, "dist", "webrtc", "meet-viewer.js"));
for (const name of runtimeDistFiles.filter((entry) => /^index-.*\.js$/.test(entry))) {
  await patchViewerRetryCollision(join(runtimeRoot, "dist", name));
}

console.log("[solar] @lumencast/runtime rolls back viewer retry glare in favour of publisher offers");

// WebSocket frames arrive in order, but MeetViewer's SDP/ICE handlers are
// asynchronous.  Without a small protocol queue, the offer for one camera can
// enter `handleSignal` while the previous peer's `peer-joined` is still
// allocating its transceivers; the resulting generation stays `new` and the
// corresponding authored slot never receives a track.  Serialize only the
// signaling state machine (not media delivery) so three camera slots can join
// deterministically without changing the wire protocol.
async function patchViewerMessageSerialization(path) {
  let source = await readFile(path, "utf8");
  const before = source;
  const bundled = /index-.*\.js$/.test(path);

  if (bundled) {
    if (!source.includes("messageQueue =")) {
      source = source.replace(
        /(^\s*retryAttempts = [^;]+;\r?\n)/m,
        "$1  messageQueue = Promise.resolve();\n",
      );
    }
    source = source.replace(
      /([A-Za-z_$][\w$]*)\.addEventListener\("message", \(\w+\) => void this\.onMessage\(\w+\.data\)\)/g,
      (_match, socket) =>
        `${socket}.addEventListener("message", (event) => { this.messageQueue = this.messageQueue.then(() => this.onMessage(event.data)).catch(() => undefined); })`,
    );
  } else {
    const js = path.endsWith(".js");
    const hasMessageQueueField = js
      ? /^\s+messageQueue = Promise\.resolve\(\);/m.test(source)
      : source.includes("private messageQueue");
    if (!hasMessageQueueField) {
      const field = js
        ? "    retryAttempts = new Map();"
        : "  private retryAttempts = new Map<string, number>();";
      const replacement =
        js
          ? `${field}\n    messageQueue = Promise.resolve();`
          : `${field}\n  private messageQueue: Promise<void> = Promise.resolve();`;
      source = source.replace(field, replacement);
    }
    source = source.replace(
      /ws\.addEventListener\("message", \(ev\) => void this\.onMessage\(\(ev as MessageEvent\)\.data\)\);/g,
      `ws.addEventListener("message", (ev) => {\n        this.messageQueue = this.messageQueue\n          .then(() => this.onMessage((ev as MessageEvent).data))\n          .catch(() => undefined);\n      });`,
    );
    source = source.replace(
      /ws\.addEventListener\("message", \(ev\) => void this\.onMessage\(ev\.data\)\);/g,
      `ws.addEventListener("message", (ev) => {\n        this.messageQueue = this.messageQueue\n          .then(() => this.onMessage(ev.data))\n          .catch(() => undefined);\n      });`,
    );
  }

  if (!source.includes("messageQueue")) {
    throw new Error(`unsupported @lumencast/runtime viewer message contract: ${path}`);
  }
  if (source !== before) await writeFile(path, source);
}

await patchViewerMessageSerialization(join(runtimeRoot, "src", "webrtc", "meet-viewer.ts"));
await patchViewerMessageSerialization(join(runtimeRoot, "dist", "webrtc", "meet-viewer.js"));
for (const name of runtimeDistFiles.filter((entry) => /^index-.*\.js$/.test(entry))) {
  await patchViewerMessageSerialization(join(runtimeRoot, "dist", name));
}

console.log("[solar] @lumencast/runtime serializes MeetViewer signaling");

// A publisher retry can deliver a fresh SDP offer while Solar still holds the
// previous failed/closed receiver generation.  Passing that offer to the
// terminal RTCPeerConnection is rejected by Chromium, leaving the authored
// camera slot empty.  Drop only that stale generation before accepting a new
// offer; the receive-only viewer remains the answerer and the wire contract is
// unchanged.
async function patchViewerStaleOfferGeneration(path) {
  let source = await readFile(path, "utf8");
  const before = source;
  const bundled = /index-.*\.js$/.test(path);

  if (bundled) {
    if (!source.includes("= void 0;")) {
      source = source.replace(
        /async handleSignal\(([A-Za-z_$][\w$]*),\s*([A-Za-z_$][\w$]*)\)\s*\{\s*let\s+([A-Za-z_$][\w$]*)\s*=\s*this\.remotes\.get\(\1\);\s*if\s*\(!\3\s*&&\s*\2\.kind\s*===\s*"ice"\)\s*return;/,
        (_match, from, payload, remote) =>
          `async handleSignal(${from}, ${payload}) {\n` +
          `    let ${remote} = this.remotes.get(${from});\n` +
          `    if (${remote} && (${remote}.pc.connectionState === "failed" || ${remote}.pc.connectionState === "closed")) {\n` +
          `      ${remote}.pc.close();\n` +
          `      this.remotes.delete(${from});\n` +
          `      ${remote} = void 0;\n` +
          `    }\n` +
          `    if (!${remote} && ${payload}.kind === "ice") return;`,
      );
    }
  } else {
    const signalPattern = /(\n[ \t]*)let remote = this\.remotes\.get\(from\);\r?\n([ \t]*)if \(!remote\) \{/;
    if (!source.includes("remote = undefined;") && signalPattern.test(source)) {
      source = source.replace(
        signalPattern,
        (_match, lineIndent, blockIndent) =>
          `${lineIndent}let remote = this.remotes.get(from);\n` +
          `${blockIndent}if (remote && (remote.pc.connectionState === "failed" || remote.pc.connectionState === "closed")) {\n` +
          `${blockIndent}  remote.pc.close();\n` +
          `${blockIndent}  this.remotes.delete(from);\n` +
          `${blockIndent}  remote = undefined;\n` +
          `${blockIndent}}\n` +
          `${blockIndent}if (!remote) {`,
      );
    }
  }

  if (!source.includes("connectionState === \"failed\"") ||
      (!bundled && !source.includes("remote = undefined;")) ||
      (bundled && !source.includes("= void 0;"))) {
    throw new Error(`unsupported @lumencast/runtime stale viewer offer contract: ${path}`);
  }
  if (source !== before) await writeFile(path, source);
}

await patchViewerStaleOfferGeneration(join(runtimeRoot, "src", "webrtc", "meet-viewer.ts"));
await patchViewerStaleOfferGeneration(join(runtimeRoot, "dist", "webrtc", "meet-viewer.js"));
for (const name of runtimeDistFiles.filter((entry) => /^index-.*\.js$/.test(entry))) {
  await patchViewerStaleOfferGeneration(join(runtimeRoot, "dist", name));
}

console.log("[solar] @lumencast/runtime replaces stale viewer generations before fresh offers");

async function patchUnbundledViewerRecoveryTerminal(path) {
  let source = await readFile(path, "utf8");
  const before = source;
  if (source.includes("this.scheduleRemoteRetry(current?.info ?? peer)")) return;
  const js = path.endsWith(".js");
  const connectedNeedle = js
    ? "            this.emit(\"remote-track\", {\\n                peerId: peer.id,\\n                peerName: current.info.name,\\n                stream: current.stream,\\n            });"
    : "        this.emit(\"remote-track\", {\\n          peerId: peer.id,\\n          peerName: current.info.name,\\n          stream: current.stream,\\n        });";
  const connectedReplacement = js
    ? "            this.clearRemoteRetry(peer.id);\\n            this.emit(\"remote-track\", {\\n                peerId: peer.id,\\n                peerName: current.info.name,\\n                stream: current.stream,\\n            });"
    : "        this.clearRemoteRetry(peer.id);\\n        this.emit(\"remote-track\", {\\n          peerId: peer.id,\\n          peerName: current.info.name,\\n          stream: current.stream,\\n        });";
  source = source.replace(connectedNeedle, connectedReplacement);
  const terminalNeedle = js
    ? "                this.remotes.delete(peer.id);\\n                this.emit(\"peer-left\", { peerId: peer.id, peerName: peer.name });"
    : "    this.remotes.delete(peer.id);\\n    this.emit(\"peer-left\", { peerId: peer.id, peerName: peer.name });";
  const terminalReplacement = js
    ? "                const current = this.remotes.get(peer.id);\\n                this.remotes.delete(peer.id);\\n                pc.close();\\n                this.emit(\"peer-left\", { peerId: peer.id, peerName: current?.info.name ?? peer.name });\\n                this.scheduleRemoteRetry(current?.info ?? peer);"
    : "    const current = this.remotes.get(peer.id);\\n    this.remotes.delete(peer.id);\\n    pc.close();\\n    this.emit(\"peer-left\", { peerId: peer.id, peerName: current?.info.name ?? peer.name });\\n    this.scheduleRemoteRetry(current?.info ?? peer);";
  source = source.replace(terminalNeedle, terminalReplacement);
  if (source !== before) await writeFile(path, source);
}

await patchUnbundledViewerRecoveryTerminal(join(runtimeRoot, "src", "webrtc", "meet-viewer.ts"));
await patchUnbundledViewerRecoveryTerminal(join(runtimeRoot, "dist", "webrtc", "meet-viewer.js"));

// Keep a connected aggregate alive when an old signaling generation announces
// `peer-left`; the RTCPeerConnection terminal event is the authoritative
// cleanup signal. This variant is needed for Vite's minified host chunks.
async function patchBundledConnectedPeerLeave(path) {
  let source = await readFile(path, "utf8");
  const before = source;
  source = source.replace(
    /case\s+"peer-left":\s*\{\s*const ([A-Za-z_$][\w$]*) = this\.remotes\.get\(([A-Za-z_$][\w$]*)\.peerId\);\s*this\.knownPeers\.delete\(\2\.peerId\);\s*\1 && \(\1\.pc\.close\(\), this\.remotes\.delete\(\2\.peerId\), this\.emit\("peer-left", \{ peerId: \2\.peerId, peerName: \1\.info\.name \}\)\);\s*break;\s*\}/g,
    (_match, remote, message) =>
      `case "peer-left": {\n        const ${remote} = this.remotes.get(${message}.peerId);\n        this.knownPeers.delete(${message}.peerId);\n        const retryTimer = this.retryTimers.get(${message}.peerId);\n        if (retryTimer !== undefined) {\n          clearTimeout(retryTimer);\n          this.retryTimers.delete(${message}.peerId);\n        }\n        this.retryAttempts.delete(${message}.peerId);\n        ${remote} && (${remote}.pc.connectionState === "connected" && ${remote}.stream.getTracks().length > 0 || (${remote}.pc.close(), this.remotes.delete(${message}.peerId), this.emit("peer-left", { peerId: ${message}.peerId, peerName: ${remote}.info.name })));\n        break;\n      }`,
  );
  source = source.replace(
    /case"peer-left":\{const ([A-Za-z_$][\w$]*)=this\.remotes\.get\(([A-Za-z_$][\w$]*)\.peerId\);this\.knownPeers\.delete\(\2\.peerId\),\1&&\(\1\.pc\.close\(\),this\.remotes\.delete\(\2\.peerId\),this\.emit\("peer-left",\{peerId:\2\.peerId,peerName:\1\.info\.name\}\)\);break\}/g,
    (_match, remote, message) =>
      `case"peer-left":{const ${remote}=this.remotes.get(${message}.peerId);this.knownPeers.delete(${message}.peerId);const retryTimer=this.retryTimers.get(${message}.peerId);retryTimer!==void 0&&(clearTimeout(retryTimer),this.retryTimers.delete(${message}.peerId)),this.retryAttempts.delete(${message}.peerId),${remote}&&(${remote}.pc.connectionState==="connected"&&${remote}.stream.getTracks().length>0||(${remote}.pc.close(),this.remotes.delete(${message}.peerId),this.emit("peer-left",{peerId:${message}.peerId,peerName:${remote}.info.name})));break}`,
  );
  if (source !== before) await writeFile(path, source);
}

for (const name of runtimeDistFiles.filter((entry) => /^index-.*\.js$/.test(entry))) {
  await patchBundledConnectedPeerLeave(join(runtimeRoot, "dist", name));
}

console.log("[solar] @lumencast/runtime preserves connected bundled camera peers");

// A persistent ZabCam room can be re-minted after Meet restarts.  The two
// local Solar documents (Preview and the live browser_source) must not blank
// while their receive-only viewer moves from the stale room to the replacement.
// Runtime 0.18.2 closes removed meshes before it opens the new ones and keeps a
// first-connected-wins registry, which creates exactly that visible gap.  Open
// replacement meshes first and let their first track take ownership; close the
// old generation only after the new WebSocket joins.  This is a receive-side
// handoff only: no Pulsar/Program transport is changed.
async function patchSeamlessRoomHandoff(path) {
  let source = await readFile(path, "utf8");
  const before = source;
  if (source.includes("preferredViewers") || source.includes("h.has(l)")) return;

  if (path.endsWith("webrtc/index.ts")) {
    source = source
      .replace(
        "  const owners = new Map<string, MeetViewer>();\n",
        "  const owners = new Map<string, MeetViewer>();\n  const preferredViewers = new Set<MeetViewer>();\n",
      )
      .replace(
        "      if (owner === undefined) {\n        owners.set(label, viewer);\n        return true;\n      }\n      return owner === viewer; // only the owning room may publish/withdraw",
        "      if (owner === undefined || owner === viewer || preferredViewers.has(viewer)) {\n        owners.set(label, viewer);\n        return true;\n      }\n      return false; // only the owner or a preferred handoff may publish/withdraw",
      )
      .replace("    mesh.viewer.leave();\n", "    preferredViewers.delete(mesh.viewer);\n    mesh.viewer.leave();\n")
      .replace(
        `      const next = new Set(rooms.map((r) => r.roomId));
      // Close rooms no longer present.
      for (const roomId of [...meshes.keys()]) {
        if (!next.has(roomId)) closeRoom(roomId);
      }
      // Open + join rooms newly added.
      const added: MeetViewer[] = [];
      for (const room of rooms) {
        if (!meshes.has(room.roomId)) {
          openRoom(room);
          const m = meshes.get(room.roomId);
          if (m) added.push(m.viewer);
        }
      }
      await Promise.all(added.map((v) => v.join()));`,
        `      const next = new Set(rooms.map((r) => r.roomId));
      const hadMeshes = meshes.size > 0;
      const added: MeetViewer[] = [];
      for (const room of rooms) {
        if (!meshes.has(room.roomId)) {
          openRoom(room);
          const m = meshes.get(room.roomId);
          if (m) {
            if (hadMeshes) preferredViewers.add(m.viewer);
            added.push(m.viewer);
          }
        }
      }
      await Promise.all(added.map((v) => v.join()));
      for (const roomId of [...meshes.keys()]) {
        if (!next.has(roomId)) closeRoom(roomId);
      }`,
      );
  } else if (path.endsWith("webrtc/index.js")) {
    source = source
      .replace(
        "    const owners = new Map();\n",
        "    const owners = new Map();\n    const preferredViewers = new Set();\n",
      )
      .replace(
        "            if (owner === undefined) {\n                owners.set(label, viewer);\n                return true;\n            }\n            return owner === viewer; // only the owning room may publish/withdraw",
        "            if (owner === undefined || owner === viewer || preferredViewers.has(viewer)) {\n                owners.set(label, viewer);\n                return true;\n            }\n            return false; // only the owner or a preferred handoff may publish/withdraw",
      )
      .replace("        mesh.viewer.leave();\n", "        preferredViewers.delete(mesh.viewer);\n        mesh.viewer.leave();\n")
      .replace(
        `            const next = new Set(rooms.map((r) => r.roomId));
            // Close rooms no longer present.
            for (const roomId of [...meshes.keys()]) {
                if (!next.has(roomId))
                    closeRoom(roomId);
            }
            // Open + join rooms newly added.
            const added = [];
            for (const room of rooms) {
                if (!meshes.has(room.roomId)) {
                    openRoom(room);
                    const m = meshes.get(room.roomId);
                    if (m)
                        added.push(m.viewer);
                }
            }
            await Promise.all(added.map((v) => v.join()));`,
        `            const next = new Set(rooms.map((r) => r.roomId));
            const hadMeshes = meshes.size > 0;
            const added = [];
            for (const room of rooms) {
                if (!meshes.has(room.roomId)) {
                    openRoom(room);
                    const m = meshes.get(room.roomId);
                    if (m) {
                        if (hadMeshes)
                            preferredViewers.add(m.viewer);
                        added.push(m.viewer);
                    }
                }
            }
            await Promise.all(added.map((v) => v.join()));
            for (const roomId of [...meshes.keys()]) {
                if (!next.has(roomId))
                    closeRoom(roomId);
            }`,
      );
  } else {
    // Vite's published runtime chunk is minified but keeps the same compact
    // shape. The current dependency is patched below; other stale chunks are
    // harmless and are not selected by dist/lumencast.js.
    if (path.match(/index-.*\.js$/)) {
      source = source
        .replace(
          "return u === void 0 ? (n.set(o, l), !0) : u === l;",
          "return u === void 0 || u === l || h.has(l) ? (n.set(o, l), !0) : !1;",
        )
        .replace(
          "  };\n  function i(o) {",
          "  }, h = /* @__PURE__ */ new Set();\n  function i(o) {",
        )
        .replace("l.viewer.leave(), s.delete(o);", "h.delete(l.viewer), l.viewer.leave(), s.delete(o);")
        .replace(
          `      for (const d of [...s.keys()])
        l.has(d) || c(d);
      const u = [];`,
          `      const f = s.size > 0;
      const u = [];`,
        )
        .replace("g && u.push(g.viewer);", "g && (f && h.add(g.viewer), u.push(g.viewer));")
        .replace(
          "      await Promise.all(u.map((d) => d.join()));\n    },",
          "      await Promise.all(u.map((d) => d.join()));\n      for (const d of [...s.keys()]) l.has(d) || c(d);\n    },",
        );
    }
  }

  if (source === before) return;
  await writeFile(path, source);
}

await patchSeamlessRoomHandoff(join(runtimeRoot, "src", "webrtc", "index.ts"));
await patchSeamlessRoomHandoff(join(runtimeRoot, "dist", "webrtc", "index.js"));
for (const name of runtimeDistFiles.filter((entry) => /^index-.*\.js$/.test(entry))) {
  await patchSeamlessRoomHandoff(join(runtimeRoot, "dist", name));
}

console.log("[solar] @lumencast/runtime keeps both room generations visible during handoff");

// Preserve the old peer owner until a preferred replacement emits video.
async function patchHandoffPeerLeave(path) {
  let source = await readFile(path, "utf8");
  const before = source;
  const bundled = /index-.*\.js$/.test(path);

  if (!bundled) {
    if (!source.includes("claim.preserve?.(key, viewer)")) {
      const needle = [
        '    const key = labelKey(e.peerName);',
        '    if (',
        '      activePeerIds.get(key) === e.peerId &&',
        '      claim.acquire(key, viewer)',
        '    ) {',
      ].join("\n");
      const replacement = [
        '    const key = labelKey(e.peerName);',
        '    if (',
        '      activePeerIds.get(key) === e.peerId &&',
        '      claim.preserve?.(key, viewer) === true',
        '    ) {',
        '      return;',
        '    }',
        '    if (',
        '      activePeerIds.get(key) === e.peerId &&',
        '      claim.acquire(key, viewer)',
        '    ) {',
      ].join("\n");
      if (!source.includes(needle)) {
        throw new Error(`unsupported @lumencast/runtime peer handoff contract: ${path}`);
      }
      source = source.replace(needle, replacement);
    }
    const claimNeedle = [
      '    release: (label: string, viewer: MeetViewer): void => {',
      '      if (owners.get(label) === viewer) owners.delete(label);',
      '    },',
    ].join("\n");
    const claimReplacement = [
      claimNeedle,
      '    preserve: (_label: string, viewer: MeetViewer): boolean =>',
      '      [...preferredViewers].some((candidate) => candidate !== viewer),',
    ].join("\n");
    if (
      source.includes(claimNeedle) &&
      !source.includes("preserve: (_label: string")
    ) {
      source = source.replace(claimNeedle, claimReplacement);
    }
    if (source !== before) await writeFile(path, source);
    return;
  }

  if (!source.includes("s.preserve?.(r, t)")) {
    source = source.replace(
      "activePeerIds.get(r) === n.peerId && s.acquire(r, t)",
      "activePeerIds.get(r) === n.peerId && s.preserve?.(r, t) !== true && s.acquire(r, t)",
    );
    source = source.replace(
      "const i = activePeerIds.get(r), c = i === n.peerId && s.acquire(r, t);",
      "const i = activePeerIds.get(r), c = i === n.peerId && s.preserve?.(r, t) !== true && s.acquire(r, t);",
    );
  }
  if (!source.includes("preserve: (_label, viewer)")) {
    source = source.replace(
      /(release: \(o, l\) => \{\n\s*n\.get\(o\) === l && n\.delete\(o\);\n\s*\})(\n\s*\}, h = \/\* @__PURE__ \*\/ new Set\(\);)/,
      "$1,\n    preserve: (_label, viewer) => [...h].some((candidate) => candidate !== viewer)$2",
    );
  }
  if (source !== before) await writeFile(path, source);
}

await patchHandoffPeerLeave(join(runtimeRoot, "src", "webrtc", "index.ts"));
await patchHandoffPeerLeave(join(runtimeRoot, "dist", "webrtc", "index.js"));
for (const name of runtimeDistFiles.filter((entry) => /^index-.*\.js$/.test(entry))) {
  await patchHandoffPeerLeave(join(runtimeRoot, "dist", name));
}

console.log("[solar] @lumencast/runtime keeps the old peer owner until replacement video arrives");

// Credential rotation can keep the same opaque room id.  The first handoff
// patch above fixes room-id replacement, but the published runtime map is also
// keyed by room id, so the full receive-side generation swap is applied here
// for both source forms and for the already-bundled Vite chunk.  This remains a
// viewer-only change: old meshes stay visible until replacement labels arrive.
async function patchCredentialHandoff(path) {
  let source = await readFile(path, "utf8");
  const before = source;
  const bundled = /index-.*\.js$/.test(path);
  if (bundled) return;

  const tsManagement = String.raw`  // roomId → { viewer, fingerprint }
  const meshes = new Map<string, { viewer: MeetViewer; fingerprint: string }>();
  // peer_label → owning viewer (first-connected-wins).
  const owners = new Map<string, MeetViewer>();
  const preferredViewers = new Set<MeetViewer>();

  const claim = {
    acquire: (label: string, viewer: MeetViewer): boolean => {
      const owner = owners.get(label);
      if (owner === undefined || owner === viewer || preferredViewers.has(viewer)) {
        owners.set(label, viewer);
        return true;
      }
      return false;
    },
    release: (label: string, viewer: MeetViewer): void => {
      if (owners.get(label) === viewer) owners.delete(label);
    },
  };

  const roomFingerprint = (room: RoomOptions): string =>
    JSON.stringify([room.roomId, room.signalingUrl, room.token]);

  function createRoomMesh(room: RoomOptions): { viewer: MeetViewer; fingerprint: string } {
    const viewer = new MeetViewer({
      name: room.name ?? "solar-viewer",
      ...room,
      ...(options.deps !== undefined && room.deps === undefined ? { deps: options.deps } : {}),
    });
    wireViewer(viewer, registry, claim);
    return { viewer, fingerprint: roomFingerprint(room) };
  }

  function openRoom(room: RoomOptions): void {
    if (meshes.has(room.roomId)) return;
    meshes.set(room.roomId, createRoomMesh(room));
  }

  function closeMesh(mesh: { viewer: MeetViewer }): void {
    for (const [label, owner] of [...owners.entries()]) {
      if (owner === mesh.viewer) {
        registry.remove(label);
        owners.delete(label);
      }
    }
    preferredViewers.delete(mesh.viewer);
    mesh.viewer.leave();
  }

  function closeRoom(roomId: string): void {
    const mesh = meshes.get(roomId);
    if (mesh === undefined) return;
    closeMesh(mesh);
    meshes.delete(roomId);
  }

  function scheduleHandoffClose(oldMesh: { viewer: MeetViewer }, replacements: MeetViewer[]): void {
    const oldLabels = [...owners.entries()]
      .filter(([, owner]) => owner === oldMesh.viewer)
      .map(([label]) => label);
    if (oldLabels.length === 0 || replacements.length === 0) {
      closeMesh(oldMesh);
      return;
    }
    const deadline = Date.now() + 5_000;
    const poll = (): void => {
      const ready = oldLabels.every((label) => {
        const owner = owners.get(label);
        return owner !== oldMesh.viewer && owner !== undefined && replacements.includes(owner);
      });
      if (ready || Date.now() >= deadline) {
        closeMesh(oldMesh);
        return;
      }
      setTimeout(poll, 25);
    };
    poll();
  }
`;
  const jsManagement = String.raw`    // roomId → { viewer, fingerprint }
    const meshes = new Map();
    // peer_label → owning viewer (first-connected-wins).
    const owners = new Map();
    const preferredViewers = new Set();
    const claim = {
        acquire: (label, viewer) => {
            const owner = owners.get(label);
            if (owner === undefined || owner === viewer || preferredViewers.has(viewer)) {
                owners.set(label, viewer);
                return true;
            }
            return false;
        },
        release: (label, viewer) => {
            if (owners.get(label) === viewer)
                owners.delete(label);
        },
    };
    const roomFingerprint = (room) => JSON.stringify([room.roomId, room.signalingUrl, room.token]);
    function createRoomMesh(room) {
        const viewer = new MeetViewer({
            name: room.name ?? "solar-viewer",
            ...room,
            ...(options.deps !== undefined && room.deps === undefined ? { deps: options.deps } : {}),
        });
        wireViewer(viewer, registry, claim);
        return { viewer, fingerprint: roomFingerprint(room) };
    }
    function openRoom(room) {
        if (meshes.has(room.roomId))
            return;
        meshes.set(room.roomId, createRoomMesh(room));
    }
    function closeMesh(mesh) {
        for (const [label, owner] of [...owners.entries()]) {
            if (owner === mesh.viewer) {
                registry.remove(label);
                owners.delete(label);
            }
        }
        preferredViewers.delete(mesh.viewer);
        mesh.viewer.leave();
    }
    function closeRoom(roomId) {
        const mesh = meshes.get(roomId);
        if (mesh === undefined)
            return;
        closeMesh(mesh);
        meshes.delete(roomId);
    }
    function scheduleHandoffClose(oldMesh, replacements) {
        const oldLabels = [...owners.entries()]
            .filter(([, owner]) => owner === oldMesh.viewer)
            .map(([label]) => label);
        if (oldLabels.length === 0 || replacements.length === 0) {
            closeMesh(oldMesh);
            return;
        }
        const deadline = Date.now() + 5_000;
        const poll = () => {
            const ready = oldLabels.every((label) => {
                const owner = owners.get(label);
                return owner !== oldMesh.viewer && owner !== undefined && replacements.includes(owner);
            });
            if (ready || Date.now() >= deadline) {
                closeMesh(oldMesh);
                return;
            }
            setTimeout(poll, 25);
        };
        poll();
    }
`;

  const managementPattern = path.endsWith("webrtc/index.ts")
    ? /  \/\/ roomId → \{ viewer, joined \}[\s\S]*?\r?\n  \}\r?\n(?=  for \(const room of options\.rooms\)\s+openRoom\(room\);)/
    : /    \/\/ roomId → \{ viewer, joined \}[\s\S]*?\r?\n    \}\r?\n(?=    for \(const room of options\.rooms\)\s+openRoom\(room\);)/;
  source = source.replace(managementPattern, path.endsWith("webrtc/index.ts") ? tsManagement : jsManagement);

  const tsSetRooms = String.raw`    setRooms: async (rooms) => {
      const next = new Set(rooms.map((r) => r.roomId));
      const hadMeshes = meshes.size > 0;
      const added: MeetViewer[] = [];
      const addedRoomIds: string[] = [];
      const replaced: Array<{
        roomId: string;
        old: { viewer: MeetViewer; fingerprint: string };
        next: { viewer: MeetViewer; fingerprint: string };
      }> = [];
      for (const room of rooms) {
        const current = meshes.get(room.roomId);
        if (current === undefined) {
          const nextMesh = createRoomMesh(room);
          meshes.set(room.roomId, nextMesh);
          if (hadMeshes) preferredViewers.add(nextMesh.viewer);
          added.push(nextMesh.viewer);
          addedRoomIds.push(room.roomId);
        } else if (current.fingerprint !== roomFingerprint(room)) {
          const nextMesh = createRoomMesh(room);
          meshes.set(room.roomId, nextMesh);
          preferredViewers.add(nextMesh.viewer);
          added.push(nextMesh.viewer);
          replaced.push({ roomId: room.roomId, old: current, next: nextMesh });
        }
      }
      try {
        await Promise.all(added.map((v) => v.join()));
      } catch (error) {
        for (const item of replaced) {
          if (meshes.get(item.roomId)?.viewer === item.next.viewer) {
            closeMesh(item.next);
            meshes.set(item.roomId, item.old);
          }
        }
        for (const roomId of addedRoomIds) {
          const mesh = meshes.get(roomId);
          if (mesh && added.includes(mesh.viewer)) closeRoom(roomId);
        }
        throw error;
      }
      for (const item of replaced) scheduleHandoffClose(item.old, [item.next.viewer]);
      for (const roomId of [...meshes.keys()]) {
        if (!next.has(roomId)) {
          const old = meshes.get(roomId);
          meshes.delete(roomId);
          if (old) scheduleHandoffClose(old, added);
        }
      }
    },
`;
  const jsSetRooms = String.raw`    setRooms: async (rooms) => {
        const next = new Set(rooms.map((r) => r.roomId));
        const hadMeshes = meshes.size > 0;
        const added = [];
        const addedRoomIds = [];
        const replaced = [];
        for (const room of rooms) {
            const current = meshes.get(room.roomId);
            if (current === undefined) {
                const nextMesh = createRoomMesh(room);
                meshes.set(room.roomId, nextMesh);
                if (hadMeshes)
                    preferredViewers.add(nextMesh.viewer);
                added.push(nextMesh.viewer);
                addedRoomIds.push(room.roomId);
            }
            else if (current.fingerprint !== roomFingerprint(room)) {
                const nextMesh = createRoomMesh(room);
                meshes.set(room.roomId, nextMesh);
                preferredViewers.add(nextMesh.viewer);
                added.push(nextMesh.viewer);
                replaced.push({ roomId: room.roomId, old: current, next: nextMesh });
            }
        }
        try {
            await Promise.all(added.map((v) => v.join()));
        }
        catch (error) {
            for (const item of replaced) {
                if (meshes.get(item.roomId)?.viewer === item.next.viewer) {
                    closeMesh(item.next);
                    meshes.set(item.roomId, item.old);
                }
            }
            for (const roomId of addedRoomIds) {
                const mesh = meshes.get(roomId);
                if (mesh && added.includes(mesh.viewer))
                    closeRoom(roomId);
            }
            throw error;
        }
        for (const item of replaced)
            scheduleHandoffClose(item.old, [item.next.viewer]);
        for (const roomId of [...meshes.keys()]) {
            if (!next.has(roomId)) {
                const old = meshes.get(roomId);
                meshes.delete(roomId);
                if (old)
                    scheduleHandoffClose(old, added);
            }
        }
    },
`;
  const setRoomsPattern = path.endsWith("webrtc/index.ts")
    ? /    setRooms: async \(rooms\) => \{[\s\S]*?\r?\n    \},\r?\n(?=    resolvePeerStream)/
    : /    setRooms: async \(rooms\) => \{[\s\S]*?\r?\n    \},\r?\n(?=    resolvePeerStream)/;
  source = source.replace(setRoomsPattern, path.endsWith("webrtc/index.ts") ? tsSetRooms : jsSetRooms);
  if (source !== before) await writeFile(path, source);
}

await patchCredentialHandoff(join(runtimeRoot, "src", "webrtc", "index.ts"));
await patchCredentialHandoff(join(runtimeRoot, "dist", "webrtc", "index.js"));

const bundledHandoff = String.raw`function se(t) {
  const e = de(), s = /* @__PURE__ */ new Map(), n = /* @__PURE__ */ new Map(), r = {
    acquire: (o, l) => {
      const u = n.get(o);
      return u === void 0 || u === l || h.has(l) ? (n.set(o, l), !0) : !1;
    },
    release: (o, l) => {
      n.get(o) === l && n.delete(o);
    }
  }, h = /* @__PURE__ */ new Set();
  const roomFingerprint = (o) => JSON.stringify([o.roomId, o.signalingUrl, o.token]);
  function createRoomMesh(o) {
    const l = new ue({
      name: o.name ?? "solar-viewer",
      ...o,
      ...t.deps !== void 0 && o.deps === void 0 ? { deps: t.deps } : {}
    });
    fe(l, e, r);
    return { viewer: l, fingerprint: roomFingerprint(o) };
  }
  function i(o) {
    if (s.has(o.roomId)) return;
    s.set(o.roomId, createRoomMesh(o));
  }
  function closeMesh(o) {
    for (const [l, u] of [...n.entries()])
      u === o.viewer && (e.remove(l), n.delete(l));
    h.delete(o.viewer), o.viewer.leave();
  }
  function c(o) {
    const l = s.get(o);
    l !== void 0 && (closeMesh(l), s.delete(o));
  }
  function scheduleHandoffClose(o, l) {
    const u = [...n.entries()].filter(([, d]) => d === o.viewer).map(([d]) => d);
    if (u.length === 0 || l.length === 0) {
      closeMesh(o);
      return;
    }
    const deadline = Date.now() + 5e3;
    const poll = () => {
      const ready = u.every((d) => {
        const f = n.get(d);
        return f !== o.viewer && f !== void 0 && l.includes(f);
      });
      if (ready || Date.now() >= deadline) {
        closeMesh(o);
        return;
      }
      setTimeout(poll, 25);
    };
    poll();
  }
  for (const o of t.rooms) i(o);
  return {
    join: async () => {
      await Promise.all([...s.values()].map((o) => o.viewer.join()));
    },
    leave: () => {
      for (const o of [...s.keys()]) c(o);
      e.clear();
    },
    setRooms: async (o) => {
      const l = new Set(o.map((d) => d.roomId));
      const f = s.size > 0;
      const u = [], d = [], g = [];
      for (const p of o) {
        const m = s.get(p.roomId);
        if (m === void 0) {
          const y = createRoomMesh(p);
          s.set(p.roomId, y), f && h.add(y.viewer), u.push(y.viewer), d.push(p.roomId);
        } else if (m.fingerprint !== roomFingerprint(p)) {
          const y = createRoomMesh(p);
          s.set(p.roomId, y), h.add(y.viewer), u.push(y.viewer), g.push({ roomId: p.roomId, old: m, next: y });
        }
      }
      try {
        await Promise.all(u.map((p) => p.join()));
      } catch (p) {
        for (const m of g)
          s.get(m.roomId)?.viewer === m.next.viewer && (closeMesh(m.next), s.set(m.roomId, m.old));
        for (const m of d) {
          const y = s.get(m);
          y && u.includes(y.viewer) && c(m);
        }
        throw p;
      }
      for (const m of g) scheduleHandoffClose(m.old, [m.next.viewer]);
      for (const p of [...s.keys()]) {
        if (!l.has(p)) {
          const m = s.get(p);
          s.delete(p);
          if (m) scheduleHandoffClose(m, u);
        }
      }
    },
    resolvePeerStream: (o) => e.resolve(T(o)),
    subscribePeerStream: (o, l) => e.subscribe(T(o), l),
    registry: e
  };
}
`;
for (const name of runtimeDistFiles.filter((entry) => /^index-.*\.js$/.test(entry))) {
  const path = join(runtimeRoot, "dist", name);
  let source = await readFile(path, "utf8");
  if (!source.includes("const roomFingerprint") && /function se\(t\) \{/.test(source)) {
    source = source.replace(/function se\(t\) \{[\s\S]*?\n\}\nfunction qt\(t\) \{/, () => `${bundledHandoff}function qt(t) {`);
    await writeFile(path, source);
  }
}

console.log("[solar] @lumencast/runtime keeps credential-rotated rooms visible during handoff");

// A replacement MediaStream is observable before Chromium has decoded its
// first frame. Swapping the visible video at that point creates a black gap on
// both Prism Preview and the local live browser_source. Keep the old stream
// attached while a detached muted element prewarms the replacement, then make
// one receive-side presentation swap once current data is available. This is
// deliberately scoped to Solar's renderer; no Pulsar/Program or room wire is
// changed.
async function patchLivePeerVideo(path) {
  let source = await readFile(path, "utf8");
  if (source.includes("const absenceTimer")) return;
  const bundled = path.endsWith("live-peer-video.js");
  const needle = bundled
    ? /    const videoRef = useRef\(null\);[\s\S]*?    \}, \[peerLabel, resolvePeerStream, subscribePeerStream\]\);/
    : /  const videoRef = useRef<HTMLVideoElement \| null>\(null\);[\s\S]*?  \}, \[peerLabel, resolvePeerStream, subscribePeerStream\]\);/;
  const replacement = bundled
    ? String.raw`    const videoRef = useRef(null);
    const [stream, setStream] = useState(null);
    const displayedStream = useRef(null);
    const handoff = useRef(null);
    const absenceTimer = useRef(null);
    const cancelAbsence = () => {
        if (absenceTimer.current !== null) {
            clearTimeout(absenceTimer.current);
            absenceTimer.current = null;
        }
    };
    const cancelHandoff = () => {
        const pending = handoff.current;
        if (pending === null)
            return;
        if (pending.timer !== null)
            clearTimeout(pending.timer);
        pending.element.pause();
        pending.element.srcObject = null;
        pending.element.remove();
        handoff.current = null;
    };
    const publishStream = (next) => {
        cancelAbsence();
        cancelHandoff();
        displayedStream.current = next;
        setStream(next);
    };
    const handoffStream = (next) => {
        const current = displayedStream.current;
        if (next === current)
            return;
        if (next === null) {
            if (current !== null) {
                cancelHandoff();
                cancelAbsence();
                absenceTimer.current = setTimeout(() => {
                    absenceTimer.current = null;
                    if (displayedStream.current === current)
                        publishStream(null);
                }, 3e3);
                return;
            }
            publishStream(next);
            return;
        }
        if (next.getVideoTracks().length === 0)
            return;
        cancelAbsence();
        if (current === null) {
            publishStream(next);
            return;
        }
        cancelHandoff();
        const element = document.createElement("video");
        element.muted = true;
        element.autoplay = true;
        element.playsInline = true;
        element.preload = "auto";
        element.style.cssText = "position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;opacity:0;pointer-events:none";
        document.body.appendChild(element);
        element.srcObject = next;
        const pending = { element, timer: null };
        handoff.current = pending;
        const deadline = Date.now() + 3e3;
        const finish = () => {
            if (handoff.current !== pending)
                return;
            if (pending.timer !== null)
                clearTimeout(pending.timer);
            pending.element.pause();
            pending.element.srcObject = null;
            pending.element.remove();
            handoff.current = null;
            displayedStream.current = next;
            setStream(next);
        };
        const poll = () => {
            if (handoff.current !== pending)
                return;
            if (element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && element.videoWidth > 0) {
                finish();
                return;
            }
            if (Date.now() >= deadline) {
                finish();
                return;
            }
            pending.timer = setTimeout(poll, 16);
        };
        void element.play().catch(() => undefined);
        poll();
    };
    useEffect(() => {
        if (subscribePeerStream !== undefined) {
            return subscribePeerStream(peerLabel, handoffStream);
        }
        if (resolvePeerStream !== undefined) {
            handoffStream(resolvePeerStream(peerLabel));
            return;
        }
        publishStream(null);
    }, [peerLabel, resolvePeerStream, subscribePeerStream]);
     useEffect(() => cancelHandoff, []);
     useEffect(() => () => {
         cancelAbsence();
     }, []);`
    : String.raw`  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const displayedStream = useRef<MediaStream | null>(null);
  const handoff = useRef<{
    element: HTMLVideoElement;
    timer: ReturnType<typeof setTimeout> | null;
  } | null>(null);
  const absenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelAbsence = (): void => {
    if (absenceTimer.current !== null) {
      clearTimeout(absenceTimer.current);
      absenceTimer.current = null;
    }
  };

  const cancelHandoff = (): void => {
    const pending = handoff.current;
    if (pending === null) return;
    if (pending.timer !== null) clearTimeout(pending.timer);
    pending.element.pause();
    pending.element.srcObject = null;
    pending.element.remove();
    handoff.current = null;
  };

  const publishStream = (next: MediaStream | null): void => {
    cancelAbsence();
    cancelHandoff();
    displayedStream.current = next;
    setStream(next);
  };

  const handoffStream = (next: MediaStream | null): void => {
    const current = displayedStream.current;
    if (next === current) return;
    if (next === null) {
      if (current !== null) {
        cancelHandoff();
        cancelAbsence();
        absenceTimer.current = setTimeout(() => {
          absenceTimer.current = null;
          if (displayedStream.current === current) publishStream(null);
        }, 3_000);
        return;
      }
      publishStream(next);
      return;
    }
    if (next.getVideoTracks().length === 0) return;
    cancelAbsence();
    if (current === null) {
      publishStream(next);
      return;
    }

    cancelHandoff();
    const element = document.createElement("video");
    element.muted = true;
    element.autoplay = true;
    element.playsInline = true;
    element.preload = "auto";
    element.style.cssText =
      "position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;opacity:0;pointer-events:none";
    document.body.appendChild(element);
    element.srcObject = next;
    const pending = {
      element,
      timer: null as ReturnType<typeof setTimeout> | null,
    };
    handoff.current = pending;
    const deadline = Date.now() + 3_000;

    const finish = (): void => {
      if (handoff.current !== pending) return;
      if (pending.timer !== null) clearTimeout(pending.timer);
      pending.element.pause();
      pending.element.srcObject = null;
      pending.element.remove();
      handoff.current = null;
      displayedStream.current = next;
      setStream(next);
    };
    const poll = (): void => {
      if (handoff.current !== pending) return;
      if (element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && element.videoWidth > 0) {
        finish();
        return;
      }
      if (Date.now() >= deadline) {
        finish();
        return;
      }
      pending.timer = setTimeout(poll, 16);
    };
    void element.play().catch(() => undefined);
    poll();
  };

  useEffect(() => {
    if (subscribePeerStream !== undefined) {
      return subscribePeerStream(peerLabel, handoffStream);
    }
    if (resolvePeerStream !== undefined) {
      handoffStream(resolvePeerStream(peerLabel));
      return;
    }
    publishStream(null);
  }, [peerLabel, resolvePeerStream, subscribePeerStream]);

  useEffect(() => cancelHandoff, []);

  useEffect(
    () => () => {
      cancelAbsence();
    },
    [],
  );`;
  const patched = source.replace(needle, replacement);
  if (patched === source) {
    throw new Error(`unsupported @lumencast/runtime live-peer-video contract: ${path}`);
  }
  await writeFile(path, patched);
}

await patchLivePeerVideo(join(runtimeRoot, "src", "render", "primitives", "live-peer-video.tsx"));
await patchLivePeerVideo(join(runtimeRoot, "dist", "render", "primitives", "live-peer-video.js"));
console.log("[solar] @lumencast/runtime prewarms replacement peer video before visible swap");

// The published runtime also carries the tree primitive in hashed chunks. Vite
// resolves those chunks directly for the standalone host, so patch their
// inlined LivePeerVideo implementation as well as the readable source module.
const bundledLivePeerVideo = String.raw`function Lt({
  peerLabel: t,
  objectFit: e,
  muted: n
}) {
  const r = Pt(), i = r?.resolvePeerStream, o = r?.subscribePeerStream, s = n ?? !r?.liveAudio, a = at(null), [l, c] = Nt(null), u = at(null), f = at(null);
  const absenceTimer = at(null);
  const cancelAbsence = () => {
    if (absenceTimer.current !== null) {
      clearTimeout(absenceTimer.current);
      absenceTimer.current = null;
    }
  };
  const cancel = () => {
    const p = u.current;
    if (p === null) return;
    if (p.timer !== null) clearTimeout(p.timer);
    p.element.pause();
    p.element.srcObject = null;
    p.element.remove();
    u.current = null;
  };
  const m = (p) => {
    cancelAbsence();
    cancel();
    f.current = p;
    c(p);
  };
  const g = (p) => {
    const y = f.current;
    if (p === y) return;
    if (p === null) {
      if (y !== null) {
        cancel();
        cancelAbsence();
        absenceTimer.current = setTimeout(() => {
          absenceTimer.current = null;
          if (f.current === y)
            m(null);
        }, 3e3);
        return;
      }
      m(p);
      return;
    }
    if (p.getVideoTracks().length === 0)
      return;
    cancelAbsence();
    if (y === null) {
      m(p);
      return;
    }
    cancel();
    const E = document.createElement("video");
    E.muted = true;
    E.autoplay = true;
    E.playsInline = true;
    E.preload = "auto";
    E.style.cssText = "position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;opacity:0;pointer-events:none";
    document.body.appendChild(E);
    E.srcObject = p;
    const A = { element: E, timer: null };
    u.current = A;
    const R = Date.now() + 3e3;
    const N = () => {
      if (u.current !== A) return;
      if (A.timer !== null) clearTimeout(A.timer);
      A.element.pause();
      A.element.srcObject = null;
      A.element.remove();
      u.current = null;
      f.current = p;
      c(p);
    };
    const w = () => {
      if (u.current !== A) return;
      if (E.readyState >= 2 && E.videoWidth > 0 || Date.now() >= R) {
        N();
        return;
      }
      A.timer = setTimeout(w, 16);
    };
    void E.play().catch(() => void 0);
    w();
  };
  return et(() => {
    if (o !== void 0) return o(t, g);
    if (i !== void 0) {
      g(i(t));
      return;
    }
    m(null);
  }, [t, i, o]), et(() => () => {
    cancel();
    cancelAbsence();
  }, []), et(() => {
    const p = a.current;
    if (p !== null) return p.srcObject = l, () => {
      p !== null && (p.srcObject = null);
    };
  }, [l]), et(() => {
    const p = a.current;
    p !== null && (p.muted = s);
  }, [s, l]), l === null ? /* @__PURE__ */ d("div", {
    "aria-hidden": !0,
    "data-lumencast-media-live": !0,
    style: { width: "100%", height: "100%", opacity: 0, pointerEvents: "none" }
  }) : /* @__PURE__ */ d("video", {
    ref: a,
    "data-lumencast-media-live": !0,
    autoPlay: !0,
    muted: !0,
    playsInline: !0,
    style: { width: "100%", height: "100%", objectFit: e, pointerEvents: "none" }
  });
}`;

async function patchBundledLivePeerVideo(path) {
  let source = await readFile(path, "utf8");
  if (source.includes("const absenceTimer")) return;
  // Older retained runtime chunks may use a different minifier symbol (or
  // contain no peer primitive at all). They are not selected by the current
  // package entry and must remain untouched rather than making postinstall
  // fail for an orphaned cache chunk.
  if (!source.includes("data-lumencast-media-live") || !source.includes("function Lt(")) return;
  const pattern = /function Lt\(\{[\s\S]*?\n\}\nfunction Dn\(/;
  const match = source.match(pattern);
  if (!match) return;
  const replacement = `${bundledLivePeerVideo}\nfunction Dn(`;
  await writeFile(path, source.replace(pattern, replacement));
}

for (const name of (await readdir(join(runtimeRoot, "dist"))).filter((entry) => /^tree-.*\.js$/.test(entry))) {
  await patchBundledLivePeerVideo(join(runtimeRoot, "dist", name));
}
console.log("[solar] @lumencast/runtime patches bundled LivePeerVideo handoffs");
