import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { patchRegistry } from "./peer-viewer/registry.mjs";
import { patchViewer } from "./peer-viewer/viewer.mjs";
import { patchRooms } from "./peer-viewer/rooms.mjs";

// Resolve hoisted npm dependencies. Only the receive-only entry is consumed by Solar.
const runtimeRoot = resolve(
  dirname(fileURLToPath(import.meta.resolve("@lumencast/runtime"))),
  "..",
);
await patchRegistry(runtimeRoot);
await patchViewer(runtimeRoot);
await patchRooms(runtimeRoot);
console.log("[solar] receive-only WebRTC compatibility patches applied");
