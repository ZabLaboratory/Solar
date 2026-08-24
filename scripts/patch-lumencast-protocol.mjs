import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const packageRoot = join(root, "node_modules", "@lumencast", "protocol");
const targets = [
  join(packageRoot, "src", "host-allow.ts"),
  join(packageRoot, "dist", "host-allow.js"),
];
const current = "const MAX_URL_LEN = 8192;";
const patched = "const MAX_URL_LEN = 262144;";

for (const path of targets) {
  let source;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`@lumencast/protocol target missing: ${path}`, { cause: error });
  }
  if (source.includes(current)) {
    await writeFile(path, source.replace(current, patched));
    continue;
  }
  if (source.includes(patched)) continue;
  throw new Error(`unsupported @lumencast/protocol host-allow contract: ${path}`);
}

console.log("[solar] @lumencast/protocol local render image limit=262144");

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
