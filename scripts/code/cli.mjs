import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sourceGraph, codeMap } from "./graph.mjs";
const root = resolve(import.meta.dirname, "../..");
const [mode = "read", query = ""] = process.argv.slice(2);
const graph = sourceGraph(root);
const path = resolve(root, "docs/development/code-map.md");
if (mode === "map") {
  writeFileSync(path, codeMap(graph));
  console.log(`Mapped ${graph.source_files} source files.`);
} else if (mode === "check") {
  if (readFileSync(path, "utf8").replaceAll("\r\n", "\n") !== codeMap(graph))
    throw new Error("Code map is stale; run npm run code:map.");
  console.log(`Code map is current: ${graph.source_files} files.`);
} else if (mode === "read" || mode === "find") {
  const matches = graph.files.filter((file) =>
    JSON.stringify(file).toLowerCase().includes(query.toLowerCase()),
  );
  console.log(
    JSON.stringify({ limits: graph.limits, files: matches }, null, 2),
  );
} else throw new Error("Expected map, check, read or find.");
