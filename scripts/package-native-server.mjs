import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    binary: { type: "string" },
    platform: { type: "string" },
    revision: { type: "string" },
  },
});
const platformPattern = /^(win32|linux|darwin)-(x64|arm64)$/;
const revisionPattern = /^[a-f0-9]{40}$/;
const digestPattern = /^[a-f0-9]{64}$/;
if (
  !values.binary?.trim() ||
  !platformPattern.test(values.platform ?? "") ||
  !revisionPattern.test(values.revision ?? "")
)
  throw new Error(
    "Usage: package-native-server --binary <lsdpd> --platform <win32-x64> --revision <source-sha>",
  );

const key = values.platform;
const name = key.startsWith("win32-") ? "lsdpd.exe" : "lsdpd";
const binary = await readFile(resolve(values.binary));
const root = resolve("dist/native");
const manifestPath = resolve(root, "manifest.json");
let previous;
try {
  previous = JSON.parse(await readFile(manifestPath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

if (previous !== undefined) {
  if (
    !previous ||
    typeof previous !== "object" ||
    Array.isArray(previous) ||
    previous.schema !== "solar.native-server.v1" ||
    previous.wire !== "LSDP-TCP/2.0-draft2" ||
    !revisionPattern.test(previous.source_revision ?? "") ||
    !previous.binaries ||
    typeof previous.binaries !== "object" ||
    Array.isArray(previous.binaries) ||
    Object.keys(previous.binaries).length === 0
  )
    throw new Error("Invalid existing native package manifest.");

  if (previous.source_revision !== values.revision)
    throw new Error(
      "All packaged platforms must use the same native source revision.",
    );

  for (const [platform, entry] of Object.entries(previous.binaries)) {
    const filename = platform.startsWith("win32-") ? "lsdpd.exe" : "lsdpd";
    if (
      !platformPattern.test(platform) ||
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      entry.file !== platform + "/" + filename ||
      !digestPattern.test(entry.sha256 ?? "")
    )
      throw new Error("Invalid existing native package manifest.");

    const packagedBytes = await readFile(resolve(root, entry.file));
    const actualDigest = createHash("sha256")
      .update(packagedBytes)
      .digest("hex");
    if (actualDigest !== entry.sha256)
      throw new Error(
        "Existing native binary digest mismatch for " + platform + ".",
      );
  }
}

const target = resolve(root, key, name);
const manifest = {
  schema: "solar.native-server.v1",
  wire: "LSDP-TCP/2.0-draft2",
  source_revision: values.revision,
  binaries: {
    ...previous?.binaries,
    [key]: {
      file: key + "/" + name,
      sha256: createHash("sha256").update(binary).digest("hex"),
    },
  },
};

await mkdir(dirname(target), { recursive: true });
await writeFile(target, binary);
await chmod(target, 0o755);
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(
  JSON.stringify({
    platform: key,
    revision: values.revision,
    sha256: manifest.binaries[key].sha256,
  }),
);
