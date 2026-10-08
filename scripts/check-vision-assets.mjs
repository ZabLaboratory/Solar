import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const required = [
  ["public/vision/ui/mainpresenter.mjs", 10_000],
  ["public/vision/ui/fonts.mjs", 1_000],
  ["public/vision/pkg/lumencast_vision_web.js", 10_000],
  ["public/vision/pkg/lumencast_vision_web_bg.wasm", 1_000_000],
];

const manifest = JSON.parse(readFileSync(resolve(root, "public/vision/vision-assets.json"), "utf8"));
if (manifest.schema !== "solar.vision-assets.v1") throw new Error("Invalid Vision asset pin manifest.");
for (const [path, minimumBytes] of required) {
  const absolute = resolve(root, path);
  const size = statSync(absolute).size;
  if (size < minimumBytes) throw new Error(`Vision asset is incomplete: ${path} (${size} bytes).`);
  const pin = manifest.files[path.replace("public/vision/", "")];
  const digest = createHash("sha256").update(readFileSync(absolute)).digest("hex");
  if (pin?.bytes !== size || pin?.sha256 !== digest) throw new Error(`Vision asset does not match its pin: ${path}.`);
}

console.log("Vision presenter, fonts, generated glue and WASM engine match all four artifact pins.");
