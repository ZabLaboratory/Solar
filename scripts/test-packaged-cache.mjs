// Contract fixture: real packaged API and disk I/O, no Canvas validation claim.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { bundleAddress, canonicalize } from "@lumencast/canonical";
import { strToU8, zipSync } from "fflate";
import { FileSceneSourceStore, createCachedSceneSourceProvider } from "../dist/server/index.mjs";

const base = resolve("build");
await mkdir(base, { recursive: true });
const root = await mkdtemp(join(base, "packaged-cache-"));
assert.ok(root.startsWith(base + sep));
const digest = (data) => "sha256:" + createHash("sha256").update(data).digest("hex");
try {
  const document = { lsml: "1.2", scene_id: "cache-contract", scene_version: "", layout: { type: "frame", children: [] }, defaults: { title: "source" } };
  document.scene_version = await bundleAddress(document);
  const bytes = strToU8(canonicalize(document));
  const asset = strToU8("contract asset bytes");
  const assetName = `assets/${digest(asset).slice(7)}.png`;
  const unsigned = {
    schema_version: "zabcanvas.scene-blue-manifest.v1",
    scene_id: document.scene_id, scene_revision: 1, revision_id: "contract-fixture",
    scene_version: document.scene_version, validation: { status: "contract-fixture" },
    declarations: { blueprints: ["fixture-blue"] },
    binding_closure: [{ binding_id: "fixture-blue", source_digest: "fixture" }],
    readiness: { program_ready: true, binding_closure_complete: true, offline_ready: true, missing_binding_ids: [], missing_scene_blueprint_keys: [] },
  };
  const manifest = { ...unsigned, manifest_digest: digest(strToU8(canonicalize(unsigned))) };
  for (const format of ["lsml", "lsmlz"]) {
    const delivery = { sceneId: document.scene_id, revision: 1, sceneVersion: document.scene_version,
      sourceDigest: digest(bytes), format, data: format === "lsml" ? bytes : zipSync({ "scene.lsml": bytes, [assetName]: asset }),
      assets: new Map(format === "lsml" ? [[assetName, asset]] : []), blueManifest: manifest };
    let onlineReads = 0;
    const directory = join(root, format);
    const provider = createCachedSceneSourceProvider({ get: async () => { onlineReads++; return delivery; } }, new FileSceneSourceStore(directory));
    const online = await provider.get(document.scene_id, { format });
    online.data.fill(0);
    online.blueManifest.binding_closure = [];
    let offlineRequests = 0;
    const offline = createCachedSceneSourceProvider({ get: async () => { offlineRequests++; throw new Error("offline"); } }, new FileSceneSourceStore(directory));
    const restored = await offline.get(document.scene_id, { format, sceneVersion: document.scene_version });
    assert.deepEqual(restored.data, delivery.data);
    assert.equal(restored.blueManifest.binding_closure.length, 1);
    assert.equal(onlineReads, 1);
    assert.equal(offlineRequests, 0);
    assert.equal((await readdir(directory)).length, 1);
    await assert.rejects(offline.get(document.scene_id, { format }), /offline/);
  }
  console.log(JSON.stringify({ result: "PASS", boundary: "compiled server export and durable disk cache", fixture: "synthetic contract; not a Canvas validation or visual proof", formats: ["lsml", "lsmlz"], assetsAndBlueClosureRestored: true, newProviderOfflineExactReads: true, noLatestDiscoveryOffline: true, callerMutationIsolated: true, retainedLiveMutation: false }));
} finally {
  await rm(root, { recursive: true, force: true });
}
