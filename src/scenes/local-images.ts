import type { SceneImageAssetsProvider } from "./types";

export interface LocalRenderAssetEndpoint {
  url: string;
  token: string;
  gatewayOrigin: string;
}

/** Same host cache used by Prism's DOM images, now supplying encoded bytes to Vision. */
export function createLocalImageAssetsProvider(
  config: LocalRenderAssetEndpoint,
  fetchResource: typeof fetch = globalThis.fetch.bind(globalThis),
): SceneImageAssetsProvider {
  const endpoint = new URL(config.url),
    gateway = new URL(config.gatewayOrigin);
  if (
    endpoint.protocol !== "http:" ||
    !/^(127\.0\.0\.1|localhost|\[::1\])$/.test(endpoint.hostname) ||
    endpoint.pathname !== "/local-render-asset-url" ||
    endpoint.username ||
    endpoint.password ||
    typeof config.token !== "string" ||
    !config.token ||
    gateway.protocol !== "https:" ||
    gateway.username ||
    gateway.password
  )
    throw new Error("SOLAR_LOCAL_IMAGE_HOST_INVALID");
  return {
    async get(source, { signal }) {
      const url = new URL(source);
      if (url.protocol !== "https:" || url.username || url.password)
        return null;
      const canvas =
        url.origin === gateway.origin &&
        /^\/canvas\/api\/v1\/scene-assets\/[a-f0-9]{64}\/bytes$/i.test(
          url.pathname,
        );
      const ddragon =
        url.hostname === "ddragon.leagueoflegends.com" &&
        /^\/cdn\/[^/]+\/img\/(?:champion|item|spell|rune)\//i.test(
          url.pathname,
        );
      if (!canvas && !ddragon) return null;
      const request = new URL(endpoint);
      request.searchParams.set("url", url.href);
      request.searchParams.set("token", config.token);
      const response = await fetchResource(request, {
        credentials: "omit",
        redirect: "error",
        signal,
      });
      if (!response.ok)
        throw new Error(`Local render image failed (${response.status}).`);
      const contentType =
        response.headers.get("content-type")?.split(";")[0] ?? "";
      const maximum = 8 * 1024 * 1024;
      if (
        !contentType.startsWith("image/") ||
        Number(response.headers.get("content-length")) > maximum
      )
        throw new Error("Local render image response is invalid.");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Local render image has no bytes.");
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          length += chunk.value.byteLength;
          if (length > maximum)
            throw new Error("Local render image exceeds 8 MiB.");
          chunks.push(chunk.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      if (!length) throw new Error("Local render image has no bytes.");
      const data = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return { data, contentType };
    },
  };
}
