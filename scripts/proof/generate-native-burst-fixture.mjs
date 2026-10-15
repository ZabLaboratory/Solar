import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { bundleAddress, canonicalize } from "@lumencast/canonical";
import { zipSync } from "fflate";

const output = resolve(
  process.argv[2] ?? "fixtures/native-burst/native-burst.lsmlz",
);
const document = {
  lsml: "1.1",
  scene_id: "native-burst-qualification",
  scene_version: "",
  viewport: { width: 1280, height: 720 },
  layout: {
    kind: "frame",
    id: "root",
    size: { w: 1280, h: 720 },
    background: "#101820",
    children: [
      {
        kind: "text",
        id: "mutation-counter",
        value: "0000/0512",
        position: { x: 60, y: 245 },
        size: { w: 1160, h: 210 },
        style: {
          color: "#ffffff",
          fontFamily: "Figtree",
          fontSize: 144,
          fontWeight: 700,
          lineHeight: 1,
        },
        bind: { value: "__lit.text.text_msxz43eh_1" },
      },
    ],
  },
  defaults: { "__lit.text.text_msxz43eh_1": "0000/0512" },
};
document.scene_version = await bundleAddress(document);

const source = Buffer.from(canonicalize(document), "utf8");
const archive = zipSync(
  { "scene.lsml": source },
  { level: 0, mtime: new Date("1980-01-01T00:00:00.000Z") },
);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, archive);
await writeFile(resolve(dirname(output), "native-burst.lsml"), source);
process.stdout.write(
  JSON.stringify({
    output,
    sceneId: document.scene_id,
    sceneVersion: document.scene_version,
    sourceSha256: createHash("sha256").update(source).digest("hex"),
    archiveSha256: createHash("sha256").update(archive).digest("hex"),
    sourceBytes: source.length,
    archiveBytes: archive.length,
  }) + "\n",
);
