import { canonicalize, bundleAddress } from "@lumencast/canonical";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { strToU8, zipSync } from "fflate";
import type { SceneSourceDelivery } from "../../src/scenes/types";
import { nativeManifest } from "./native-source";
const hash = (bytes: Uint8Array) => `sha256:${bytesToHex(sha256(bytes))}`;
export async function cacheSource(
  format: "lsml" | "lsmlz" = "lsmlz",
): Promise<SceneSourceDelivery> {
  const asset = strToU8("asset bytes");
  const path = `assets/${hash(asset).slice(7)}.png`;
  const document = {
    lsml: "1.2",
    scene_id: "complete-scene",
    scene_version: "",
    layout: { type: "frame", children: [] },
    defaults: { title: "published" },
  };
  document.scene_version = await bundleAddress(document);
  const bytes = strToU8(canonicalize(document));
  const manifest = nativeManifest(document.scene_id, document.scene_version);
  manifest.readiness.offline_ready = true;
  manifest.readiness.binding_closure_complete = true;
  manifest.binding_closure = [
    { binding_id: "blue-1", source_digest: "validated-blue" },
  ];
  const { manifest_digest: _digest, ...unsigned } = manifest;
  manifest.manifest_digest = hash(strToU8(canonicalize(unsigned)));
  return {
    sceneId: document.scene_id,
    sceneVersion: document.scene_version,
    revision: 1,
    sourceDigest: hash(bytes),
    format,
    data:
      format === "lsmlz"
        ? zipSync({ "scene.lsml": bytes, [path]: asset })
        : bytes,
    assets: format === "lsml" ? new Map([[path, asset]]) : new Map(),
    blueManifest: manifest,
  };
}
