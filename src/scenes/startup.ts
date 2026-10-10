import type { CanvasSceneSourceOptions } from "./canvas";
import { encodeSceneSource, sceneSourceKey, decodeSceneSource } from "./cache";
import type { SceneSourceStore } from "./cache";
import type { SceneSourceProvider } from "./types";

export interface SceneCacheSync {
  discovered: number;
  cached: number;
  skipped: number;
  failures: string[];
  truncated: boolean;
}

export interface SceneSyncOptions {
  onSource?: (sceneId: string, sceneVersion: string) => void;
}

/** Discover published scenes using Canvas's bounded, authenticated pagination. */
export async function synchronizeSceneSources(
  options: CanvasSceneSourceOptions,
  provider: SceneSourceProvider,
  store: SceneSourceStore,
  signal: AbortSignal,
  maximum = Number.MAX_SAFE_INTEGER,
  sync: SceneSyncOptions = {},
): Promise<SceneCacheSync> {
  if (!Number.isSafeInteger(maximum) || maximum < 1)
    throw new Error("SOURCE_CACHE_SYNC_LIMIT");
  const report: SceneCacheSync = {
    discovered: 0,
    cached: 0,
    skipped: 0,
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
      mine: "false",
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
      items: { id: string; scene_type?: string; status?: string }[];
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
    const batch = page.items.slice(0, maximum - report.discovered);
    for (const item of batch) {
      if (typeof item.id !== "string" || !item.id || seen.has(item.id))
        throw new Error("SOURCE_CACHE_CATALOG_INVALID");
      seen.add(item.id);
    }
    let cursor = 0;
    // Four bounded transfers per page; never materialize the whole catalogue.
    await Promise.all(
      Array.from({ length: Math.min(4, batch.length) }, async () => {
        while (cursor < batch.length) {
          signal.throwIfAborted();
          const item = batch[cursor++]!;
          report.discovered++;
          if (item.scene_type === "editable") {
            report.skipped++;
            continue;
          }
          try {
            const source = await provider.get(item.id, {
              format: "lsmlz",
              signal,
            });
            if (source.sceneId !== item.id)
              throw new Error("SOURCE_CACHE_IDENTITY_MISMATCH");
            const capsule = encodeSceneSource(source);
            signal.throwIfAborted();
            await store.write(
              sceneSourceKey(
                source.sceneId,
                source.sceneVersion,
                source.format,
              ),
              capsule,
            );
            report.cached++;
            sync.onSource?.(source.sceneId, source.sceneVersion);
          } catch (error) {
            signal.throwIfAborted();
            if (
              error instanceof Error &&
              error.message === "SOURCE_NOT_PUBLISHED"
            )
              report.skipped++;
            else report.failures.push(item.id);
          }
        }
      }),
    );
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
