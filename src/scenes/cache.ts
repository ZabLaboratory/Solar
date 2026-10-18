import { canonicalize, withZeroedSceneVersion } from "@lumencast/canonical";
import { sha1 } from "@noble/hashes/sha1";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { strToU8, strFromU8, unzipSync, zipSync } from "fflate";
import { SceneSourceError } from "./types";
import type { SceneSourceDelivery, SceneSourceProvider } from "./types";

const ADDRESS = /^sha256:[a-f0-9]{64}$/;
const MIB = 1024 * 1024;
const hash = (bytes: Uint8Array): string =>
  `sha256:${bytesToHex(sha256(bytes))}`;
const fail = (): never => {
  throw new SceneSourceError("SOURCE_INTEGRITY_FAILED");
};

interface ContentAddress {
  algorithm: "sha1" | "sha256";
  digest: string;
}

function contentAddress(path: string): ContentAddress | null {
  const name = path.slice("assets/".length);
  if (name.includes("/")) return null;
  const match = /^(?:([a-f0-9]{40})|([a-f0-9]{64}))\.[a-z0-9]{1,12}$/.exec(
    name,
  );
  if (!match) return null;
  return match[1]
    ? { algorithm: "sha1", digest: match[1] }
    : { algorithm: "sha256", digest: match[2]! };
}

function safePackagePath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 1024 &&
    !path.startsWith("/") &&
    !path.startsWith("\\") &&
    !path.includes("\\") &&
    !path.includes(":") &&
    ![...path].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    }) &&
    path
      .split("/")
      .every(
        (segment) =>
          segment.length > 0 &&
          segment !== "." &&
          segment !== ".." &&
          !segment.endsWith(".") &&
          !segment.endsWith(" "),
      )
  );
}

function nestedArchive(path: string): boolean {
  const lower = path.toLowerCase();
  return [".lsmlz", ".zip", ".tar", ".tgz", ".gz", ".7z"].some((suffix) =>
    lower.endsWith(suffix),
  );
}

function safeArchiveEntry(name: string): {
  isDirectory: boolean;
  ignored: boolean;
} {
  const isDirectory = name.endsWith("/");
  const path = isDirectory ? name.slice(0, -1) : name;
  if (!safePackagePath(path)) return fail();
  const top = path.split("/")[0]!;
  const ignored = top.startsWith("_");
  const lsmlDocument =
    !path.includes("/") && /\.(?:lsml|lsml\.json)$/i.test(path);
  const asset = path === "assets" || path.startsWith("assets/");
  if (
    (isDirectory &&
      !ignored &&
      path !== "assets" &&
      !path.startsWith("assets/")) ||
    (!isDirectory && !ignored && !asset && !lsmlDocument)
  )
    return fail();
  if (!isDirectory && nestedArchive(path)) return fail();
  return { isDirectory, ignored };
}

function safeCacheEntry(name: string): {
  isDirectory: boolean;
  ignored: boolean;
} {
  const isDirectory = name.endsWith("/");
  const path = isDirectory ? name.slice(0, -1) : name;
  if (!safePackagePath(path)) return fail();
  const asset = path === "assets" || path.startsWith("assets/");
  if (
    (isDirectory && path !== "assets" && !path.startsWith("assets/")) ||
    (!isDirectory && path !== "metadata.json" && path !== "source" && !asset)
  )
    return fail();
  return { isDirectory, ignored: false };
}

function verifyAsset(path: string, bytes: Uint8Array): void {
  if (
    !path.startsWith("assets/") ||
    !safePackagePath(path) ||
    nestedArchive(path)
  )
    return fail();
  const address = contentAddress(path);
  if (!address) return;
  const actual =
    address.algorithm === "sha1"
      ? bytesToHex(sha1(bytes))
      : bytesToHex(sha256(bytes));
  if (actual !== address.digest) fail();
}

function assetReferences(value: unknown, result: Set<string>): void {
  if (typeof value === "string" && value.startsWith("assets/")) {
    if (value.length > 1024 || !safePackagePath(value)) fail();
    result.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assetReferences(item, result);
    return;
  }
  if (value && typeof value === "object")
    for (const item of Object.values(value)) assetReferences(item, result);
}

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

