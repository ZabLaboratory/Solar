import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { unzipSync, strFromU8 } from "fflate";
import { canonicalize } from "@lumencast/canonical";
import { startNative, readNative, withNative } from "./native-lsdp-tools.mjs";

const { values } = parseArgs({
  options: {
    scene: { type: "string" },
    "lsdp-bin": { type: "string" },
    port: { type: "string", default: "8099" },
    camera: { type: "string" },
    "status-parent": { type: "string" },
  },
});
if (!values.scene)
  throw new Error(
    "Usage: npm run native:start -- --scene <original.lsmlz> --lsdp-bin <lsdpd.exe> [--port 8099] [--camera <label>]",
  );
const port = Number(values.port);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid local HTTP port.");
const origin = `http://127.0.0.1:${port}`;
const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist/host");
const originalArchive = await readFile(resolve(values.scene));
const originalLSML = unzipSync(originalArchive)["scene.lsml"];
if (!originalLSML) throw new Error("scene.lsml missing from original archive.");
const original = JSON.parse(strFromU8(originalLSML));
const hash = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const sourceDigest = hash(originalLSML),
  archiveDigest = hash(originalArchive);
const sceneId = original.scene_id,
  sceneVersion = original.scene_version;
// Honest local test preparation. No claim that the edited render variant has
// acquired a published Blue validation record or a new published revision.
const unsigned = {
  schema_version: "zabcanvas.scene-blue-manifest.v1",
  scene_id: sceneId,
  scene_revision: 1,
  revision_id: "ephemeral-local-test",
  scene_version: sceneVersion,
  validation: { status: "local-source-only" },
  declarations: { operator_inputs: original.operator_inputs ?? [] },
  binding_closure: [],
  readiness: {
    program_ready: false,
    binding_closure_complete: false,
    offline_ready: false,
    missing_binding_ids: [],
    missing_scene_blueprint_keys: [],
  },
};
const blueManifest = {
  ...unsigned,
  manifest_digest: hash(canonicalize(unsigned)),
};
const native = await startNative(
  values["lsdp-bin"] ? resolve(values["lsdp-bin"]) : undefined,
  original,
  origin,
  () => server.close(),
);
const events = [];
const json = (response, status, value) => {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(value));
};
async function body(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 1024 * 1024) throw new Error("Local request exceeds 1 MiB.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".wasm": "application/wasm",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, origin);
    if (url.pathname === "/health")
      return json(response, 200, {
        native: native.url,
        nativeAddress: native.address,
        nativePid: native.pid,
        sceneId,
        sceneVersion,
        sourceDigest,
        archiveDigest,
        persistence: "memory-only",
        events,
      });
    if (url.pathname === "/state")
      return json(
        response,
        200,
        await native.reception.read(
          url.searchParams.get("resource") ?? "scene",
        ),
      );
    if (url.pathname === "/lsml" && request.method === "POST") {
      return json(response, 200, {
        receipt: await native.reception.replace(
          url.searchParams.get("resource") ?? "scene",
          await body(request),
        ),
        persistence: "memory-only",
      });
    }
    if (url.pathname === "/mutations" && request.method === "POST") {
      const target = url.searchParams.get("resource") ?? "scene";
      const operations = await body(request);
      if (!Array.isArray(operations))
        throw new Error(
          "Expected a JSON array of LSDP add/remove/replace/test operations.",
        );
      return json(
        response,
        200,
        await withNative(native.url, async (peer) => {
          const baseline = await readNative(peer, target);
          const mutation = {
            format: "lsdp.apply/1",
            id: randomBytes(16).toString("hex"),
            target,
            beforeHash: baseline.stateHash,
            operations,
            require: "applied",
          };
          const receipt = await peer.transaction(mutation);
          if (
            receipt.transactionId !== mutation.id ||
            receipt.target !== target ||
            receipt.level !== "applied"
          )
            throw new Error("Unexpected native mutation receipt.");
          return { receipt, persistence: "memory-only" };
        }),
      );
    }
    if (url.pathname === "/__render_diag" && request.method === "POST") {
      const event = await body(request);
      events.push(event);
      if (events.length > 100) events.shift();
      return json(response, 200, { received: true });
    }
    const sourcePath = `/canvas/api/v1/scenes/${sceneId}/source`;
    const revisionPath = `/canvas/api/v1/scenes/${sceneId}/revisions/1/`;
    if (url.pathname === sourcePath) {
      if (url.searchParams.get("version") !== sceneVersion)
        return json(response, 409, { error: "source version mismatch" });
      return json(response, 200, {
        revision: 1,
        scene_version: sceneVersion,
        source_digest: sourceDigest,
        lsml: `revisions/1/source.lsml?version=${sceneVersion}`,
        lsmlz: `revisions/1/source.lsmlz?version=${sceneVersion}`,
        assets: {},
        blue_manifest: blueManifest,
      });
    }
    if (
      url.pathname === `${revisionPath}source.lsmlz` ||
      url.pathname === `${revisionPath}source.lsml`
    ) {
      if (url.searchParams.get("version") !== sceneVersion)
        return json(response, 409, { error: "source version mismatch" });
      const archive = url.pathname.endsWith("lsmlz"),
        data = archive ? originalArchive : originalLSML;
      response.writeHead(200, {
        "Content-Type": archive ? "application/zip" : "application/json",
        "Content-Length": data.length,
        "Cache-Control": "no-store",
        "X-Scene-Version": sceneVersion,
        "X-Scene-Revision": "1",
        ETag: `"${archive ? archiveDigest : sourceDigest}"`,
      });
      return response.end(data);
    }
    if (url.pathname === "/") {
      response.writeHead(302, {
        Location: `/host.html?lsdp=${encodeURIComponent(native.url)}&resource=scene`,
      });
      return response.end();
    }
    const servedPath =
      url.pathname === "/host.html" ? "/index.html" : url.pathname;
    const file = resolve(dist, `.${decodeURIComponent(servedPath)}`);
    if (!file.startsWith(dist + sep))
      return json(response, 403, { error: "invalid path" });
    let data = await readFile(file);
    if (url.pathname === "/host.html") {
      const camera = values.camera
        ? { "obs-virtual-camera": { label: values.camera } }
        : {};
      const bootstrap = `<script>
        globalThis.__SOLAR_CONFIG__={canvasApiUrl:${JSON.stringify(origin + "/canvas/api/v1")}};
        globalThis.__ZAB_CAPTURE_DEVICES__=${JSON.stringify(camera)};
        const report=(detail)=>fetch('/__render_diag',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(detail)}).catch(()=>{});
        document.addEventListener('DOMContentLoaded',()=>document.getElementById('scene').addEventListener('solar:lsdp-applied',event=>report({type:'applied',...event.detail})));
        const originalError=console.error;console.error=(...args)=>{report({type:'error',message:args.map(String).join(' ')});originalError.apply(console,args)};
        ${values["status-parent"] ? `document.addEventListener('DOMContentLoaded',()=>new MutationObserver(()=>{const state=document.documentElement.dataset.solarStatus;if(state)parent.postMessage({type:'solar-status',state},${JSON.stringify(new URL(values["status-parent"]).origin)});}).observe(document.documentElement,{attributes:true,attributeFilter:['data-solar-status']}));` : ""}
        const originalGum=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async options=>{const stream=await originalGum(options);report({type:'camera',tracks:stream.getVideoTracks().map(track=>({label:track.label,settings:track.getSettings()}))});return stream};
      </script>`;
      data = Buffer.from(
        data.toString("utf8").replace("</head>", `${bootstrap}</head>`),
      );
    }
    response.writeHead(200, {
      "Content-Type": mime[extname(file)] ?? "application/octet-stream",
      "Content-Length": data.length,
      "Cache-Control": "no-store",
    });
    response.end(data);
  } catch (error) {
    json(response, error.code === "ENOENT" ? 404 : 400, {
      error: error.message,
    });
  }
});
try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
} catch (error) {
  await native.stop();
  throw error;
}
let closing = false;
async function stop() {
  if (closing) return;
  closing = true;
  server.closeAllConnections();
  server.close();
  await native.stop();
}
process.once("SIGINT", () => {
  void stop();
});
process.once("SIGTERM", () => {
  void stop();
});
process.once("exit", () => {
  void native.stop();
});
console.log(
  JSON.stringify({
    solar: origin + "/",
    native: native.url,
    nativePid: native.pid,
    sceneId,
    archiveDigest,
    persistence: "memory-only",
  }),
);
