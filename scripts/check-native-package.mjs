import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
const required = process.argv.slice(2);
if (!required.length) required.push(`${process.platform}-${process.arch}`);
const root = resolve("dist/native");
const manifest = JSON.parse(
  await readFile(resolve(root, "manifest.json"), "utf8"),
);
if (
  manifest.schema !== "solar.native-server.v1" ||
  manifest.wire !== "LSDP-TCP/2.0-draft2" ||
  !/^[a-f0-9]{40}$/.test(manifest.source_revision)
)
  throw new Error("Invalid native package manifest.");
for (const platform of required) {
  if (!/^(win32|linux|darwin)-(x64|arm64)$/.test(platform))
    throw new Error("Invalid native package platform.");
  const entry = manifest.binaries[platform];
  const filename = `${platform}/${platform.startsWith("win32-") ? "lsdpd.exe" : "lsdpd"}`;
  if (entry?.file !== filename)
    throw new Error(`Native package missing platform ${platform}.`);
  const hash = createHash("sha256")
    .update(await readFile(resolve(root, filename)))
    .digest("hex");
  if (hash !== entry.sha256)
    throw new Error(`Native binary digest mismatch for ${platform}.`);
}
console.log(
  JSON.stringify({
    result: "PASS",
    sourceRevision: manifest.source_revision,
    platforms: required,
  }),
);
