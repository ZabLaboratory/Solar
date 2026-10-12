// A native LSML corner bug: two source-traced vector arrows, two independent
// retained Solar/Vision tracks, and a quiet assembled hold for live streams.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { zipSync, strToU8 } from "fflate";
import { canonicalize } from "@lumencast/canonical";

const root = resolve(import.meta.dirname, "../..");
const out = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw Error("Usage: node scripts/z-bug/generate.mjs <explicit-output-directory>");
await mkdir(out, { recursive: true });
const assetNames = ["arrow-upper", "arrow-lower"];
const vectors = JSON.parse(await readFile(resolve(out, "assets/vectors.json"), "utf8"));

const width = 1920, height = 1080, duration = 6000;
const px = (ms, channels, easing = "cubic-bezier(0.22,0.8,0.25,1)") => ({
  at: ms / duration, ...channels, easing,
});
const upper = [
  px(0, { translateX: 0, translateY: 0, rotation: 0, scale: 1 }),
  px(145, { translateX: -4, translateY: 2, rotation: 1.5, scale: .985 }, "ease-in-out"),
  px(480, { translateX: -53, translateY: -31, rotation: -16, scale: 1.04 }),
  px(675, { translateX: -64, translateY: -39, rotation: -19, scale: 1.05 }),
  px(895, { translateX: -53, translateY: -32, rotation: -15, scale: 1.035 }),
  px(1050, { translateX: -60, translateY: -37, rotation: -18, scale: 1.045 }),
  px(1290, { translateX: -31, translateY: -17, rotation: -8, scale: 1.02 }, "cubic-bezier(0.65,0,0.8,0.3)"),
  px(1500, { translateX: 4.5, translateY: 2.5, rotation: 2.5, scale: .985 }),
  px(1670, { translateX: -5, translateY: -3, rotation: -1.8, scale: 1.012 }),
  px(1830, { translateX: 1.6, translateY: 1, rotation: .6, scale: .996 }),
  px(2020, { translateX: 0, translateY: 0, rotation: 0, scale: 1 }),
  px(duration, { translateX: 0, translateY: 0, rotation: 0, scale: 1 }),
];
const lower = [
  px(0, { translateX: 0, translateY: 0, rotation: 0, scale: 1 }),
  px(180, { translateX: 3, translateY: -2, rotation: -1.5, scale: .985 }, "ease-in-out"),
  px(510, { translateX: 49, translateY: 28, rotation: 14, scale: 1.035 }),
  px(720, { translateX: 62, translateY: 38, rotation: 18, scale: 1.05 }),
  px(935, { translateX: 52, translateY: 31, rotation: 14.5, scale: 1.035 }),
  px(1090, { translateX: 58, translateY: 36, rotation: 17, scale: 1.045 }),
  px(1350, { translateX: 27, translateY: 14, rotation: 7, scale: 1.015 }, "cubic-bezier(0.65,0,0.8,0.3)"),
  px(1550, { translateX: -4, translateY: -2, rotation: -2.3, scale: .985 }),
  px(1710, { translateX: 4.5, translateY: 2.8, rotation: 1.6, scale: 1.011 }),
  px(1870, { translateX: -1.4, translateY: -.7, rotation: -.5, scale: .997 }),
  px(2070, { translateX: 0, translateY: 0, rotation: 0, scale: 1 }),
  px(duration, { translateX: 0, translateY: 0, rotation: 0, scale: 1 }),
];
const arrow = name => ({
  kind: "shape", id: name, geometry: "path", pathData: vectors[name].pathData,
  windingRule: "EVENODD", fill: vectors[name].fill,
  stroke: { color: vectors[name].fill, width: .85, lineJoin: "round" },
  position: { x: 112, y: 1080 - 52 - 189 },
  size: { w: 180, h: 189 },
});
const track = (target, steps) => ({ target, keyframes: { duration_ms: duration, steps } });
const document = {
  lsml: "1.2", scene_id: "zab-z-corner-bug", scene_version: `sha256:${"0".repeat(64)}`,
  viewport: { width, height }, defaults: {},
  layout: {
    kind: "frame", id: "stage", size: { w: width, h: height },
    clipsContent: true,
    children: assetNames.map(arrow),
  },
  animations: { show: { parallel: [track("arrow-upper", upper), track("arrow-lower", lower)] } },
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
  description: "Deux flèches réelles du Z landing · écartement et rebond natifs LSML/Solar · maintien discret dans le coin inférieur gauche.",
}, null, 2));
console.log(JSON.stringify({ scene: document.scene_id, out, duration, nodes: assetNames.length }));
