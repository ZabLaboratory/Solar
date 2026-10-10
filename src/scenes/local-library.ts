import { decodeSceneSource } from "./cache";
import type { SceneSourceProvider } from "./types";

/** Local immutable source transport; a miss falls back to Canvas authorization. */
export function createLocalSceneSourceProvider(
  endpoint: string,
  token: string,
  upstream: SceneSourceProvider,
  fetcher: typeof fetch = fetch,
): SceneSourceProvider {
  const base = new URL(endpoint);
  if (
    !/^https?:$/.test(base.protocol) ||
    !/^(127\.0\.0\.1|localhost|\[::1\])$/.test(base.hostname) ||
    base.search ||
    base.hash ||
    base.username ||
    base.password
  )
    throw new Error("SOURCE_CACHE_LOCAL_HOST_REQUIRED");
  return {
    async get(sceneId, request = {}) {
      if (
        !request.sceneVersion ||
        (request.format && request.format !== "lsmlz")
      )
        return upstream.get(sceneId, request);
      const url = new URL(base.href);
      url.pathname += `/${encodeURIComponent(sceneId)}`;
      url.searchParams.set("version", request.sceneVersion);
      const response = await fetcher(url, {
        signal: request.signal,
        redirect: "error",
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 404) {
        await response.body?.cancel();
        return upstream.get(sceneId, request);
      }
      if (!response.ok || !response.body)
        throw new Error("SOURCE_CACHE_LOCAL_UNAVAILABLE");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          request.signal?.throwIfAborted();
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 132 * 1024 * 1024)
            throw new Error("SOURCE_CACHE_RESOURCE_LIMIT");
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      request.signal?.throwIfAborted();
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const source = decodeSceneSource(bytes);
      if (
        source.sceneId !== sceneId ||
        source.sceneVersion !== request.sceneVersion ||
        source.format !== "lsmlz"
      )
        throw new Error("SOURCE_CACHE_IDENTITY_MISMATCH");
      return source;
    },
  };
}
