import { canonicalize } from "@lumencast/canonical";
import type { SolarToken } from "../types";
import { SceneSourceError } from "./types";
import type {
  SceneBlueManifest,
  SceneSourceDelivery,
  SceneSourceProvider,
  SceneSourceRequest,
} from "./types";

const ADDRESS = /^sha256:[0-9a-f]{64}$/;
const ASSET = /^assets\/([0-9a-f]{64})\.[a-z0-9]{1,12}$/;
const MIB = 1024 * 1024;

export interface CanvasSceneSourceOptions {
  /** Trusted HTTP API root, including gateway prefix if used. */
  apiUrl: string;
  token?: SolarToken;
  fetch?: typeof globalThis.fetch;
}

interface Descriptor {
  revision: number;
  scene_version: string;
  source_digest: string;
  lsml: string;
  lsmlz: string;
  assets: Record<string, string>;
  blue_manifest: SceneBlueManifest;
}

function invalid(): never {
  throw new SceneSourceError("SOURCE_DESCRIPTOR_INVALID");
}

function descriptor(value: unknown): Descriptor {
  if (!value || typeof value !== "object") return invalid();
  const d = value as Partial<Descriptor>;
  if (
    !Number.isSafeInteger(d.revision) ||
    (d.revision ?? 0) < 1 ||
    typeof d.scene_version !== "string" ||
    !ADDRESS.test(d.scene_version) ||
    typeof d.source_digest !== "string" ||
    !ADDRESS.test(d.source_digest) ||
    typeof d.lsml !== "string" ||
    typeof d.lsmlz !== "string" ||
    !d.assets ||
    typeof d.assets !== "object" ||
    Array.isArray(d.assets) ||
    !d.blue_manifest ||
    typeof d.blue_manifest !== "object"
  )
    return invalid();
  if (Object.keys(d.assets).length > 4095)
    throw new SceneSourceError("SOURCE_RESOURCE_LIMIT");
  for (const [path, link] of Object.entries(d.assets)) {
    if (!ASSET.test(path) || typeof link !== "string") return invalid();
  }
  return d as Descriptor;
}

async function validateBlueManifest(
  value: SceneBlueManifest,
  sceneId: string,
  revision: number,
  sceneVersion: string,
): Promise<void> {
  if (
    value.schema_version !== "zabcanvas.scene-blue-manifest.v1" ||
    value.scene_id !== sceneId ||
    value.scene_revision !== revision ||
    value.scene_version !== sceneVersion ||
    !ADDRESS.test(value.manifest_digest) ||
    !value.readiness ||
    typeof value.readiness.offline_ready !== "boolean" ||
    !Array.isArray(value.binding_closure)
  ) {
    invalid();
  }
  const { manifest_digest: _digest, ...unsigned } = value;
  const bytes = new TextEncoder().encode(canonicalize(unsigned));
  const actual = await digest(bytes);
  if (actual !== value.manifest_digest) {
    throw new SceneSourceError("SOURCE_INTEGRITY_FAILED");
  }
}

async function bytes(
  response: Response,
  max: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (Number(response.headers.get("content-length") ?? 0) > max) {
    await response.body?.cancel();
    throw new SceneSourceError("SOURCE_RESOURCE_LIMIT");
  }
  if (!response.body) throw new SceneSourceError("SOURCE_REQUEST_FAILED");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) throw new SceneSourceError("SOURCE_RESOURCE_LIMIT");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function digest(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(data));
  return (
    "sha256:" +
    Array.from(new Uint8Array(hash), (v) =>
      v.toString(16).padStart(2, "0"),
    ).join("")
  );
}

/** Obtain the published, validated scene by Canvas id, without compiling it.
 * This provider owns no cache and never mounts a renderer. The cache/startup
 * adapters wrap this SceneSourceProvider contract without changing delivery.
 */