function unpack(
  data: Uint8Array,
  packageArchive = false,
): Record<string, Uint8Array> {
  if (data.byteLength > 132 * MIB)
    throw new SceneSourceError("SOURCE_RESOURCE_LIMIT");
  let size = 0;
  const seen = new Set<string>();
  try {
    return unzipSync(data, {
      filter: (entry) => {
        if (entry.name.length > 1024) return fail();
        const { isDirectory, ignored } = packageArchive
          ? safeArchiveEntry(entry.name)
          : safeCacheEntry(entry.name);
        const normalizedName = entry.name.replace(/[A-Z]/g, (letter) =>
          letter.toLowerCase(),
        );
        if (seen.has(normalizedName)) return fail();
        seen.add(normalizedName);
        size += entry.originalSize;
        if (
          seen.size > 4096 ||
          size > 128 * MIB ||
          entry.originalSize > 64 * MIB
        )
          throw new SceneSourceError("SOURCE_RESOURCE_LIMIT");
        return !isDirectory && !ignored;
      },
    });
  } catch (error) {
    if (error instanceof SceneSourceError) throw error;
    return fail();
  }
}

/** Verify pinned source bytes; cache callers also require complete offline Blue closure. */
export function verifySceneSource(
  source: SceneSourceDelivery,
  options: { requireOfflineReady?: boolean } = {},
): { document: Record<string, unknown>; expandedBytes: number } {
  const manifest = source.blueManifest;
  if (
    !["lsml", "lsmlz"].includes(source.format) ||
    !manifest ||
    manifest.schema_version !== "zabcanvas.scene-blue-manifest.v1" ||
    manifest.scene_id !== source.sceneId ||
    manifest.scene_version !== source.sceneVersion ||
    manifest.scene_revision !== source.revision ||
    !Number.isSafeInteger(source.revision) ||
    source.revision < 1 ||
    !ADDRESS.test(source.sourceDigest) ||
    !ADDRESS.test(source.sceneVersion) ||
    typeof manifest.readiness?.offline_ready !== "boolean" ||
    typeof manifest.readiness.binding_closure_complete !== "boolean" ||
    (options.requireOfflineReady !== false &&
      (!manifest.readiness.offline_ready ||
        !manifest.readiness.binding_closure_complete)) ||
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
      ? unpack(source.data, true)
      : Object.fromEntries(source.assets);
  if (Object.keys(files).length + (source.format === "lsmlz" ? 0 : 1) > 4096)
    throw new SceneSourceError("SOURCE_RESOURCE_LIMIT");
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
  const references = new Set<string>();
  assetReferences(document, references);
  for (const path of references) {
    if (!files[path]) fail();
  }
  let size = documentBytes.byteLength;
  for (const [path, bytes] of Object.entries(files)) {
    if (path === "scene.lsml" && source.format === "lsmlz") continue;
    verifyAsset(path, bytes);
    size += bytes.byteLength;
    if (bytes.byteLength > 32 * MIB || size > 128 * MIB)
      throw new SceneSourceError("SOURCE_RESOURCE_LIMIT");
  }
  return { document, expandedBytes: size };
}

export function encodeSceneSource(source: SceneSourceDelivery): Uint8Array {
  verifySceneSource(source);
  const { data, assets, ...metadata } = source;
  const transportAssetDigests =
    source.format === "lsml"
      ? Object.fromEntries(
          [...assets].map(([path, bytes]) => [path, hash(bytes)]),
        )
      : undefined;
  return zipSync(
    {
      "metadata.json": strToU8(
        canonicalize({
          ...metadata,
          schema: "solar.scene-cache.v1",
          transport_digest: hash(data),
          ...(transportAssetDigests
            ? { transport_asset_digests: transportAssetDigests }
            : {}),
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
  if (metadata.format === "lsml") {
    const digests = metadata.transport_asset_digests;
    const paths = Object.keys(files).sort();
    if (digests === undefined) {
      // Older capsules only admitted content-addressed assets.
      if (paths.some((path) => !contentAddress(path))) fail();
    } else {
      if (
        !digests ||
        typeof digests !== "object" ||
        Array.isArray(digests) ||
        JSON.stringify(Object.keys(digests).sort()) !== JSON.stringify(paths)
      )
        fail();
      const expectedDigests = digests as Record<string, unknown>;
      for (const path of paths) {
        if (expectedDigests[path] !== hash(files[path]!)) fail();
      }
    }
  }
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

/** Re-express a verified LSMLZ package for providers that serve plain LSML assets. */
export function asPlainSceneSource(
  source: SceneSourceDelivery,
): SceneSourceDelivery {
  if (source.format === "lsml") {
    verifySceneSource(source, { requireOfflineReady: false });
    return source;
  }
  const files = unpack(source.data, true);
  const data = files["scene.lsml"];
  if (!data) return fail();
  delete files["scene.lsml"];
  const plain: SceneSourceDelivery = {
    ...source,
    format: "lsml",
    data,
    assets: new Map(Object.entries(files)),
  };
  verifySceneSource(plain, { requireOfflineReady: false });
  return plain;
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
