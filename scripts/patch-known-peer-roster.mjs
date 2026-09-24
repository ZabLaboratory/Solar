import { readFile, writeFile } from "node:fs/promises";

// Keep the authoritative peer roster available when signaling overtakes
// peer-joined, across both readable runtime modules and bundled distributions.
export async function patchKnownPeerRoster(path) {
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
    throw new Error(
      `unsupported @lumencast/runtime known-peer contract: ${path}`,
    );
  }
  if (source !== before) await writeFile(path, source);
}
