import type { CanvasSceneSourceOptions } from "./canvas";
import { encodeSceneSource, sceneSourceKey, decodeSceneSource } from "./cache";
import type { SceneSourceStore } from "./cache";
import type { SceneSourceProvider } from "./types";

export interface SceneCacheSync {
  discovered: number;
  cached: number;
  failures: string[];
  truncated: boolean;
}

/** Discover published scenes using Canvas's bounded, authenticated pagination. */
export async function synchronizeSceneSources(
  options: CanvasSceneSourceOptions,
  provider: SceneSourceProvider,
  store: SceneSourceStore,
  signal: AbortSignal,
  maximum = 64,
): Promise<SceneCacheSync> {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 64)
    throw new Error("SOURCE_CACHE_SYNC_LIMIT");
  const report: SceneCacheSync = {
    discovered: 0,
    cached: 0,
    failures: [],
    truncated: false,
  };
  const api = new URL(options.apiUrl);
  if (
    !/^https?:$/.test(api.protocol) ||
    api.username ||
    api.password ||
    api.search ||
    api.hash
  )
    throw new Error("SOURCE_CACHE_API_INVALID");
  let offset: number | null = 0;
  const seen = new Set<string>();
  while (offset !== null && report.discovered < maximum) {
    signal.throwIfAborted();
    const url = new URL(`${api.pathname.replace(/\/$/, "")}/scenes`, api);
    url.search = new URLSearchParams({
      mine: "true",
      limit: String(Math.min(50, maximum - report.discovered)),
      offset: String(offset),
    }).toString();
    const token =
      typeof options.token === "object"
        ? await options.token.fetch()
        : options.token;
    const response = await (options.fetch ?? fetch)(url, {
      signal,
      redirect: "error",
      credentials: "include",
      cache: "no-store",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok)
      throw new Error(`SOURCE_CACHE_CATALOG_${response.status}`);
    // Bound even a malformed or hostile list response before materializing JSON.
    if (!response.body) throw new Error("SOURCE_CACHE_CATALOG_INVALID");
    const reader = response.body.getReader();
    let text = "",
      size = 0;
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 512 * 1024) throw new Error("SOURCE_CACHE_CATALOG_LIMIT");
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    const page = JSON.parse(text) as {
      items: { id: string }[];
      next_offset: number | null;
    };
    if (
      !Array.isArray(page.items) ||
      page.items.length > 50 ||
      !(
        page.next_offset === null ||
        (Number.isSafeInteger(page.next_offset) && page.next_offset > offset)
      )
    )
      throw new Error("SOURCE_CACHE_CATALOG_INVALID");
    for (const item of page.items) {
      signal.throwIfAborted();
      if (typeof item.id !== "string" || !item.id || seen.has(item.id))
        throw new Error("SOURCE_CACHE_CATALOG_INVALID");
      seen.add(item.id);
      report.discovered++;
      try {
        const source = await provider.get(item.id, { format: "lsmlz", signal });
        const capsule = encodeSceneSource(source); // includes assets + complete Blue closure
        signal.throwIfAborted();
        await store.write(
          sceneSourceKey(source.sceneId, source.sceneVersion, source.format),
          capsule,
        );
        report.cached++;
      } catch {
        signal.throwIfAborted();
        report.failures.push(item.id);
      }
      if (report.discovered >= maximum) break;
    }
    offset = page.next_offset;
  }
  report.truncated = offset !== null;
  return report;
}

/** Rendering remains available online when storage is unavailable or a scene is not offline-ready. */
export function createStartupSceneSourceProvider(
  upstream: SceneSourceProvider,
  store: SceneSourceStore,
): SceneSourceProvider {
  return {
    async get(sceneId, request = {}) {
      request.signal?.throwIfAborted();
      const format = request.format ?? "lsmlz";
      if (request.sceneVersion) {
        let bytes: Uint8Array | null = null;
        try {
          bytes = await store.read(
            sceneSourceKey(sceneId, request.sceneVersion, format),
          );
        } catch {
          /* browser denied storage */
        }
        request.signal?.throwIfAborted();
        if (bytes) {
          const source = decodeSceneSource(bytes);
          if (
            source.sceneId !== sceneId ||
            source.sceneVersion !== request.sceneVersion ||
            source.format !== format
          )
            throw new Error("SOURCE_CACHE_IDENTITY_MISMATCH");
          return source;
        }
      }
      const source = await upstream.get(sceneId, request);
      if (
        source.sceneId !== sceneId ||
        source.format !== format ||
        (request.sceneVersion && source.sceneVersion !== request.sceneVersion)
      )
        throw new Error("SOURCE_CACHE_IDENTITY_MISMATCH");
      if (
        source.blueManifest?.readiness.offline_ready &&
        source.blueManifest.readiness.binding_closure_complete
      ) {
        const capsule = encodeSceneSource(source);
        request.signal?.throwIfAborted();
        try {
          await store.write(
            sceneSourceKey(sceneId, source.sceneVersion, format),
            capsule,
          );
        } catch {
          /* quota / unavailable storage: online source still verified */
        }
      }
      request.signal?.throwIfAborted();
      return source;
    },
  };
}
