import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const [archivePath, version, repository, tag, outputPath] =
  process.argv.slice(2);

if (!archivePath || !version || !repository || !tag || !outputPath) {
  throw new Error(
    "usage: node scripts/create-runtime-manifest.mjs <archive> <version> <repository> <tag> <output>",
  );
}
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`invalid Solar version: ${version}`);
}
if (!/^v\d+\.\d+\.\d+[A-Za-z0-9.-]*$/.test(tag)) {
  throw new Error(`invalid Solar tag: ${tag}`);
}

const archive = readFileSync(archivePath);
// A browser-only archive cannot satisfy the installed reception contract.
// The release assembly must package platform binaries after the browser build.
const native = JSON.parse(readFileSync("dist/native/manifest.json", "utf8"));
if (
  native.schema !== "solar.native-server.v1" ||
  !native.binaries?.["win32-x64"] ||
  !native.binaries?.["linux-x64"]
)
  throw new Error(
    "Solar release requires native Windows/Linux receiver binaries.",
  );
const artifactSha256 = createHash("sha256").update(archive).digest("hex");
const manifest = {
  schema_version: "solar.runtime.manifest.v1",
  component: "solar",
  version,
  release_tag: tag,
  protocol_version: "solar.host.v1",
  artifact_url: `https://github.com/${repository}/releases/download/${tag}/solar-${tag}.tgz`,
  artifact_sha256: artifactSha256,
  native_server: {
    wire: native.wire,
    source_revision: native.source_revision,
    platforms: Object.keys(native.binaries),
  },
};

writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`created ${outputPath} for Solar ${version} (${artifactSha256})`);
