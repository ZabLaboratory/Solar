// Two source-derived, closed arrow ribbons interlock into the exact Z master.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { zipSync, strToU8 } from "fflate";
import { canonicalize } from "@lumencast/canonical";

const out = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw Error("Usage: node scripts/z-bug/generate.mjs <explicit-output-directory>");
await mkdir(out, { recursive: true });
const vectors = JSON.parse(await readFile(resolve(out, "assets/vectors.json"), "utf8"));
const width = 1920, height = 1080, duration = 3600;
const key = (ms, values, easing = "cubic-bezier(.2,.8,.2,1)") => ({ at: ms / duration, ...values, easing });
const position = { x: 112, y: height - 52 - 189 };
const size = { w: 180, h: 189 };
const arrow = name => ({ kind: "shape", id: name, geometry: "path",
  pathData: vectors[name].pathData, windingRule: "EVENODD",
  position, size, fill: vectors[name].fill });
const final = { ...arrow("master"), id: "z-master", opacity: 0,
  stroke: { color: vectors.master.fill, width: .85, lineJoin: "round" } };
const track = (target, steps) => ({ target, keyframes: { duration_ms: duration, steps } });
const left = [
  key(0, { translateX: -73, translateY: -73, rotation: -15, scale: .96, opacity: 1 }),
  key(260, { translateX: -88, translateY: -84, rotation: -8, scale: 1.025 }),
  key(650, { translateX: -58, translateY: -48, rotation: 4, scale: 1.01 }),
  key(930, { translateX: -68, translateY: -57, rotation: -7, scale: .98 }),
  key(1250, { translateX: -49, translateY: -41, rotation: -3, scale: 1, opacity: 1 }),
  key(1370, { translateX: -42, translateY: -35, rotation: -2, scale: 1, opacity: 1 }),
  key(1395, { translateX: -7, translateY: -6, rotation: 0, scale: .52, opacity: 0 }, "cubic-bezier(.65,0,.9,.45)"),
  key(duration, { translateX: 0, translateY: 0, rotation: 0, scale: 1, opacity: 0 }),
];
const right = [
  key(0, { translateX: 80, translateY: 34, rotation: 16, scale: .96, opacity: 1 }),
  key(280, { translateX: 92, translateY: 42, rotation: 9, scale: 1.025 }),
  key(670, { translateX: 62, translateY: 34, rotation: -4, scale: 1.01 }),
  key(950, { translateX: 72, translateY: 40, rotation: 7, scale: .98 }),
  key(1270, { translateX: 51, translateY: 30, rotation: 3, scale: 1, opacity: 1 }),
  key(1370, { translateX: 44, translateY: 27, rotation: 2, scale: 1, opacity: 1 }),
  key(1395, { translateX: 7, translateY: 6, rotation: 0, scale: .52, opacity: 0 }, "cubic-bezier(.65,0,.9,.45)"),
  key(duration, { translateX: 0, translateY: 0, rotation: 0, scale: 1, opacity: 0 }),
];
const master = [
  key(0, { opacity: 0, scale: .65 }),
  key(1370, { opacity: 0, scale: .65 }),
  key(1395, { opacity: 1, scale: .84 }, "cubic-bezier(.1,.8,.2,1)"),
  key(1580, { opacity: 1, scale: 1.075 }),
  key(1710, { opacity: 1, scale: .984 }),
  key(1860, { opacity: 1, scale: 1 }),
  key(duration, { opacity: 1, scale: 1 }),
];
const document = {
  lsml: "1.2", scene_id: "zab-z-corner-bug", scene_version: `sha256:${"0".repeat(64)}`,
  viewport: { width, height }, defaults: {},
  layout: { kind: "frame", id: "stage", size: { w: width, h: height },
    clipsContent: true, children: [arrow("arrow-left"), arrow("arrow-right"), final] },
  animations: { show: { parallel: [track("arrow-left", left), track("arrow-right", right), track("z-master", master)] } },
};
document.scene_version = `sha256:${createHash("sha256").update(canonicalize(document)).digest("hex")}`;
const json = canonicalize(document);
const archive = zipSync({ "scene.lsml": strToU8(json) });
await Promise.all([
  writeFile(resolve(out, "sponsor-motion.lsml"), json),
  writeFile(resolve(out, "sponsor-motion.lsmlz"), archive),
  writeFile(resolve(out, "z-bug.lsml"), json),
  writeFile(resolve(out, "z-bug.lsmlz"), archive),
]);
await writeFile(resolve(out, "catalogue.json"), JSON.stringify({
  title: "Z · Deux flèches imbriquées", width, height, duration_ms: duration,
  animations: ["show"],
  description: "Deux flèches fermées issues des évidements du Z source. Aucun cut : elles se rejoignent et fusionnent en silhouette source.",
}, null, 2));
console.log(JSON.stringify({ scene: document.scene_id, out, duration, nodes: 3 }));
