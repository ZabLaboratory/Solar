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
