// Complete-scene cache contract harness. Test signatures/manifest, actual product binaries.
// Its explicit boundary must never be reported as authenticated Canvas delivery.
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { canonicalize } from "@lumencast/canonical";
import { unzipSync } from "fflate";
import { createCachedSceneSourceProvider, FileSceneSourceStore } from "../../dist/server/index.mjs";
import { startNative } from "../native-lsdp-tools.mjs";
import { startMeetProof, rtcMetrics } from "./meet-peer.mjs";

const { values } = parseArgs({ options: {
  scene: { type: "string" }, orion: { type: "string" }, storage: { type: "string" },
  "orion-storage": { type: "string" }, output: { type: "string" },
  port: { type: "string", default: "8122" }, camera: { type: "string" }, offline: { type: "boolean" },
  meet: { type: "string" },
  capsule: { type: "string" },
} });
for (const key of ["scene", "orion", "storage", "orion-storage", "output"]) if (!values[key]) throw new Error("Missing " + key);
const root = resolve(import.meta.dirname, "../..");
const dist = resolve(root, "dist/host");
const storage = resolve(values.storage), orionStorage = resolve(values["orion-storage"]);
const orionRoot = resolve(values.orion);
for (const [directory, owner] of [[storage, root], [orionStorage, orionRoot]]) {
  if (!directory.startsWith(resolve(owner, "build") + sep)) throw new Error("Proof storage must stay in its owner's build directory");
  await mkdir(directory, { recursive: true });
}
const port = Number(values.port), origin = `http://127.0.0.1:${port}`;
const archive = new Uint8Array(await readFile(values.scene));
const files = unzipSync(archive), source = files["scene.lsml"];
const original = JSON.parse(new TextDecoder().decode(source));
const hash = (data) => "sha256:" + createHash("sha256").update(data).digest("hex");
const canvasCapsule = values.capsule ? JSON.parse(await readFile(values.capsule, "utf8")) : null;
const program = canvasCapsule ? Buffer.from(canvasCapsule.envelope.blue_program, "base64") : await readFile(resolve(orionRoot, "internal/api/testdata/scene-lec-lck.program.json"));
const portable = JSON.parse(program), programDigest = portable.program_digest;
const identityPath = resolve(storage, "test-identity.json");
let identity;
if (!values.offline && canvasCapsule) {
  const envelope = canvasCapsule.envelope;
  identity = { manifest: envelope.blue_manifest, artifactSet: envelope.claims.artifact_set_digest,
    jws: envelope.jws, claims: envelope.claims, sourceDigest: envelope.lsml_bundle_digest,
    archiveDigest: hash(archive), programDigest,
    boundary: "actual local Canvas admission/signature; real gateway identity and Blue compile; no seeded verdict or host-generated signing key",
    trust: canvasCapsule.trust.keys };
  if (identity.sourceDigest !== hash(source)) throw new Error("Canvas source bytes differ from received capsule");
  await writeFile(identityPath, JSON.stringify(identity));
  await writeFile(resolve(orionStorage, "test-trust.json"), JSON.stringify(identity.trust));
} else if (!values.offline) {
  const unsigned = { schema_version: "zabcanvas.scene-blue-manifest.v1", scene_id: original.scene_id,
    scene_version: original.scene_version, scene_revision: 1, revision_id: "cold-proof-revision",
    validation: { verdict: "cache-contract-fixture", program_digest: programDigest },
    declarations: { operator_inputs: original.operator_inputs ?? [], scene_blueprints: original.scene_blueprints ?? [] },
    binding_closure: [{ program_digest: programDigest, origin: "unchanged existing published program; local cache contract metadata" }],
    readiness: { program_ready: true, binding_closure_complete: true, offline_ready: true, missing_binding_ids: [], missing_scene_blueprint_keys: [] },
  };
  const manifest = { ...unsigned, manifest_digest: hash(canonicalize(unsigned)) };
  // Deliberately distinct identities reproduce the real Canvas wire contract.
  const artifactSet = hash(canonicalize({ source: hash(source), program: programDigest, revision: unsigned.revision_id }));
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const key = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
  const now = Math.floor(Date.now() / 1000), kid = "local-cold-proof";
  const claims = { schema_version: "zabcanvas.resolved-scene-ref.v1", ref_id: "cold-ref", attestation_id: "cold-att",
    issuer: "https://zabcanvas.internal", audience: "orion", subject: "operator-1", owner_id: "owner-1", tenant_id: "tenant-1",
    stream_id: "stream-1", allowed_actions: ["prepare-preview", "take-on-air"], scene_id: original.scene_id,
    revision_id: unsigned.revision_id, scene_digest: programDigest, artifact_set_digest: artifactSet, blue_program_digest: programDigest,
    readiness_attestation_id: "cold-ready", readiness_digest: hash("local fixture readiness"),
    readiness_expires_at: now + 900, issued_at: now, not_before: now - 1, expires_at: now + 900, kid,
    canvas_locator: `/api/v1/scenes/${original.scene_id}/resolved-scene-ref/cold-ref` };
  const head = Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "zabcanvas-resolved-scene-ref+jws", kid })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const jws = head + "." + payload + "." + sign(null, Buffer.from(head + "." + payload), privateKey).toString("base64url");
  identity = { manifest, artifactSet, jws, sourceDigest: hash(source), archiveDigest: hash(archive), programDigest,
    boundary: "cache transport fixture; no claim of Canvas validation/admission", trust: { [kid]: key } };
  await writeFile(identityPath, JSON.stringify(identity));
  await writeFile(resolve(orionStorage, "test-trust.json"), JSON.stringify(identity.trust));
} else identity = JSON.parse(await readFile(identityPath, "utf8"));
if (identity.archiveDigest !== hash(archive) || identity.programDigest !== programDigest) throw new Error("Fixture identity changed");
const stats = { offline: !!values.offline, upstreamSourceReads: 0, localSourceReads: 0, sourceHTTP: [], blockedEgress: [], events: [] };
const provider = createCachedSceneSourceProvider({ get: async () => {
  stats.upstreamSourceReads++;
  if (stats.offline) throw new Error("OFFLINE_SOURCE_UPSTREAM");
  return { sceneId: original.scene_id, sceneVersion: original.scene_version, revision: 1, sourceDigest: hash(source),
    format: "lsmlz", data: archive, assets: new Map(), blueManifest: identity.manifest };
} }, new FileSceneSourceStore(resolve(storage, "sources")));
if (!stats.offline) await provider.get(original.scene_id);
const secret = randomBytes(32).toString("hex");
let native, child, meet, closing = false, publisherActive = true;
const json = (response, status, value) => { response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); response.end(JSON.stringify(value)); };
async function body(request) {
  let text = ""; for await (const chunk of request) { text += chunk; if (text.length > 1024 * 1024) throw new Error("Body limit"); }
  return text ? JSON.parse(text) : {};
}
async function operator(path, method = "GET", data) {
  const response = await fetch(`http://127.0.0.1:${port + 1}` + path, {
    method, headers: { "X-Orion-Local-Auth": secret, "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(45000),
  });
  return { status: response.status, body: await response.json() };
}
const mime = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".ttf": "font/ttf" };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, origin);
    if (url.pathname === "/health") return json(response, 200, { ...stats, native: native?.url, nativePid: native?.pid,
      orionPid: child?.pid, address: native?.address, sceneId: original.scene_id, sceneVersion: original.scene_version,
      artifactSet: identity.artifactSet, manifestDigest: identity.manifest.manifest_digest, boundary: identity.boundary });
    if (url.pathname === "/peer/health") return json(response, 200, { ...(await meet.health()), meetPid: meet.pid });
    if (url.pathname === "/peer/publisher-state") return json(response, 200, { active: publisherActive });
    if (url.pathname === "/publisher.html") { response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" }); response.end(meet.page); return; }
    if (url.pathname === "/peer/action" && request.method === "POST") {
      const action = await body(request);
      if (action.type === "pause" || action.type === "join") publisherActive = action.type === "join";
      else if (["assign", "clear"].includes(action.type)) {
        const target = "solar/" + action.lane, document = (await native.reception.read(target)).state;
        document.defaults["__cam.viewer"] = JSON.stringify(meet.viewer);
        for (const slot of ["@0", "@1", "@2"]) delete document.defaults["__cam.slots." + slot];
        if (action.type === "assign") document.defaults["__cam.slots." + action.slot] = "proof_peer";
        await native.reception.replace(target, document);
      } else throw new Error("Unknown peer action");
      return json(response, 200, { applied: true });
    }
    if (url.pathname === "/state") return json(response, 200, await native.reception.read(url.searchParams.get("resource") ?? "orion/state"));
    if (url.pathname === "/stop" && request.method === "POST") { json(response, 200, { stopping: true }); setTimeout(() => void stop(), 20); return; }
    if (url.pathname === "/select" && request.method === "POST") {
      const document = (await native.reception.read("orion/state")).state;
      document.scene_control.defaults.desired = Object.fromEntries(["program", "preview"].map(lane => [lane, { scene_id: original.scene_id, scene_version: identity.artifactSet, stream_id: "stream-1" }]));
      await native.reception.replace("orion/state", document); return json(response, 200, { selected: true });
    }
    if (url.pathname === "/runtime-mutation" && request.method === "POST") {
      const target = "solar/" + url.searchParams.get("lane");
      const document = (await native.reception.read(target)).state;
      document.defaults.cold_proof_runtime_only = "must disappear after full restart";
      await native.reception.replace(target, document); return json(response, 200, { memoryOnly: true });
    }
    if (url.pathname === "/contracts") {
      const selector = url.searchParams.get("lane") === "preview" ? "&target=preview" : "";
      return json(response, 200, await operator("/api/v1/cockpit/contracts?stream_id=stream-1" + selector));
    }
    if (url.pathname === "/call" && request.method === "POST") {
      const call = await body(request), lane = url.searchParams.get("lane");
      const selector = lane === "preview" ? "?target=preview" : "";
      return json(response, 200, await operator(`/api/v1/operator/call/${encodeURIComponent(call.blueprint)}/${encodeURIComponent(call.entrypoint)}${selector}`, "POST", { payload: call.payload }));
    }
    if (url.pathname === "/__render_diag" && request.method === "POST") {
      stats.events.push(await body(request)); if (stats.events.length > 150) stats.events.shift();
      return json(response, 200, { received: true });
    }
    const sourceRoot = `/canvas/api/v1/scenes/${original.scene_id}/`;
    if (url.pathname === "/canvas/api/v1/scenes") {
      return json(response, stats.offline ? 503 : 200, stats.offline ? { code: "OFFLINE" } : { items: [{ id: original.scene_id }], next_offset: null });
    }
    if (url.pathname.startsWith(sourceRoot)) {
      stats.sourceHTTP.push({ path: url.pathname, offline: stats.offline });
      const delivery = await provider.get(original.scene_id, { sceneVersion: original.scene_version });
      stats.localSourceReads++;
      if (url.searchParams.has("version") && url.searchParams.get("version") !== original.scene_version) return json(response, 409, { code: "VERSION_MISMATCH" });
      if (url.pathname === sourceRoot + "source") return json(response, 200, { revision: 1, scene_version: original.scene_version,
        source_digest: delivery.sourceDigest, lsml: `revisions/1/source.lsml?version=${original.scene_version}`,
        lsmlz: `revisions/1/source.lsmlz?version=${original.scene_version}`, assets: {}, blue_manifest: delivery.blueManifest });
      if (url.pathname === sourceRoot + "revisions/1/source.lsmlz") {
        response.writeHead(200, { "Content-Type": "application/zip", "X-Scene-Version": original.scene_version,
          "X-Scene-Revision": "1", ETag: `"${hash(delivery.data)}"` }); return response.end(delivery.data);
      }
      return json(response, 404, { code: "UNKNOWN_SOURCE_ROUTE" });
    }
    if (/^\/(auth|truth|ranking|quasar|blue)\//.test(url.pathname)) {
      stats.blockedEgress.push(url.pathname); return json(response, 503, { code: "OFFLINE_EGRESS" });
    }
    const served = url.pathname === "/host.html" ? "/index.html" : url.pathname;
    const file = resolve(dist, "." + decodeURIComponent(served));
    if (!file.startsWith(dist + sep)) return json(response, 403, {});
    let data = await readFile(file);
    if (url.pathname === "/host.html") {
      const config = { canvasApiUrl: origin + "/canvas/api/v1", canvasToken: "local-cache-contract" };
      const camera = values.camera ? { "obs-virtual-camera": { label: values.camera } } : {};
      const bootstrap = `<script>globalThis.__SOLAR_CONFIG__=${JSON.stringify(config)};globalThis.__ZAB_CAPTURE_DEVICES__=${JSON.stringify(camera)};
        const report=detail=>fetch('/__render_diag',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({lane:new URLSearchParams(location.search).get('resource'),...detail})}).catch(()=>{});
        ${values.meet ? rtcMetrics : ""}
        document.addEventListener('DOMContentLoaded',()=>document.getElementById('scene').addEventListener('solar:lsdp-applied',event=>report({type:'applied',...event.detail})));
        const error=console.error;console.error=(...args)=>{report({type:'error',message:args.map(String).join(' ')});error.apply(console,args)};
        setInterval(()=>report({type:'cache',state:document.documentElement.dataset.solarCache,cached:document.documentElement.dataset.solarCachedScenes}),1500);
      </script>`;
      data = Buffer.from(data.toString("utf8").replace("</head>", bootstrap + "</head>"));
    }
    response.writeHead(200, { "Content-Type": mime[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" }); response.end(data);
  } catch (error) { json(response, error.code === "ENOENT" ? 404 : 500, { code: error.code ?? error.message }); }
});
async function stop() {
  if (closing) return; closing = true;
  if (child?.exitCode === null) { const exited = new Promise(yes => child.once("exit", yes)); child.kill(); await exited; }
  await meet?.stop();
  await native?.stop(); server.closeAllConnections(); await new Promise(yes => server.close(yes));
}
try {
  await new Promise((yes, no) => { server.once("error", no); server.listen(port, "127.0.0.1", yes); });
  native = await startNative(undefined, original, origin, () => void stop());
  if (values.meet) meet = await startMeetProof({ root: resolve(values.meet), port: port + 3, origin, output: values.output, camera: values.camera });
  const env = { ...process.env, ORION_PROFILE: "embedded-local", ORION_LISTEN_ADDR: `127.0.0.1:${port + 1}`,
    ORION_INTERNAL_ADDR: `127.0.0.1:${port + 2}`, ORION_LSDP_NATIVE_ADDRESS: native.address,
    ORION_LOCAL_OPERATOR_SECRET: secret, ORION_LOCAL_AUTH_USER: identity.claims?.subject ?? "operator-1", ORION_OWNER_ID: identity.claims?.owner_id ?? "owner-1", ORION_TENANT_ID: identity.claims?.tenant_id ?? "tenant-1",
    ORION_CANVAS_TRUST_PATH: resolve(orionStorage, "test-trust.json"), ORION_SQLITE_PATH: resolve(orionStorage, "retired-unused.sqlite"),
    ORION_ASSET_ROOT: orionStorage, ORION_SOLAR_ROOT: dist, ORION_SCENE_CACHE_PATH: resolve(orionStorage, "catalog"),
    ORION_SCENE_CONTROL_PATH: resolve(orionStorage, "selection.lsml"), ORION_STREAM_INTENT_PATH: resolve(orionStorage, "stream-control.lsml"),
    ORION_SCENE_BUNDLE_PATH: resolve(orionRoot, "tests/e2e/testdata/canvas-chat-sponso.scene-bundle.json"),
    ORION_CANVAS_BASE_URL: origin + "/canvas", ORION_BLUE_BASE_URL: origin + "/blue", ORION_ZABGATE_URL: origin,
    ORION_ZABAUTH_VALIDATE_URL: origin + "/auth/api/v1/auth/validate", ORION_QUASAR_BASE_URL: origin + "/quasar",
    ORION_DATABASE_URL: "", ORION_SERVICE_TOKEN: "", ORION_SERVICE_REFRESH_TOKEN: "", ORION_SERVICE_TOKEN_STATE_PATH: "",
    ORION_LOCAL_ARTIFACT_ROOT: "", ORION_OVERLAY_APPS_PATH: "", ORION_DATASOURCES: "truth=truth,ranking=ranking" };
  const log = createWriteStream(values.output + "-orion.log");
  child = spawn(resolve(orionRoot, "build/orion-consolidated.exe"), [], { cwd: orionRoot, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log); child.stderr.pipe(log);
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error("Orion exited before readiness: " + child.exitCode);
    try { const response = await fetch(`http://127.0.0.1:${port + 1}/ready`, { signal: AbortSignal.timeout(1000) }); ready = response.ok; await response.body?.cancel(); } catch { /* bounded boot wait */ }
    if (ready) break; await new Promise(yes => setTimeout(yes, 100));
  }
  if (!ready) throw new Error("Orion readiness timeout");
  if (!stats.offline) for (const action of ["prepare-preview", "take-on-air"]) {
    const response = await operator("/api/v1/runtime/scene-catalog", "POST", { intent_id: "cold-prepare", stream_id: "stream-1", action,
      resolved_scene_ref: identity.jws, blue_program: program.toString("base64"), blue_program_digest: programDigest,
      lsml_bundle: Buffer.from(source).toString("base64"), lsml_bundle_digest: hash(source), blue_manifest: identity.manifest });
    if (response.status !== 200) throw new Error("Catalog admission failed: " + JSON.stringify(response));
  }
  console.log(JSON.stringify({ ready: true, origin, nativePid: native.pid, orionPid: child.pid, offline: stats.offline, boundary: identity.boundary }));
} catch (error) { await stop(); throw error; }
process.once("SIGINT", () => void stop()); process.once("SIGTERM", () => void stop());
