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
if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
  throw new Error(`invalid Solar tag: ${tag}`);
}

const archive = readFileSync(archivePath);
const artifactSha256 = createHash("sha256").update(archive).digest("hex");
const manifest = {
  schema_version: "solar.runtime.manifest.v1",
  version,
  protocol_version: "solar.host.v1",
  artifact_url: `https://github.com/${repository}/releases/download/${tag}/solar-${tag}.tgz`,
  artifact_sha256: artifactSha256,
};

writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`created ${outputPath} for Solar ${version} (${artifactSha256})`);
