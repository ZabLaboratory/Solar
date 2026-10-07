import { readFile, writeFile } from "node:fs/promises";
// Keep the authoritative peer roster available when signaling overtakes
// peer-joined, in the consumed receive-only entry.
export async function patchKnownPeerRoster(path) {
  let source = await readFile(path, "utf8");
  const before = source;
  if (!source.includes("knownPeers =")) {
    source = source.replace(
      /(remotes = new Map\(\);)/,
      "$1\n    knownPeers = new Map();",
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
  if (
    !source.includes("knownPeers") ||
    !source.includes("this.knownPeers.get(") ||
    !source.includes("this.knownPeers.set(")
  ) {
    throw new Error(
      `unsupported @lumencast/runtime known-peer contract: ${path}`,
    );
  }
  if (source !== before) await writeFile(path, source);
}
