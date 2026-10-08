import { bundleAddress } from "@lumencast/canonical";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { requireLSML, type LSMLDocument } from "./native-document";
import { SceneSourceError, type LocalSceneSourceDelivery } from "./types";

/** Editable sources arrive atomically with the active document through LSDP only. */
export async function readNativeAuthoringSource(
  active: LSMLDocument,
): Promise<LocalSceneSourceDelivery | null> {
  const value = active["x-solar-authoring"];
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new SceneSourceError("SOURCE_DESCRIPTOR_INVALID");
  const envelope = value as {
    format?: unknown;
    lsml_bundle?: unknown;
    assets?: Record<string, unknown>;
    fonts?: unknown;
  };
  if (
    envelope.format !== "solar.authoring/1" ||
    !envelope.assets ||
    typeof envelope.assets !== "object" ||
    Array.isArray(envelope.assets)
  )
    throw new SceneSourceError("SOURCE_DESCRIPTOR_INVALID");
  const fonts = envelope.fonts ?? [];
  if (
    !Array.isArray(fonts) ||
    fonts.length > 2048 ||
    fonts.some(
      (font) => typeof font !== "string" || !/^[a-f0-9]{64}$/.test(font),
    )
  )
    throw new SceneSourceError("SOURCE_DESCRIPTOR_INVALID");
  const document = requireLSML(envelope.lsml_bundle);
  if (
    document.scene_id !== active.scene_id ||
    document.scene_version !== active.scene_version ||
    Object.hasOwn(document, "x-solar-authoring") ||
    (await bundleAddress(document)) !== document.scene_version
  )
    throw new SceneSourceError("SOURCE_INTEGRITY_FAILED");
  const source = new TextEncoder().encode(JSON.stringify(document));
  let size = source.length;
  const assets = new Map<string, Uint8Array>();
  const entries = Object.entries(envelope.assets);
  if (entries.length > 2048)
    throw new SceneSourceError("SOURCE_RESOURCE_LIMIT");
  for (const [path, encoded] of entries) {
    const match = /^assets\/([a-f0-9]{64})\.[a-z0-9]{1,12}$/.exec(path);
    if (!match || typeof encoded !== "string")
      throw new SceneSourceError("SOURCE_INTEGRITY_FAILED");
    size += path.length + encoded.length;
    if (size > 16 * 1024 * 1024)
      throw new SceneSourceError("SOURCE_RESOURCE_LIMIT");
    if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))
      throw new SceneSourceError("SOURCE_INTEGRITY_FAILED");
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    if (bytesToHex(sha256(bytes)) !== match[1])
      throw new SceneSourceError("SOURCE_INTEGRITY_FAILED");
    assets.set(path, bytes);
  }
  if (size > 16 * 1024 * 1024)
    throw new SceneSourceError("SOURCE_RESOURCE_LIMIT");
  return {
    provenance: "local-authoring",
    fontDigests: fonts,
    sceneId: document.scene_id,
    revision: 0,
    sceneVersion: document.scene_version,
    sourceDigest: `sha256:${bytesToHex(sha256(source))}`,
    format: "lsml",
    data: source,
    assets,
  };
}
