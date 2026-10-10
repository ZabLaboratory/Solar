import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { zipSync, strToU8 } from "fflate";
import { canonicalize } from "@lumencast/canonical";

const root = resolve(import.meta.dirname, "../..");
const out = resolve(root, process.argv[2] ?? "fixtures/sponsor-motion");
await mkdir(out, { recursive: true });
const assets = {};
for (const name of ["w", "hello-fresh"]) assets[`assets/${name}.png`] = new Uint8Array(await readFile(resolve(root, `fixtures/sponsor-motion/${name}.png`)));
const W = 720, count = 12, duration = 2800;
const children = [], animations = {};
function animation(id, steps) {
  animations[id] = { target: id, keyframes: { duration_ms: duration, easing: "cubic-bezier(0.65,0,0.22,1)", steps } };
}
for (let i = 0; i < count; i++) {
  const lag = i * 0.018;
  const from = `out-${i}`, to = `in-${i}`, seam = `seam-${i}`;
  children.push({ kind: "frame", id: `slot-${i}`, position: { x: i * W / count, y: 0 }, size: { w: W / count, h: W }, clipsContent: true, children: [
    { kind: "image", id: from, position: { x: -i * W / count, y: 0 }, size: { w: W, h: W }, src: "assets/w.png", fit: "fill" },
    { kind: "image", id: to, position: { x: -i * W / count, y: W + 20 }, size: { w: W, h: W }, src: "assets/hello-fresh.png", fit: "fill", opacity: 0 },
  ] });
  animation(from, [
    { at: 0, translateY: 0, rotation: 0, opacity: 1, blur: 0 },
    { at: 0.18 + lag, translateY: 0, rotation: 0, opacity: 1, blur: 0 },
    { at: 0.44 + lag, translateY: -W * 0.45, rotation: -2.5, opacity: 0.85, blur: 2 },
    { at: 0.61 + lag, translateY: -W - 80, rotation: 0, opacity: 0, blur: 0 },
    { at: 1, translateY: -W - 80, rotation: 0, opacity: 0, blur: 0 },
  ]);
  animation(to, [
    { at: 0, translateY: 0, rotation: 0, opacity: 0, blur: 0 },
    { at: 0.27 + lag, translateY: 0, rotation: 2.5, opacity: 1, blur: 3 },
    { at: 0.55 + lag, translateY: -W - 34, rotation: -0.5, opacity: 1, blur: 0 },
    { at: 0.70 + lag, translateY: -W - 20, rotation: 0, opacity: 1, blur: 0 },
    { at: 1, translateY: -W - 20, rotation: 0, opacity: 1, blur: 0 },
  ]);
  if (i > 0) {
    children.push({ kind: "shape", id: seam, shape: "rect", position: { x: i * W / count - 1, y: -W }, size: { w: 2, h: W }, fill: "#ed0016", opacity: 0 });
    animation(seam, [
      { at: 0, translateY: 0, opacity: 0 },
      { at: 0.24 + lag, translateY: 0, opacity: 0 },
      { at: 0.37 + lag, translateY: W, opacity: 0.9 },
      { at: 0.63 + lag, translateY: W * 2, opacity: 0 },
      { at: 1, translateY: W * 2, opacity: 0 },
    ]);
  }
}
const document = { lsml: "1.2", scene_id: "sponsor-motion-demo", scene_version: `sha256:${"0".repeat(64)}`, viewport: { width: W, height: W }, defaults: {},
  layout: { kind: "frame", id: "stage", size: { w: W, h: W }, background: "#000000", clipsContent: true, children }, animations };
document.scene_version = `sha256:${createHash("sha256").update(canonicalize(document)).digest("hex")}`;
const json = canonicalize(document);
await writeFile(resolve(out, "sponsor-motion.lsml"), json);
await writeFile(resolve(out, "sponsor-motion.lsmlz"), zipSync({ "scene.lsml": strToU8(json), ...assets }));
await writeFile(resolve(out, "catalogue.json"), JSON.stringify({ duration_ms: duration, size: W, animations: Object.keys(animations) }, null, 2));
console.log(JSON.stringify({ scene: document.scene_id, animations: Object.keys(animations).length, out }));
