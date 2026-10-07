import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import test from "node:test";
import { sourceGraph } from "../../scripts/code/graph.mjs";
import { documentationReport } from "../../scripts/code/documentation.mjs";
const base = resolve(import.meta.dirname, "../../build");
mkdirSync(base, { recursive: true });
function fixture(run) {
  const root = mkdtempSync(join(base, "architecture-"));
  assert.ok(root.startsWith(base + sep));
  const put = (path, text) => {
    mkdirSync(resolve(root, path, ".."), { recursive: true });
    writeFileSync(resolve(root, path), text);
  };
  try {
    put(
      "package.json",
      JSON.stringify({
        dependencies: {},
        scripts: { check: "node check.mjs" },
      }),
    );
    put("README.md", "# Fixture\n");
    put("index.html", '<script src="/src/dev-entry.ts"></script>');
    put("host.html", '<script src="/src/host-entry.ts"></script>');
    put("src/index.ts", "export {};\n");
    put("src/server/index.ts", "export {};\n");
    put("src/dev-entry.ts", "export {};\n");
    put("src/host-entry.ts", "export {};\n");
    put("scripts/README.md", "# Tools\n");
    run({ root, put });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("test imports cannot retain an orphan or an unused product export", () =>
  fixture(({ root, put }) => {
    put("src/used.ts", "export const live = 1; export const testOnly = 2;\n");
    put("src/index.ts", 'export {live} from "./used";\n');
    put("src/orphan.ts", "export const orphan = 1;\n");
    put(
      "tests/test.ts",
      'import {testOnly} from "../src/used"; import {orphan} from "../src/orphan"; void testOnly; void orphan;\n',
    );
    const graph = sourceGraph(root);
    assert.deepEqual(graph.unused, ["src/orphan.ts"]);
    assert.ok(graph.unusedExports.some((e) => e.name === "testOnly"));
  }));
test("worker is reached through its actual URL edge and disappears when that edge is removed", () =>
  fixture(({ root, put }) => {
    put("src/worker.ts", "postMessage(1);\n");
    put(
      "src/host-entry.ts",
      'new Worker(new URL("./worker.ts", import.meta.url));\n',
    );
    assert.deepEqual(sourceGraph(root).unused, []);
    put("src/host-entry.ts", "export {};\n");
    assert.deepEqual(sourceGraph(root).unused, ["src/worker.ts"]);
  }));
test("public type aliases/re-exports remain contracts and broken imports/dependencies fail", () =>
  fixture(({ root, put }) => {
    put("src/contract.ts", "export interface Contract { value: number }\n");
    put("src/index.ts", 'export type {Contract} from "./contract";\n');
    assert.deepEqual(sourceGraph(root).unusedExports, []);
    put("src/host-entry.ts", 'import "./missing";\n');
    put(
      "package.json",
      JSON.stringify({
        dependencies: { unused: "1" },
        scripts: { check: "node check.mjs" },
      }),
    );
    const report = sourceGraph(root);
    assert.ok(report.problems.some((p) => p.includes("missing")));
    assert.deepEqual(report.unusedDependencies, ["unused"]);
  }));
test("documentation detects broken links/headings, commands, paths and unowned tools", () =>
  fixture(({ root, put }) => {
    put(
      "README.md",
      "# Fixture\n[bad](absent.md)\n[self](README.md#absent)\n`npm run absent`\n`src/absent.ts`\nnode scripts/absent.mjs --input fixture\n",
    );
    put("scripts/orphan.mjs", "export {};\n");
    const report = documentationReport(root);
    for (const fragment of [
      "broken link",
      "missing heading",
      "missing npm command",
      "missing current path",
      "missing current tool",
      "missing from its responsibility README",
    ])
      assert.ok(
        report.failures.some((p) => p.includes(fragment)),
        fragment,
      );
  }));
test("historical evidence and external repository commands stay outside Solar documentation checks", () =>
  fixture(({ root, put }) => {
    put("docs/adr/old.md", "[old](absent.md)\n`npm run absent`\n");
    put("evidence/old.md", "[old](absent.md)\n");
    put("README.md", "# Fixture\nZabCanvas/scripts/prove-vision-source.py\n");
    assert.deepEqual(documentationReport(root).failures, []);
  }));
