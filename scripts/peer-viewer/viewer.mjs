import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { patchKnownPeerRoster } from "./roster.mjs";
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
// A superseded RTCPeerConnection can report `failed` / `closed` after a retry
// has already installed a fresh RemoteState for the same peer. Its late event
// must not delete the fresh state nor withdraw that peer's live stream from the
// registry. Only the RemoteState that is still current owns removal.
async function patchRemoteGenerationGuard(path) {
  let source = await readFile(path, "utf8");
  const before = source;
  {
    source = source.replace(
      /if \(pc\.connectionState === "failed" \|\| pc\.connectionState === "closed"\) \{\r?\n(\s*)this\.remotes\.delete\(peer\.id\);\r?\n\s*this\.emit\("peer-left", \{ peerId: peer\.id, peerName: peer\.name \}\);\r?\n\s*\}/g,
      'if (\n$1  (pc.connectionState === "failed" || pc.connectionState === "closed") &&\n$1  this.remotes.get(peer.id)?.pc === pc\n$1) {\n$1  this.remotes.delete(peer.id);\n$1  this.emit("peer-left", { peerId: peer.id, peerName: peer.name });\n$1}',
    );
  }
  if (!source.includes("this.remotes.get(peer.id)?.pc === pc")) {
    throw new Error(
      `unsupported @lumencast/runtime remote generation contract: ${path}`,
    );
  }
  if (source !== before) await writeFile(path, source);
}
// Chromium can expose a connected receiver with decoded frames after the
// initial `track` callback raced an identity reconciliation or registry
// subscription. Re-publishing the already-owned aggregate stream when the
// current peer connection reaches `connected` is idempotent (`registry.set`
// ignores the same stream) and restores the authored slot without creating a
// second connection, renderer, or cache.
async function patchConnectedStreamRepublish(path) {
  let source = await readFile(path, "utf8");
  const before = source;
  const connectedBlock = `      const current = this.remotes.get(peer.id);\n      if (\n        pc.connectionState === "connected" &&\n        current?.pc === pc &&\n        current.stream.getTracks().length > 0\n      ) {\n        this.emit("remote-track", {\n          peerId: peer.id,\n          peerName: current.info.name,\n          stream: current.stream,\n        });\n      }`;
  while (source.includes(`${connectedBlock}\n${connectedBlock}`)) {
    source = source.replace(
      `${connectedBlock}\n${connectedBlock}`,
      connectedBlock,
    );
  }
  {
    if (!source.includes('pc.connectionState === "connected"')) {
      source = source.replace(
        `      this.emit("connection-state", { peerId: peer.id, state: pc.connectionState });`,
        `      this.emit("connection-state", { peerId: peer.id, state: pc.connectionState });\n${connectedBlock}`,
      );
    }
  }
  const marker = 'pc.connectionState === "connected"';
  if (!source.includes(marker)) {
    throw new Error(
      `unsupported @lumencast/runtime connected stream contract: ${path}`,
    );
  }
  if (source !== before) await writeFile(path, source);
}
// The signaling server may announce a stale `peer-left` while the current
// RTCPeerConnection is still connected and decoding frames (for example while
// the publisher is replaced under the same authored label). Do not tear down a
// live aggregate on that transient control message; the connection-state
// terminal event remains the authoritative cleanup path. A replacement peer
// can take the label through the registry generation guard below.
async function patchStalePeerLeave(path) {
  let source = await readFile(path, "utf8");
  const before = source;
  if (path.endsWith("meet-viewer.js")) {
    source = source.replace(
      `            case "peer-left": {\n                this.knownPeers.delete(msg.peerId);\n                const remote = this.remotes.get(msg.peerId);\n                if (remote) {\n                    // The pc owns the tracks — closing it ends them. The registry/consumer\n                    // are notified via the peer-left event (label-keyed).\n                    remote.pc.close();\n                    this.remotes.delete(msg.peerId);\n                    this.emit("peer-left", { peerId: msg.peerId, peerName: remote.info.name });\n                }\n                break;\n            }`,
      `            case "peer-left": {\n                this.knownPeers.delete(msg.peerId);\n                const remote = this.remotes.get(msg.peerId);\n                if (remote) {\n                    // Keep a still-connected aggregate alive. The terminal connection\n                    // event performs authoritative cleanup after a real disconnect.\n                    if (remote.pc.connectionState !== "connected" || remote.stream.getTracks().length === 0) {\n                        remote.pc.close();\n                        this.remotes.delete(msg.peerId);\n                        this.emit("peer-left", { peerId: msg.peerId, peerName: remote.info.name });\n                    }\n                }\n                break;\n            }`,
    );
  } else {
    const sourceNeedle = `      case "peer-left": {\n        this.knownPeers.delete(msg.peerId);\n        const remote = this.remotes.get(msg.peerId);\n        if (remote) {\n          // The pc owns the tracks — closing it ends them. The registry/consumer\n          // are notified via the peer-left event (label-keyed).\n          remote.pc.close();\n          this.remotes.delete(msg.peerId);\n          this.emit("peer-left", { peerId: msg.peerId, peerName: remote.info.name });\n        }\n        break;\n      }`;
    const sourceReplacement = `      case "peer-left": {\n        this.knownPeers.delete(msg.peerId);\n        const remote = this.remotes.get(msg.peerId);\n        if (remote) {\n          // Keep a still-connected aggregate alive. The terminal connection\n          // event performs authoritative cleanup after a real disconnect.\n          if (remote.pc.connectionState !== "connected" || remote.stream.getTracks().length === 0) {\n            remote.pc.close();\n            this.remotes.delete(msg.peerId);\n            this.emit("peer-left", { peerId: msg.peerId, peerName: remote.info.name });\n          }\n        }\n        break;\n      }`;
    source = source.replace(sourceNeedle, sourceReplacement);
  }
  if (
    !source.includes("connectionState") ||
    !source.includes("stream.getTracks().length")
  ) {
    throw new Error(
      `unsupported @lumencast/runtime stale peer-leave contract: ${path}`,
    );
  }
  if (source !== before) await writeFile(path, source);
}
// Recover a viewer leg after a relay/ICE failure. Late trickle candidates are
// ignored until a fresh offer creates the next generation; otherwise an orphan
// ICE packet leaves a `new` RTCPeerConnection that can never carry a camera.
async function patchViewerRecovery(path) {
  let source = await readFile(path, "utf8");
  const before = source;
  const recovered =
    source.includes("this.clearRemoteRetry(peer.id);") &&
    source.includes("this.scheduleRemoteRetry(current?.info ?? peer);");
  if (recovered && source.includes("retryTimers = ")) return;
  {
    const field = "    knownPeers = new Map();";
    source = source.replace(
      field,
      `${field}\n    retryTimers = new Map();\n    retryAttempts = new Map();`,
    );
    const tearDown =
      "    tearDown() {\n        for (const r of this.remotes.values())\n            r.pc.close();";
    source = source.replace(
      tearDown,
      "    tearDown() {\n        for (const timer of this.retryTimers.values()) clearTimeout(timer);\n        this.retryTimers.clear();\n        this.retryAttempts.clear();\n        for (const r of this.remotes.values())\n            r.pc.close();",
    );
    const signalNeedle =
      '        if (!remote) {\n            remote = this.ensureRemote(this.knownPeers.get(from) ?? { id: from, name: from.slice(0, 8), role: "publisher" });';
    source = source.replace(
      signalNeedle,
      '        if (!remote) {\n            if (payload.kind === "ice") return;\n            remote = this.ensureRemote(this.knownPeers.get(from) ?? { id: from, name: from.slice(0, 8), role: "publisher" });',
    );
    const helper =
      '    scheduleRemoteRetry(peer) {\n        if (!this.knownPeers.has(peer.id) || this.retryTimers.has(peer.id)) return;\n        const attempt = (this.retryAttempts.get(peer.id) ?? 0) + 1;\n        if (attempt > 3) return;\n        const delay = Math.min(1000, 250 * 2 ** (attempt - 1));\n        const timer = setTimeout(() => {\n            this.retryTimers.delete(peer.id);\n            if (!this.knownPeers.has(peer.id) || this.remotes.has(peer.id) || this.ws?.readyState !== this.deps.WebSocket.OPEN) return;\n            this.retryAttempts.set(peer.id, attempt);\n            const remote = this.ensureRemote(this.knownPeers.get(peer.id) ?? peer);\n            void this.dialRemote(peer.id, remote);\n        }, delay);\n        this.retryTimers.set(peer.id, timer);\n    }\n    clearRemoteRetry(peerId) {\n        const timer = this.retryTimers.get(peerId);\n        if (timer !== undefined) {\n            clearTimeout(timer);\n            this.retryTimers.delete(peerId);\n        }\n        this.retryAttempts.delete(peerId);\n    }\n    async dialRemote(peerId, expected) {\n        const remote = this.remotes.get(peerId);\n        if (!remote || expected !== undefined && remote !== expected || remote.makingOffer || remote.pc.signalingState !== "stable") return;\n        try {\n            remote.makingOffer = true;\n            await remote.pc.setLocalDescription();\n            if (remote.pc.localDescription) this.sendSignal(peerId, { kind: "sdp", description: { type: remote.pc.localDescription.type, sdp: remote.pc.localDescription.sdp } });\n        } catch {\n        } finally {\n            remote.makingOffer = false;\n        }\n    }\n';
    const helperNeedle =
      "    /* ---- Helpers ------------------------------------------------------ */";
    source = source.replace(helperNeedle, `${helper}${helperNeedle}`);
  }
  {
    if (!source.includes("this.clearRemoteRetry(peer.id);")) {
      const connected =
        /(current\.stream\.getTracks\(\)\.length > 0\s*\) \{\s*)(this\.emit\("remote-track")/;
      if (!connected.test(source)) {
        throw new Error(
          `unsupported @lumencast/runtime connected recovery contract: ${path}`,
        );
      }
      source = source.replace(
        connected,
        "$1this.clearRemoteRetry(peer.id);\n        $2",
      );
    }
    if (!source.includes("this.scheduleRemoteRetry(current?.info ?? peer);")) {
      const terminal =
        /(^[ \t]*)this\.remotes\.delete\(peer\.id\);\r?\n[ \t]*this\.emit\("peer-left", \{ peerId: peer\.id, peerName: peer\.name \}\);/m;
      if (!terminal.test(source)) {
        throw new Error(
          `unsupported @lumencast/runtime terminal recovery contract: ${path}`,
        );
      }
      source = source.replace(terminal, (_match, indent) =>
        [
          `${indent}const current = this.remotes.get(peer.id);`,
          `${indent}this.remotes.delete(peer.id);`,
          `${indent}pc.close();`,
          `${indent}this.emit("peer-left", { peerId: peer.id, peerName: current?.info.name ?? peer.name });`,
          `${indent}this.scheduleRemoteRetry(current?.info ?? peer);`,
        ].join("\n"),
      );
    }
  }
  if (
    !source.includes("scheduleRemoteRetry") ||
    !source.includes("this.clearRemoteRetry(peer.id);") ||
    !source.includes("this.scheduleRemoteRetry(current?.info ?? peer);")
  ) {
    throw new Error(
      `unsupported @lumencast/runtime viewer recovery contract: ${path}`,
    );
  }
  if (source !== before) await writeFile(path, source);
}
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
  {
    source = source.replace(
      /await remote\.pc\.setLocalDescription\(\);/g,
      "const offer = await remote.pc.createOffer();\n      await remote.pc.setLocalDescription(offer);",
    );
  }
  if (
    !source.includes("pc.createOffer()") ||
    !source.includes("setLocalDescription(offer)")
  ) {
    throw new Error(
      `unsupported @lumencast/runtime viewer retry-offer contract: ${path}`,
    );
  }
  if (source !== before) await writeFile(path, source);
}
// A retry offer can cross a publisher-owned retry offer in flight.  MeetViewer
// is receive-only in production, so the publisher's offer is authoritative:
// make the viewer polite and explicitly roll back its own retry offer before
// accepting that fresh publisher offer.  This keeps a failed slot from being
// stranded in `have-local-offer` while preserving the initial one-way dial.
async function patchViewerRetryCollision(path) {
  let source = await readFile(path, "utf8");
  const before = source;
  {
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
    !source.includes('setLocalDescription({ type: "rollback" })') &&
    !source.includes('setLocalDescription({type:"rollback"})')
  ) {
    throw new Error(
      `unsupported @lumencast/runtime viewer retry-collision contract: ${path}`,
    );
  }
  if (source !== before) await writeFile(path, source);
}
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
  {
    const hasMessageQueueField =
      /^\s+messageQueue = Promise\.resolve\(\);/m.test(source);
    if (!hasMessageQueueField) {
      const field = "    retryAttempts = new Map();";
      const replacement = `${field}\n    messageQueue = Promise.resolve();`;
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
    throw new Error(
      `unsupported @lumencast/runtime viewer message contract: ${path}`,
    );
  }
  if (source !== before) await writeFile(path, source);
}
// A publisher retry can deliver a fresh SDP offer while Solar still holds the
// previous failed/closed receiver generation.  Passing that offer to the
// terminal RTCPeerConnection is rejected by Chromium, leaving the authored
// camera slot empty.  Drop only that stale generation before accepting a new
// offer; the receive-only viewer remains the answerer and the wire contract is
// unchanged.
async function patchViewerStaleOfferGeneration(path) {
  let source = await readFile(path, "utf8");
  const before = source;
  {
    const signalPattern =
      /(\n[ \t]*)let remote = this\.remotes\.get\(from\);\r?\n([ \t]*)if \(!remote\) \{/;
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
  if (
    !source.includes('connectionState === "failed"') ||
    !source.includes("remote = undefined;") ||
    false
  ) {
    throw new Error(
      `unsupported @lumencast/runtime stale viewer offer contract: ${path}`,
    );
  }
  if (source !== before) await writeFile(path, source);
}
async function patchViewerRecoveryTerminal(path) {
  let source = await readFile(path, "utf8");
  const before = source;
  if (source.includes("this.scheduleRemoteRetry(current?.info ?? peer)"))
    return;
  const connectedNeedle =
    '            this.emit("remote-track", {\\n                peerId: peer.id,\\n                peerName: current.info.name,\\n                stream: current.stream,\\n            });';
  const connectedReplacement =
    '            this.clearRemoteRetry(peer.id);\\n            this.emit("remote-track", {\\n                peerId: peer.id,\\n                peerName: current.info.name,\\n                stream: current.stream,\\n            });';
  source = source.replace(connectedNeedle, connectedReplacement);
  const terminalNeedle =
    '                this.remotes.delete(peer.id);\\n                this.emit("peer-left", { peerId: peer.id, peerName: peer.name });';
  const terminalReplacement =
    '                const current = this.remotes.get(peer.id);\\n                this.remotes.delete(peer.id);\\n                pc.close();\\n                this.emit("peer-left", { peerId: peer.id, peerName: current?.info.name ?? peer.name });\\n                this.scheduleRemoteRetry(current?.info ?? peer);';
  source = source.replace(terminalNeedle, terminalReplacement);
  if (source !== before) await writeFile(path, source);
}
export async function patchViewer(runtimeRoot) {
  await upgradeIdentityMutation(
    join(runtimeRoot, "dist", "webrtc", "meet-viewer.js"),
  );
  await patchRuntimeFile(
    join(runtimeRoot, "dist", "webrtc", "meet-viewer.js"),
    identityDistNeedle,
    identityDistReplacement,
  );
  await patchKnownPeerRoster(
    join(runtimeRoot, "dist", "webrtc", "meet-viewer.js"),
  );
  await patchRemoteGenerationGuard(
    join(runtimeRoot, "dist", "webrtc", "meet-viewer.js"),
  );
  await patchConnectedStreamRepublish(
    join(runtimeRoot, "dist", "webrtc", "meet-viewer.js"),
  );
  await patchStalePeerLeave(
    join(runtimeRoot, "dist", "webrtc", "meet-viewer.js"),
  );
  await patchViewerRecovery(
    join(runtimeRoot, "dist", "webrtc", "meet-viewer.js"),
  );
  await patchViewerRetryOffer(
    join(runtimeRoot, "dist", "webrtc", "meet-viewer.js"),
  );
  await patchViewerRetryCollision(
    join(runtimeRoot, "dist", "webrtc", "meet-viewer.js"),
  );
  await patchViewerMessageSerialization(
    join(runtimeRoot, "dist", "webrtc", "meet-viewer.js"),
  );
  await patchViewerStaleOfferGeneration(
    join(runtimeRoot, "dist", "webrtc", "meet-viewer.js"),
  );
  await patchViewerRecoveryTerminal(
    join(runtimeRoot, "dist", "webrtc", "meet-viewer.js"),
  );
}
