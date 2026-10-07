// Actual gateway authentication and Canvas delivery. No identity injection or fallback.
import assert from "node:assert/strict";
import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createCanvasSceneSourceProvider } from "../dist/solar.js";
import { createCachedSceneSourceProvider, FileSceneSourceStore } from "../dist/server/index.mjs";

const [sessionPath, credentialPath, sceneId, outputPrefix] = process.argv.slice(2);
if (!outputPrefix) throw new Error("Expected session, credential file, scene id, evidence prefix");
const prefix = resolve(outputPrefix);
await mkdir(dirname(prefix), { recursive: true });
const session = JSON.parse(await readFile(sessionPath, "utf8"));
const credentials = {};
for (const line of (await readFile(credentialPath, "utf8")).split(/\r?\n/)) {
  const match = /^\s*(PRISM_E2E_OPERATOR_EMAIL|PRISM_E2E_OPERATOR_PASSWORD)\s*=\s*(.*)$/.exec(line);
  if (match) credentials[match[1]] = match[2].replace(/^["']|["']$/g, "");
}
const digest = (data) => "sha256:" + createHash("sha256").update(data).digest("hex");
const report = { result: "RUNNING", sceneId, authentication: "actual ZabAuth through ZabGate; credential RAM only", http: [], boundaries: [], cache: null };
let token;
async function request(route, options = {}) {
  const response = await fetch(session.gatewayUrl + route, {
    ...options,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
    signal: AbortSignal.timeout(15000), redirect: "error", cache: "no-store",
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  let json;
  try { json = JSON.parse(new TextDecoder().decode(bytes)); } catch { /* report only metadata */ }
  report.http.push({ method: options.method ?? "GET", route, status: response.status,
    bytes: bytes.length, keys: json && typeof json === "object" ? Object.keys(json) : [],
    // Never record login/session bodies or bearer-like values.
    ...(route.includes("/auth/") ? {} : { bodyDigest: digest(bytes) }),
    ...(response.ok ? {} : { code: json?.code ?? json?.detail?.code, requestId: json?.requestId ?? json?.request_id }),
  });
  return { response, bytes, json };
}
try {
  const login = await request("/auth/api/v1/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: credentials.PRISM_E2E_OPERATOR_EMAIL,
      password: credentials.PRISM_E2E_OPERATOR_PASSWORD, keep_signed_in: false }),
  });
  delete credentials.PRISM_E2E_OPERATOR_PASSWORD;
  assert.equal(login.response.status, 200, "Actual login rejected");
  token = login.json.access_token;
  const me = await request("/auth/api/v1/auth/me");
  assert.equal(me.response.status, 200, "Actual identity rejected");
  report.principal = me.json.id;
  const trust = await request("/canvas/api/v1/scenes/resolved-scene-ref/trust");
  assert.equal(trust.response.status, 200, "Public Canvas trust unavailable");
  const unsigned = await fetch(session.gatewayUrl + `/canvas/api/v1/scenes/${sceneId}/source`, {
    redirect: "error", signal: AbortSignal.timeout(15000),
  });
  report.unauthenticatedSourceStatus = unsigned.status;
  await unsigned.body?.cancel();
  const source = await request(`/canvas/api/v1/scenes/${sceneId}/source`);
  if (!source.response.ok) report.boundaries.push(`CANVAS_SOURCE_HTTP_${source.response.status}`);
  const issuance = await request(`/canvas/api/v1/scenes/${sceneId}/resolved-scene-ref`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ canvas_request_key: `solar-offline-${randomUUID()}`,
      stream_id: "solar-offline-proof", allowed_actions: ["prepare-preview", "take-on-air"] }),
  });
  if (!issuance.response.ok) report.boundaries.push(`CANVAS_REFERENCE_HTTP_${issuance.response.status}`);
  else {
    const { jws, claims } = issuance.json;
    const parts = jws.split(".");
    const encodedKey = trust.json.keys[claims.kid];
    assert.equal(typeof encodedKey, "string", "Unknown public signing key shape");
    const publicKey = createPublicKey({ format: "der", type: "spki",
      key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(encodedKey, "base64")]) });
    assert.ok(verify(null, Buffer.from(parts[0] + "." + parts[1]), publicKey, Buffer.from(parts[2], "base64url")));
    assert.equal(claims.subject, report.principal);
    const payload = JSON.parse(Buffer.from(parts[1], "base64url"));
    assert.deepEqual(payload, claims);
    report.reference = { signatureVerified: true, jwsDigest: digest(jws), claims };
    assert.ok(claims.canvas_locator.startsWith(`/api/v1/scenes/${sceneId}/resolved-scene-ref/`));
    const envelope = await request("/canvas" + claims.canvas_locator);
    // Dereference is broker-only. An operator bearer deliberately cannot access
    // it: its 404 is an authorization boundary, not missing producer artifacts.
    assert.equal(envelope.response.status, 404, "Operator unexpectedly accessed broker-only artifacts");
    report.brokerBoundary = { operatorDereferenceDenied: true, brokerRetrieval: "NOT_TESTED_REQUIRES_MTLS_DELEGATION" };
  }
  if (!report.boundaries.length) {
    const calls = [];
    const provider = createCanvasSceneSourceProvider({ apiUrl: session.gatewayUrl + "/canvas/api/v1", token,
      fetch: async (url, options) => { calls.push(new URL(url).pathname); return fetch(url, options); } });
    const cachePath = resolve("build", "authenticated-source-cache", report.principal);
    const cached = createCachedSceneSourceProvider(provider, new FileSceneSourceStore(cachePath));
    const archive = await cached.get(sceneId);
    const plain = await cached.get(sceneId, { format: "lsml", sceneVersion: archive.sceneVersion });
    assert.equal(archive.sourceDigest, plain.sourceDigest);
    let offlineRequests = 0;
    const offline = createCachedSceneSourceProvider({ get: async () => { offlineRequests++; throw new Error("OFFLINE"); } },
      new FileSceneSourceStore(cachePath));
    const restored = await offline.get(sceneId, { sceneVersion: archive.sceneVersion });
    assert.deepEqual(restored.data, archive.data);
    assert.deepEqual(restored.blueManifest, archive.blueManifest);
    assert.equal(offlineRequests, 0);
    report.cache = { sceneVersion: archive.sceneVersion, sourceDigest: archive.sourceDigest,
      archiveDigest: digest(archive.data), assets: plain.assets.size, blueManifestDigest: archive.blueManifest.manifest_digest,
      bindingClosure: archive.blueManifest.binding_closure.length, offlineRequests, calls };
  }
  report.result = report.boundaries.length ? "BLOCKED_PRODUCER" : "PASS_ACQUISITION_AND_CACHE";
} catch (error) {
  report.result = "FAIL";
  report.error = error.code ?? error.message;
} finally {
  await writeFile(prefix + "-report.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ result: report.result, boundaries: report.boundaries, evidence: prefix + "-report.json" }));
  if (report.result !== "PASS_ACQUISITION_AND_CACHE") process.exitCode = 1;
}
