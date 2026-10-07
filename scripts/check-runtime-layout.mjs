import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(process.argv[2] ?? resolve(root, "dist"));
const source = resolve(process.argv[3] ?? resolve(root, "public/vision"));
const host = resolve(dist, "host");
if (!existsSync(resolve(host, "index.html"))) {
  throw new Error("Solar standalone host is missing: host/index.html.");
}

// Prism promotes host/* into the runtime root and rejects every collision.
// The producer must satisfy that existing contract, even for identical bytes.
for (const entry of readdirSync(host)) {
  if (existsSync(resolve(dist, entry))) {
    throw new Error(`Solar runtime layout collision: host/${entry} and ${entry}.`);
  }
}

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    if (!entry.isFile()) {
      throw new Error(`Unsupported Solar artifact entry: ${path}.`);
    }
    return [path];
  });
}

const originals = filesUnder(source);
if (originals.length === 0) throw new Error("Solar Vision source assets are missing.");
const emitted = filesUnder(dist);
for (const original of originals) {
  const asset = relative(source, original);
  const expected = resolve(host, "vision", asset);
  if (!existsSync(expected)) {
    throw new Error(`Solar Vision asset is missing: host/vision/${asset}.`);
  }
  const copies = emitted.filter((file) => basename(file) === basename(original));
  if (copies.length !== 1 || copies[0] !== expected) {
    throw new Error(`Solar Vision asset must be emitted once: ${asset} (${copies.length} copies).`);
  }
  if (!readFileSync(original).equals(readFileSync(expected))) {
    throw new Error(`Solar Vision asset differs from its source: ${asset}.`);
  }
}

console.log(`Solar runtime layout verified: ${originals.length} Vision assets, one copy each under host/vision, no host/root collision.`);
