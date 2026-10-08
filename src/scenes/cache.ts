import { canonicalize, withZeroedSceneVersion } from "@lumencast/canonical";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { strToU8, strFromU8, unzipSync, zipSync } from "fflate";
import { SceneSourceError } from "./types";
import type { SceneSourceDelivery, SceneSourceProvider } from "./types";

const ADDRESS = /^sha256:[a-f0-9]{64}$/;
const ASSET = /^assets\/([a-f0-9]{64})\.[a-z0-9]{1,12}$/;
const MIB = 1024 * 1024;
const hash = (bytes: Uint8Array): string =>
  `sha256:${bytesToHex(sha256(bytes))}`;
const fail = (): never => {
  throw new SceneSourceError("SOURCE_INTEGRITY_FAILED");
};

/** Storage is an application-owned boundary; it never receives tokens or live LSML. */
export interface SceneSourceStore {
  read(key: string): Promise<Uint8Array | null>;
  write(key: string, value: Uint8Array): Promise<void>;
}

export function sceneSourceKey(
  sceneId: string,
  sceneVersion: string,
  format: "lsml" | "lsmlz",
): string {
  if (
    !sceneId ||
    !ADDRESS.test(sceneVersion) ||
    !["lsml", "lsmlz"].includes(format)
  )
    fail();
  return bytesToHex(
    sha256(strToU8(canonicalize([sceneId, sceneVersion, format]))),
  );
}

function unpack(data: Uint8Array): Record<string, Uint8Array> {
  if (data.byteLength > 132 * MIB)
    throw new SceneSourceError("SOURCE_RESOURCE_LIMIT");
  let size = 0,
    count = 0;
  try {
    return unzipSync(data, {
      filter: (entry) => {
        size += entry.originalSize;
        if (++count > 4098 || size > 132 * MIB || entry.originalSize > 64 * MIB)
          throw new SceneSourceError("SOURCE_RESOURCE_LIMIT");
        return true;
      },
    });
  } catch (error) {
    if (error instanceof SceneSourceError) throw error;
    return fail();
  }
}

/** Revalidate cached bytes, including Blue closure, before they become a source. */
export function verifySceneSource(source: SceneSourceDelivery): void {
  const manifest = source.blueManifest;
  if (
    !manifest ||
    manifest.schema_version !== "zabcanvas.scene-blue-manifest.v1" ||
    manifest.scene_id !== source.sceneId ||
    manifest.scene_version !== source.sceneVersion ||
    manifest.scene_revision !== source.revision ||
    !Number.isSafeInteger(source.revision) ||
    source.revision < 1 ||
    !ADDRESS.test(source.sourceDigest) ||
    !ADDRESS.test(source.sceneVersion) ||
    !manifest.readiness?.offline_ready ||
    !manifest.readiness.binding_closure_complete ||
    !Array.isArray(manifest.binding_closure) ||
    !manifest.declarations ||
    !manifest.validation
  )
    fail();
  const { manifest_digest, ...unsigned } = manifest;
  if (hash(strToU8(canonicalize(unsigned))) !== manifest_digest) fail();
  if (source.data.byteLength > (source.format === "lsmlz" ? 64 : 8) * MIB)
    throw new SceneSourceError("SOURCE_RESOURCE_LIMIT");
  const files =
    source.format === "lsmlz"
      ? unpack(source.data)
      : Object.fromEntries(source.assets);
  const documentBytes =
    source.format === "lsmlz" ? files["scene.lsml"] : source.data;
  if (!documentBytes) return fail();
  if (
    !documentBytes ||
    documentBytes.byteLength > 8 * MIB ||
    hash(documentBytes) !== source.sourceDigest
  )
    fail();
  let document: Record<string, unknown>;
  try {
    document = JSON.parse(strFromU8(documentBytes));
  } catch {
    return fail();
  }
  if (
    !document ||
    document.scene_id !== source.sceneId ||
    document.scene_version !== source.sceneVersion ||
    !["1.0", "1.1", "1.2"].includes(String(document.lsml)) ||
    !document.layout
  )
    fail();
  if (
    hash(strToU8(canonicalize(withZeroedSceneVersion(document)))) !==
    source.sceneVersion
  )
    fail();
  let size = documentBytes.byteLength;
  for (const [path, bytes] of Object.entries(files)) {
    if (path === "scene.lsml" && source.format === "lsmlz") continue;
    const match = ASSET.exec(path);
    if (!match || hash(bytes) !== `sha256:${match[1]}`) fail();
    size += bytes.byteLength;
    if (bytes.byteLength > 32 * MIB || size > 128 * MIB)
      throw new SceneSourceError("SOURCE_RESOURCE_LIMIT");
  }
}

export function encodeSceneSource(source: SceneSourceDelivery): Uint8Array {
  verifySceneSource(source);
  const { data, assets, ...metadata } = source;
  return zipSync(
    {
      "metadata.json": strToU8(
        canonicalize({
          schema: "solar.scene-cache.v1",
          transport_digest: hash(data),
          ...metadata,
        }),
      ),
      source: data,
      ...(source.format === "lsml" ? Object.fromEntries(assets) : {}),
    },
    { level: 0, mtime: new Date(1980, 0, 1) },
  );
}

export function decodeSceneSource(bytes: Uint8Array): SceneSourceDelivery {
  const files = unpack(bytes);
  let metadata: Record<string, unknown>;
  try {
    metadata = JSON.parse(strFromU8(files["metadata.json"]!));
  } catch {
    return fail();
  }
  if (
    metadata?.schema !== "solar.scene-cache.v1" ||
    !["lsml", "lsmlz"].includes(String(metadata.format)) ||
    !files.source
  )
    fail();
  delete files["metadata.json"];
  const data = files.source!;
  if (metadata.transport_digest !== hash(data)) fail();
  delete files.source;
  if (metadata.format === "lsmlz" && Object.keys(files).length !== 0) fail();
  const source = {
    sceneId: metadata.sceneId,
    sceneVersion: metadata.sceneVersion,
    sourceDigest: metadata.sourceDigest,
    revision: metadata.revision,
    format: metadata.format,
    blueManifest: metadata.blueManifest,
    data,
    assets: new Map(Object.entries(files)),
  } as unknown as SceneSourceDelivery;
  verifySceneSource(source);
  return source;
}

/** Exact revisions use verified local bytes. Unpinned discovery always uses Canvas. */
export function createCachedSceneSourceProvider(
  upstream: SceneSourceProvider,
  store: SceneSourceStore,
): SceneSourceProvider {
  return {
    async get(sceneId, request = {}) {
      request.signal?.throwIfAborted();
      const format = request.format ?? "lsmlz";
      if (request.sceneVersion) {
        const key = sceneSourceKey(sceneId, request.sceneVersion, format);
        const cached = await store.read(key);
        request.signal?.throwIfAborted();
        if (cached) {
          const source = decodeSceneSource(cached);
          if (
            source.sceneId !== sceneId ||
            source.sceneVersion !== request.sceneVersion ||
            source.format !== format
          )
            fail();
          return source;
        }
      }
      const source = await upstream.get(sceneId, request);
      if (
        source.sceneId !== sceneId ||
        source.format !== format ||
        (request.sceneVersion && source.sceneVersion !== request.sceneVersion)
      )
        fail();
      const encoded = encodeSceneSource(source);
      request.signal?.throwIfAborted();
      await store.write(
        sceneSourceKey(sceneId, source.sceneVersion, format),
        encoded,
      );
      request.signal?.throwIfAborted();
      return decodeSceneSource(encoded);
    },
  };
}
