// Draw two source-derived arrow ribbons, then move and fuse them into the Z.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { zipSync, strToU8 } from "fflate";
import { canonicalize } from "@lumencast/canonical";

const out = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw Error("Usage: node scripts/z-bug/generate.mjs <explicit-output-directory>");
await mkdir(out, { recursive: true });
const vectors = JSON.parse(await readFile(resolve(out, "assets/vectors.json"), "utf8"));
const width = 1920, height = 1080, duration = 2500;
const key = (ms, values, easing = "cubic-bezier(.2,.8,.2,1)") => ({ at: ms / duration, ...values, easing });
const position = { x: 112, y: height - 52 - 189 };
const size = { w: 180, h: 189 };
const arrow = name => ({ kind: "shape", id: name, geometry: "path",
  pathData: vectors[name].pathData, windingRule: "EVENODD",
  position, size, fill: vectors[name].fill, opacity: 0 });
const drawing = name => ({ kind: "shape", id: `${name}-draw`, geometry: "path",
  pathData: vectors[name].drawPathData, position, size, opacity: 0,
  stroke: { color: vectors[name].fill, width: vectors[name].drawStrokeWidth,
    lineJoin: "miter", lineCap: "butt" }, "x-vision.trimEnd": 0 });
const final = { ...arrow("master"), id: "z-master", opacity: 0,
  stroke: { color: vectors.master.fill, width: .85, lineJoin: "round" } };
const track = (target, steps) => ({ target, keyframes: { duration_ms: duration, steps } });
const leftPose = { translateX: -73, translateY: -73, rotation: -15, scale: .96 };
const rightPose = { translateX: 80, translateY: 34, rotation: 16, scale: .96 };
const leftDraw = [
  key(0, { ...leftPose, opacity: 1, trimEnd: 0 }, "linear"),
  key(430, { trimEnd: 1, opacity: 1 }, "linear"),
  key(480, { trimEnd: 1, opacity: 1 }),
  key(560, { trimEnd: 1, opacity: 0 }),
  key(duration, { opacity: 0 }),
];
const rightDraw = [
  key(0, { ...rightPose, opacity: 0, trimEnd: 0 }),
  key(60, { opacity: 1, trimEnd: 0 }, "linear"),
  key(500, { trimEnd: 1, opacity: 1 }, "linear"),
  key(560, { trimEnd: 1, opacity: 0 }),
  key(duration, { opacity: 0 }),
];
const left = [
  key(0, { ...leftPose, opacity: 0 }),
  key(465, { opacity: 0 }),
  key(560, { ...leftPose, opacity: 1 }),
  key(690, { translateX: -88, translateY: -83, rotation: -3, scale: 1.025, opacity: 1 }, "cubic-bezier(.25,.8,.2,1)"),
  key(850, { translateX: -45, translateY: -30, rotation: 13, scale: 1.035, opacity: 1 }, "cubic-bezier(.3,0,.15,1)"),
  key(1030, { translateX: -56, translateY: -39, rotation: -9, scale: .98, opacity: 1 }, "cubic-bezier(.25,.8,.2,1)"),
  key(1140, { translateX: -26, translateY: -19, rotation: 4, scale: 1.01, opacity: 1 }),
  key(1240, { translateX: -18, translateY: -10, rotation: -2, scale: 1, opacity: 1 }, "cubic-bezier(.45,0,.75,.4)"),
  key(1280, { translateX: -6, translateY: -4, rotation: 0, scale: .65, opacity: 0 }, "cubic-bezier(.65,0,.9,.45)"),
  key(duration, { translateX: 0, translateY: 0, rotation: 0, scale: 1, opacity: 0 }),
];
const right = [
  key(0, { ...rightPose, opacity: 0 }),
  key(465, { opacity: 0 }),
  key(560, { ...rightPose, opacity: 1 }),
  key(700, { translateX: 98, translateY: 45, rotation: 4, scale: 1.025, opacity: 1 }, "cubic-bezier(.25,.8,.2,1)"),
  key(865, { translateX: 48, translateY: 8, rotation: -12, scale: 1.035, opacity: 1 }, "cubic-bezier(.3,0,.15,1)"),
  key(1040, { translateX: 55, translateY: 29, rotation: 9, scale: .98, opacity: 1 }, "cubic-bezier(.25,.8,.2,1)"),
  key(1150, { translateX: 27, translateY: 17, rotation: -4, scale: 1.01, opacity: 1 }),
  key(1240, { translateX: 20, translateY: 8, rotation: 2, scale: 1, opacity: 1 }, "cubic-bezier(.45,0,.75,.4)"),
  key(1280, { translateX: 6, translateY: 4, rotation: 0, scale: .65, opacity: 0 }, "cubic-bezier(.65,0,.9,.45)"),
  key(duration, { translateX: 0, translateY: 0, rotation: 0, scale: 1, opacity: 0 }),
];
const master = [
  key(0, { opacity: 0, scale: .8 }),
  key(1240, { opacity: 0, scale: .8 }),
  key(1280, { opacity: 1, scale: .96 }, "cubic-bezier(.12,.8,.2,1)"),
  key(1390, { opacity: 1, scale: 1.035 }, "cubic-bezier(.2,.75,.25,1)"),
  key(1500, { opacity: 1, scale: 1 }),
  key(duration, { opacity: 1, scale: 1 }),
];
const document = {
  lsml: "1.2", scene_id: "zab-z-corner-bug", scene_version: `sha256:${"0".repeat(64)}`,
  viewport: { width, height }, defaults: {},
  layout: { kind: "frame", id: "stage", size: { w: width, h: height },
    clipsContent: true, children: [drawing("arrow-left"), drawing("arrow-right"), arrow("arrow-left"), arrow("arrow-right"), final] },
  animations: { show: { parallel: [track("arrow-left-draw", leftDraw), track("arrow-right-draw", rightDraw),
    track("arrow-left", left), track("arrow-right", right), track("z-master", master)] } },
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
  description: "Deux flèches issues des évidements du Z se dessinent le long de leurs propres rubans, dansent puis fusionnent en silhouette source.",
}, null, 2));
console.log(JSON.stringify({ scene: document.scene_id, out, duration, nodes: 5 }));
