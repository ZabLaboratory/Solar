import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { canonicalize } from "@lumencast/canonical";
import { zipSync, strToU8 } from "fflate";
import { kumikiScene } from "./scene.mjs";
const out = resolve(process.argv[2]);
const vectors = JSON.parse(
  await readFile(resolve(out, "vectors.json"), "utf8"),
);
const scene = kumikiScene(vectors);
const document = {
  lsml: "1.2",
  scene_id: "kumiki-unweave",
  scene_version: `sha256:${"0".repeat(64)}`,
  viewport: { width: scene.width, height: scene.height },
  defaults: {},
  layout: {
    kind: "frame",
    id: "stage",
    size: { w: scene.width, h: scene.height },
    background: "#08090b",
    clipsContent: true,
    children: scene.children,
  },
  animations: scene.animations,
};
document.scene_version = `sha256:${createHash("sha256").update(canonicalize(document)).digest("hex")}`;
const json = canonicalize(document);
await mkdir(out, { recursive: true });
await writeFile(resolve(out, "sponsor-motion.lsml"), json);
await writeFile(
  resolve(out, "sponsor-motion.lsmlz"),
  zipSync({ "scene.lsml": strToU8(json) }),
);
await writeFile(
  resolve(out, "catalogue.json"),
  JSON.stringify(
    {
      width: scene.width,
      height: scene.height,
      duration_ms: scene.duration,
      title: "Kumiki — Many systems. One motion.",
      slug: scene.slug,
      description: scene.description,
      minimum_render_rate: scene.minimumRenderRate,
      capture: scene.capture,
      animations: ["show"],
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    scene: document.scene_id,
    version: document.scene_version,
    bytes: json.length,
    out,
  }),
);