export function createCanvasSceneSourceProvider(
  options: CanvasSceneSourceOptions,
): SceneSourceProvider {
  const api = new URL(options.apiUrl);
  if (
    !["http:", "https:"].includes(api.protocol) ||
    api.username ||
    api.password ||
    api.search ||
    api.hash
  ) {
    throw new TypeError("Solar scene source requires a trusted HTTP API root");
  }
  api.pathname = api.pathname.replace(/\/+$/, "") + "/";
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  return {
    async get(
      sceneId: string,
      request: SceneSourceRequest = {},
    ): Promise<SceneSourceDelivery> {
      if (!sceneId || sceneId === "." || sceneId === "..")
        throw new TypeError("A scene identifier is required");
      const format = request.format ?? "lsmlz";
      if (format !== "lsml" && format !== "lsmlz")
        throw new TypeError("Unknown scene source format");
      request.signal?.throwIfAborted();
      const token =
        typeof options.token === "string"
          ? options.token
          : await options.token?.fetch();
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
      const endpoint = new URL(
        `scenes/${encodeURIComponent(sceneId)}/source`,
        api,
      );
      if (request.sceneVersion !== undefined) {
        if (!ADDRESS.test(request.sceneVersion)) invalid();
        endpoint.searchParams.set("version", request.sceneVersion);
      }
      const fetchBytes = async (url: URL, limit: number) => {
        const response = await fetcher(url.href, {
          headers,
          credentials: "include",
          signal: request.signal,
          redirect: "error",
          cache: "no-store",
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new SceneSourceError("SOURCE_REQUEST_FAILED");
        }
        return { data: await bytes(response, limit, request.signal), response };
      };
      try {
        const meta = await fetchBytes(endpoint, MIB);
        let parsed: unknown;
        try {
          parsed = JSON.parse(new TextDecoder().decode(meta.data));
        } catch {
          return invalid();
        }
        const d = descriptor(parsed);
        if (
          request.sceneVersion !== undefined &&
          d.scene_version !== request.sceneVersion
        ) {
          throw new SceneSourceError("SOURCE_INTEGRITY_FAILED");
        }
        await validateBlueManifest(
          d.blue_manifest,
          sceneId,
          d.revision,
          d.scene_version,
        );
        const root = new URL(`revisions/${d.revision}/`, endpoint);
        const link = (relative: string, suffix: string): URL => {
          const url = new URL(relative, endpoint);
          // Never forward a host credential to a descriptor-controlled origin,
          // another scene, a mutable alias or an unpinned version.
          if (
            url.origin !== api.origin ||
            url.username ||
            url.password ||
            url.hash ||
            url.pathname !== root.pathname + suffix ||
            url.searchParams.get("version") !== d.scene_version ||
            [...url.searchParams.keys()].some((key) => key !== "version") ||
            url.searchParams.getAll("version").length !== 1
          )
            return invalid();
          return url;
        };
        const sourceUrl = link(d[format], `source.${format}`);
        const source = await fetchBytes(
          sourceUrl,
          format === "lsmlz" ? 64 * MIB : 8 * MIB,
        );
        if (
          source.response.headers.get("x-scene-version") !== d.scene_version ||
          source.response.headers.get("x-scene-revision") !== String(d.revision)
        ) {
          throw new SceneSourceError("SOURCE_INTEGRITY_FAILED");
        }
        const transportDigest = await digest(source.data);
        if (
          source.response.headers.get("etag") !== `"${transportDigest}"` ||
          (format === "lsml" && transportDigest !== d.source_digest)
        ) {
          throw new SceneSourceError("SOURCE_INTEGRITY_FAILED");
        }
        const assets = new Map<string, Uint8Array>();
        let expanded = source.data.byteLength;
        if (format === "lsml") {
          for (const [path, relative] of Object.entries(d.assets)) {
            const asset = await fetchBytes(
              link(relative, path),
              Math.min(32 * MIB, 128 * MIB - expanded),
            );
            if (
              (await digest(asset.data)) !== `sha256:${ASSET.exec(path)![1]}`
            ) {
              throw new SceneSourceError("SOURCE_INTEGRITY_FAILED");
            }
            expanded += asset.data.byteLength;
            assets.set(path, asset.data);
          }
        }
        request.signal?.throwIfAborted();
        return {
          sceneId,
          revision: d.revision,
          sceneVersion: d.scene_version,
          sourceDigest: d.source_digest,
          format,
          data: source.data,
          assets,
          blueManifest: d.blue_manifest,
        };
      } catch (error) {
        if (request.signal?.aborted || error instanceof SceneSourceError)
          throw error;
        throw new SceneSourceError("SOURCE_REQUEST_FAILED");
      }
    },
  };
}
