import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const hostDir = resolve(root, "dist/host");
if (!existsSync(hostDir)) throw new Error("Solar host build is missing.");

function jsFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const file = resolve(dir, name);
    return statSync(file).isDirectory() ? jsFiles(file) : file.endsWith(".js") ? [file] : [];
  });
}

const files = jsFiles(hostDir);
if (files.length === 0) throw new Error("Solar host build contains no JavaScript.");

const patterns = [
  /(?:^|[;\n}{)\s])(?:import|export)\b[^()'";]*?\bfrom\s*["']([^"']+)["']/g,
  /(?:^|[;\n}{)\s])import\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
];
const violations = [];
const sourceMaps = [];
for (const file of files) {
  const source = readFileSync(file, "utf8");
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (let match; (match = pattern.exec(source)) !== null;) {
      const specifier = match[1];
      if (
        !specifier.startsWith("./") &&
        !specifier.startsWith("../") &&
        !specifier.startsWith("/") &&
        !/^[a-z][a-z0-9+.-]*:/i.test(specifier)
      ) violations.push(`${relative(root, file)}: ${specifier}`);
    }
  }
  const vendoredVisionAsset = relative(hostDir, file).split(/[\\/]/, 1)[0] === "vision";
  if (!vendoredVisionAsset) {
    const mapPath = `${file}.map`;
    if (!existsSync(mapPath)) throw new Error(`Missing source map: ${relative(root, mapPath)}`);
    sourceMaps.push(JSON.parse(readFileSync(mapPath, "utf8")));
  }
}

const sources = sourceMaps.flatMap((map) => map.sources ?? []).map(String);
const removedRendererSources = sources.filter((source) =>
  /current-runtime|lsdp-vision-runtime|resolve-show-token|\/atlas\/|\/overlay\/|render-asset-wire|editable-preview|node_modules\/(react|react-dom|framer-motion|@preact\/signals)/i.test(source),
);
if (removedRendererSources.length > 0) {
  throw new Error(`Legacy renderer code remains in Solar host: ${removedRendererSources.join(", ")}`);
}
if (!sources.some((source) => /vision-presenter\.ts/.test(source))) {
  throw new Error("Vision presenter adapter is absent from Solar host output.");
}
if (!sources.some((source) => /native-lsdp-runtime\.ts/.test(source)) || !sources.some((source) => /lsdp-native-browser.*browser\.js/.test(source))) {
  throw new Error("Native LSDP browser transport is absent from Solar host output.");
}
if (!sources.some((source) => /dist[\\/]webrtc[\\/]index\.js/.test(source))) {
  throw new Error("Receive-only peer viewer is absent from Solar host output.");
}
const nonPeerRuntimeSources = sources.filter((source) =>
  /@lumencast[\\/]runtime[\\/]/i.test(source) && !/dist[\\/]webrtc[\\/]/i.test(source),
);
if (nonPeerRuntimeSources.length > 0) {
  throw new Error(`Non-WebRTC Lumencast runtime code remains in Solar host: ${nonPeerRuntimeSources.join(", ")}`);
}
if (violations.length > 0) {
  throw new Error(`Bare ESM specifiers remain in Solar host output: ${violations.join(", ")}`);
}

console.log(`Solar host verified: ${files.length} self-contained JavaScript chunk(s), Vision renderer and peer camera support present.`);
