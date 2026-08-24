export interface RenderAssetEndpoint {
  url: string;
  token: string;
  gatewayOrigin: string;
}

const SCENE_ASSET_PATH = /^\/canvas\/api\/v1\/scene-assets\/[0-9a-f]{64}\/bytes$/i;
const DDRAGON_IMAGE_PATH = /^\/cdn\/[^/]+\/img\/(?:champion|item|spell|rune)\//i;

type RenderAssetEndpointGlobal = RenderAssetEndpoint;

export function readRenderAssetEndpoint(): RenderAssetEndpoint | null {
  const value = (globalThis as { __ZAB_RENDER_ASSET_ENDPOINT__?: unknown })
    .__ZAB_RENDER_ASSET_ENDPOINT__;
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<RenderAssetEndpointGlobal>;
  if (
    typeof candidate.url !== "string" ||
    typeof candidate.token !== "string" ||
    typeof candidate.gatewayOrigin !== "string"
  ) {
    return null;
  }
  return {
    url: candidate.url,
    token: candidate.token,
    gatewayOrigin: candidate.gatewayOrigin,
  };
}

function isHydratableImageUrl(value: string, gatewayOrigin: string): boolean {
  let parsed: URL;
  let gateway: URL;
  try {
    parsed = new URL(value);
    gateway = new URL(gatewayOrigin);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.origin === gateway.origin && SCENE_ASSET_PATH.test(parsed.pathname)) {
    return true;
  }
  return (
    parsed.hostname === "ddragon.leagueoflegends.com" &&
    DDRAGON_IMAGE_PATH.test(parsed.pathname)
  );
}

function collectImageUrls(value: unknown, gatewayOrigin: string, out: Set<string>): void {
  if (typeof value === "string") {
    if (isHydratableImageUrl(value, gatewayOrigin)) out.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectImageUrls(item, gatewayOrigin, out);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const item of Object.values(value as Record<string, unknown>)) {
    collectImageUrls(item, gatewayOrigin, out);
  }
}

function replaceStrings(
  value: unknown,
  replacements: Map<string, string>,
): unknown {
  if (typeof value === "string") return replacements.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => replaceStrings(item, replacements));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      replaceStrings(item, replacements),
    ]),
  );
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export async function rewriteRenderAssetFrame(
  data: string,
  endpoint: RenderAssetEndpoint,
  fetchImpl: typeof fetch = fetch,
  replacements = new Map<string, string>(),
): Promise<string> {
  let frame: unknown;
  try {
    frame = JSON.parse(data) as unknown;
  } catch {
    return data;
  }
  const urls = new Set<string>();
  collectImageUrls(frame, endpoint.gatewayOrigin, urls);
  if (urls.size === 0) return data;

  await Promise.all(
    [...urls].map(async (source) => {
      if (replacements.has(source)) return;
      const request = new URL(
        endpoint.url,
        globalThis.location?.href ?? "http://127.0.0.1/",
      );
      request.searchParams.set("token", endpoint.token);
      request.searchParams.set("url", source);
      const response = await fetchImpl(request);
      if (!response.ok) throw new Error(`local asset endpoint returned HTTP ${response.status}`);
      const contentType =
        response.headers.get("content-type")?.split(";", 1)[0]?.trim() || "image/png";
      replacements.set(source, `data:${contentType};base64,${arrayBufferToBase64(await response.arrayBuffer())}`);
    }),
  );
  return JSON.stringify(replaceStrings(frame, replacements));
}

export function createRenderAssetWebSocket(
  endpoint: RenderAssetEndpoint,
  NativeWebSocket: typeof WebSocket = globalThis.WebSocket,
): typeof WebSocket {
  class RenderAssetWebSocket extends NativeWebSocket {
    private readonly replacements = new Map<string, string>();
    private messageHandler: ((this: WebSocket, event: MessageEvent) => unknown) | null = null;
    private messageQueue = Promise.resolve();

    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      super.addEventListener("message", (event) => {
        this.messageQueue = this.messageQueue
          .then(async () => {
            const data =
              typeof event.data === "string"
                ? await rewriteRenderAssetFrame(
                    event.data,
                    endpoint,
                    fetch,
                    this.replacements,
                  )
                : event.data;
            this.messageHandler?.call(
              this,
              new MessageEvent("message", { data }),
            );
          })
          .catch((error: unknown) => {
            // A local cache miss must not tear down LSDP. The endpoint itself
            // remains the only permitted fallback; preserve the original frame
            // so the existing runtime error/render semantics stay intact.
            console.warn(
              `[solar] local render asset hydration failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
            this.messageHandler?.call(this, event);
          });
      });
    }

    override get onmessage(): ((this: WebSocket, event: MessageEvent) => unknown) | null {
      return this.messageHandler;
    }

    override set onmessage(
      handler: ((this: WebSocket, event: MessageEvent) => unknown) | null,
    ) {
      this.messageHandler = handler;
    }
  }
  return RenderAssetWebSocket as unknown as typeof WebSocket;
}
