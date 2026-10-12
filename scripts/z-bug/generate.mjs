// Two opposed arrow gestures trace, fill, and interlock into the source Z.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { zipSync, strToU8 } from "fflate";
import { canonicalize } from "@lumencast/canonical";

const out = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw Error("Usage: node scripts/z-bug/generate.mjs <explicit-output-directory>");
await mkdir(out, { recursive: true });
const names = ["arrow-left", "arrow-right"];
const vectors = JSON.parse(await readFile(resolve(out, "assets/vectors.json"), "utf8"));
const width = 1920, height = 1080, duration = 4200;
const key = (ms, values, easing = "cubic-bezier(0.22,0.8,0.25,1)") => ({ at: ms / duration, ...values, easing });
const tracks = [];
const track = (target, steps) => tracks.push({ target, keyframes: { duration_ms: duration, steps } });
const children = [];
const x = 112, y = height - 52 - 189;
const poses = {
  "arrow-left": [
    key(0, { translateX: -116, translateY: -85, rotation: -19, scale: .95 }),
    key(270, { translateX: -97, translateY: -112, rotation: -13, scale: 1 }),
    key(720, { translateX: -78, translateY: -42, rotation: -9, scale: 1.04 }),
    key(1120, { translateX: -34, translateY: -49, rotation: -12, scale: 1.02 }),
    key(1550, { translateX: 10, translateY: 7, rotation: 3.2, scale: .98 }, "cubic-bezier(.55,0,.75,.38)"),
    key(1690, { translateX: -6, translateY: -4, rotation: -1.7, scale: 1.015 }),
    key(1820, { translateX: 3, translateY: 2, rotation: .8, scale: .995 }),
    key(2000, { translateX: 0, translateY: 0, rotation: 0, scale: 1 }),
    key(duration, { translateX: 0, translateY: 0, rotation: 0, scale: 1 }),
  ],
  "arrow-right": [
    key(0, { translateX: 116, translateY: 80, rotation: 17, scale: .95 }),
    key(310, { translateX: 97, translateY: 109, rotation: 12, scale: 1 }),
    key(760, { translateX: 76, translateY: 41, rotation: 8, scale: 1.04 }),
    key(1150, { translateX: 33, translateY: 47, rotation: 11, scale: 1.02 }),
    key(1570, { translateX: -10, translateY: -7, rotation: -3, scale: .98 }, "cubic-bezier(.55,0,.75,.38)"),
    key(1720, { translateX: 6, translateY: 4, rotation: 1.6, scale: 1.015 }),
    key(1850, { translateX: -3, translateY: -2, rotation: -.7, scale: .995 }),
    key(2030, { translateX: 0, translateY: 0, rotation: 0, scale: 1 }),
    key(duration, { translateX: 0, translateY: 0, rotation: 0, scale: 1 }),
  ],
};

for (const [i, name] of names.entries()) {
  const base = { kind: "shape", geometry: "path", position: { x, y }, size: { w: 180, h: 189 } };
  children.push({ ...base, id: `${name}-guide`, pathData: vectors[name].guidePathData,
    stroke: { color: "#ff849f", width: 6, lineCap: "round", lineJoin: "round" },
    "x-vision.trimEnd": 0, opacity: 0 });
  children.push({ ...base, id: `${name}-fill`, pathData: vectors[name].pathData,
    windingRule: "EVENODD", fill: vectors[name].fill,
    stroke: { color: vectors[name].fill, width: .85, lineJoin: "round" }, opacity: 0 });
  const offset = i * 95;
  const motion = poses[name].slice(1);
  track(`${name}-guide`, [
    key(0, { ...poses[name][0], opacity: 1, trimEnd: 0 }),
    key(140 + offset, { trimEnd: .18, opacity: 1 }),
    key(660 + offset, { trimEnd: 1, opacity: 1 }),
    key(960 + offset, { trimEnd: 1, opacity: 0 }),
    ...motion,
  ].sort((a, b) => a.at - b.at));
  track(`${name}-fill`, [
    key(0, { ...poses[name][0], opacity: 0 }),
    key(390 + offset, { opacity: 0 }),
    key(870 + offset, { opacity: 1 }),
    ...motion,
  ].sort((a, b) => a.at - b.at));
}
const document = {
  lsml: "1.2", scene_id: "zab-z-corner-bug", scene_version: `sha256:${"0".repeat(64)}`,
  viewport: { width, height }, defaults: {},
  layout: { kind: "frame", id: "stage", size: { w: width, h: height }, clipsContent: true, children },
  animations: { show: { parallel: tracks } },
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
  title: "Z · Stream Corner Bug", width, height, duration_ms: duration,
  animations: ["show"],
  description: "Deux gestes de flèche vectoriels tracés séparément, matérialisés, puis emboîtés avec rebond dans le Z source.",
}, null, 2));
console.log(JSON.stringify({ scene: document.scene_id, out, duration, nodes: children.length }));
