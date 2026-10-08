import { createHash } from "node:crypto";
import { copyFile, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
const { values } = parseArgs({
  options: {
    binary: { type: "string" },
    platform: { type: "string" },
    revision: { type: "string" },
  },
});
if (
  !values.binary ||
  !/^(win32|linux|darwin)-(x64|arm64)$/.test(values.platform ?? "") ||
  !/^[a-f0-9]{40}$/.test(values.revision ?? "")
)
  throw new Error(
    "Usage: package-native-server --binary <lsdpd> --platform <win32-x64> --revision <source-sha>",
  );
const key = values.platform,
  name = key.startsWith("win32-") ? "lsdpd.exe" : "lsdpd";
const target = resolve("dist/native", key, name);
await mkdir(dirname(target), { recursive: true });
await copyFile(resolve(values.binary), target);
await chmod(target, 0o755);
const manifestPath = resolve("dist/native/manifest.json");
let previous;
try {
  previous = JSON.parse(await readFile(manifestPath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (previous && previous.source_revision !== values.revision)
  throw new Error(
    "All packaged platforms must use the same native source revision.",
  );
const manifest = {
  schema: "solar.native-server.v1",
  wire: "LSDP-TCP/2.0-draft2",
  source_revision: values.revision,
  binaries: {
    ...previous?.binaries,
    [key]: {
      file: `${key}/${name}`,
      sha256: createHash("sha256")
        .update(await readFile(target))
        .digest("hex"),
    },
  },
};
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(
  JSON.stringify({
    platform: key,
    revision: values.revision,
    sha256: manifest.binaries[key].sha256,
  }),
);
