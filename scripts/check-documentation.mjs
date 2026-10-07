import { resolve } from "node:path";
import { documentationReport } from "./code/documentation.mjs";
const report = documentationReport(resolve(import.meta.dirname, ".."));
console.log(JSON.stringify(report, null, 2));
if (report.failures.length) process.exitCode = 1;
