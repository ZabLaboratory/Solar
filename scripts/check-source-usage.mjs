import { resolve } from "node:path";
import { sourceGraph } from "./code/graph.mjs";
const graph = sourceGraph(resolve(import.meta.dirname, ".."));
const report = { ...graph };
delete report.files;
console.log(JSON.stringify(report, null, 2));
if (
  graph.unused.length ||
  graph.unusedExports.length ||
  graph.unusedDependencies.length ||
  graph.problems.length
)
  process.exitCode = 1;
