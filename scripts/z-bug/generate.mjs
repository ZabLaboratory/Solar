// Draw two source-derived arrow ribbons, then move and fuse them into the Z.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { zipSync, strToU8 } from "fflate";
import { canonicalize } from "@lumencast/canonical";

const out = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw Error("Usage: node scripts/z-bug/generate.mjs <explicit-output-directory>");
await mkdir(out, { recursive: true });
const vectors = JSON.parse(await readFile(resolve(out, "assets/vectors.json"), "utf8"));
const width = 1920, height = 1080, duration = 2000;
const key = (ms, values, easing = "cubic-bezier(.2,.8,.2,1)") => ({ at: ms / duration, ...values, easing });
const position = { x: 112, y: height - 52 - 189 };
const size = { w: 180, h: 189 };
const shape = (id, pathData) => ({ kind: "shape", id, geometry: "path",
  pathData, windingRule: "EVENODD", position, size, fill: vectors.master.fill, opacity: 0 });
const drawing = name => ({ kind: "shape", id: `${name}-draw`, geometry: "path",
  pathData: vectors[name].drawPathData, position, size, opacity: 0,
  stroke: { color: vectors[name].fill, width: vectors[name].drawStrokeWidth,
    lineJoin: "miter", lineCap: "butt" }, "x-vision.trimEnd": 0 });
const final = { ...shape("z-master", vectors.master.pathData),
  stroke: { color: vectors.master.fill, width: .85, lineJoin: "round" } };
const track = (target, steps) => ({ target, keyframes: { duration_ms: duration, steps } });
const clamp = x => Math.max(0, Math.min(1, x));
const smooth = x => { const p = clamp(x); return p * p * (3 - 2 * p); };
const smoother = x => { const p = clamp(x); return p ** 3 * (p * (p * 6 - 15) + 10); };
// Bake continuous authoring curves at 120 Hz. Solar still interpolates native
// vector properties; these are neither image frames nor independent poses.
const times = [...Array.from({ length: 91 }, (_, i) => i * 1000 / 120), duration];
const sides = [
  { name: "arrow-left", x: 32, y: -45, angle: -3, delay: 0 },
  { name: "arrow-right", x: -32, y: 45, angle: 3, delay: 35 },
];
const pose = (time, { x, y, angle, delay }) => {
  const d = clamp((time - delay) / 380);
  const travel = smoother((time - 260) / 360);
  return { translateX: x * (1 - travel), translateY: y * (1 - travel),
    rotation: angle * (1 - travel),
    scale: 1 - .08 * (1 - d) ** 3 + .035 * Math.sin(Math.PI * d) ** 2 };
};
const drawingTracks = sides.map(side => track(`${side.name}-draw`, times.map(time => key(time, {
  ...pose(time, side), trimEnd: smooth((time - side.delay) / 300),
  opacity: 1 - smooth((time - 350) / 30),
}, "linear"))));
const contactInput = {
  arrows: sides.map(side => ({ start: vectors[side.name].morphStart, docked: vectors[side.name].morphDocked })),
  poses: Array.from({ length: 45 }, (_, i) => {
    const time = (36 + i) * 1000 / 120;
    return { time, morph: smoother((time - 340) / 280), arrows: sides.map(side => pose(time, side)) };
  }),
};
const contact = JSON.parse(execFileSync(process.env.PYTHON ?? "python", [resolve(import.meta.dirname, "contact.py")], {
  input: JSON.stringify(contactInput), encoding: "utf8", maxBuffer: 8 * 1024 * 1024, windowsHide: true,
}));
const assembly = shape("arrow-assembly", contact.frames[0].pathData);
const assemblyPaths = [key(0, { pathData: contact.frames[0].pathData }, "hold"),
  ...contact.frames.map(frame => key(frame.time, { pathData: frame.pathData }, "hold")),
  key(duration, { pathData: contact.frames.at(-1).pathData }, "hold")];
const assemblyOpacity = [key(0, { opacity: 0 }), key(300, { opacity: 0 }, "linear"),
  key(350, { opacity: 1 }), key(660, { opacity: 1 }, "linear"), key(680, { opacity: 0 }), key(duration, { opacity: 0 })];
const master = [
  key(0, { opacity: 0, scale: 1 }),
  key(630, { opacity: 0, scale: 1 }, "linear"),
  key(660, { opacity: 1, scale: 1 }),
  key(duration, { opacity: 1, scale: 1 }),
];
const document = {
  lsml: "1.2", scene_id: "zab-z-corner-bug", scene_version: `sha256:${"0".repeat(64)}`,
  viewport: { width, height }, defaults: {},
  layout: { kind: "frame", id: "stage", size: { w: width, h: height },
    clipsContent: true, children: [final, assembly, drawing("arrow-left"), drawing("arrow-right")] },
  animations: { show: { parallel: [...drawingTracks, track("arrow-assembly", assemblyPaths),
    track("arrow-assembly", assemblyOpacity), track("z-master", master)] } },
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
  description: "Les deux flèches se tracent et s'imbriquent dans un même élan. Le rebond suit le dessin ; les contours se raccordent au logo source.",
}, null, 2));
await writeFile(resolve(out, "contact.json"), JSON.stringify({ sample_hz: contact.sample_hz,
  frames: contact.frames.length, contours: contact.contours, vertices: contact.vertices, method: contact.method }, null, 2));
console.log(JSON.stringify({ scene: document.scene_id, out, duration, nodes: 4, contact_vertices: contact.vertices }));
