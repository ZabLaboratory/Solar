export interface RenderAssetEndpoint {
  url: string;
  batchUrl?: string;
  token: string;
  gatewayOrigin: string;
}

const SCENE_ASSET_PATH =
  /^\/canvas\/api\/v1\/scene-assets\/[0-9a-f]{64}\/bytes$/i;
const DDRAGON_IMAGE_PATH =
  /^\/cdn\/[^/]+\/img\/(?:champion|item|spell|rune)\//i;
const MIN_BATCH_RENDER_ASSETS = 8;

type RenderAssetEndpointGlobal = RenderAssetEndpoint;

interface GatewayUrlCache {
  initialized: boolean;
  value: URL | null;
  hydratableImageUrls: Map<string, boolean>;
}

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
    ...(typeof candidate.batchUrl === "string"
      ? { batchUrl: candidate.batchUrl }
      : {}),
    token: candidate.token,
    gatewayOrigin: candidate.gatewayOrigin,
  };
}

function hasHttpsSchemeCandidate(value: string): boolean {
  const colon = value.indexOf(":");
  if (colon < 0) return false;

  const scheme = "https";
  let matched = 0;
  for (let index = 0; index < colon; index += 1) {
    const code = value.charCodeAt(index);
    // WHATWG URL parsing strips leading C0 whitespace and ASCII tabs/newlines
    // from schemes. Ignore those here too, while leaving final validation to
    // URL below.
    if (code <= 0x20) continue;
    const lowerCode = code >= 0x41 && code <= 0x5a ? code + 0x20 : code;
    if (matched >= scheme.length || lowerCode !== scheme.charCodeAt(matched)) {
      return false;
    }
    matched += 1;
  }
  return matched === scheme.length;
}

function isHydratableImageUrl(
  value: string,
  gatewayOrigin: string,
  gatewayCache: GatewayUrlCache,
): boolean {
  if (!hasHttpsSchemeCandidate(value)) return false;
  const cached = gatewayCache.hydratableImageUrls.get(value);
  if (cached !== undefined) return cached;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    gatewayCache.hydratableImageUrls.set(value, false);
    return false;
  }
  if (parsed.protocol !== "https:") {
    gatewayCache.hydratableImageUrls.set(value, false);
    return false;
  }

  if (!gatewayCache.initialized) {
    gatewayCache.initialized = true;
    try {
      gatewayCache.value = new URL(gatewayOrigin);
    } catch {
      gatewayCache.value = null;
    }
  }
  const gateway = gatewayCache.value;
  if (!gateway) {
    gatewayCache.hydratableImageUrls.set(value, false);
    return false;
  }

  const hydratable =
    parsed.origin === gateway.origin &&
    SCENE_ASSET_PATH.test(parsed.pathname) ||
    (parsed.hostname === "ddragon.leagueoflegends.com" &&
      DDRAGON_IMAGE_PATH.test(parsed.pathname));
  gatewayCache.hydratableImageUrls.set(value, hydratable);
  return hydratable;
}

function collectImageUrls(
  value: unknown,
  gatewayOrigin: string,
  out: Set<string>,
  gatewayCache: GatewayUrlCache,
): void {
  if (typeof value === "string") {
    if (isHydratableImageUrl(value, gatewayOrigin, gatewayCache))
      out.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectImageUrls(item, gatewayOrigin, out, gatewayCache);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [path, item] of Object.entries(value as Record<string, unknown>)) {
    // Prism's local bundle pins immutable image/media literals to hydrated
    // props and removes those src bindings. Fetching their signed upstream
    // URLs again here blocks the entire LSDP queue on multi-megabyte image
    // conversion, although no rendered node consumes these literal leaves.
    // Dynamic sources (chat/game data, operator inputs) still hydrate below.
    if (/^__lit\.(?:image|media)\./.test(path)) continue;
    collectImageUrls(item, gatewayOrigin, out, gatewayCache);
  }
}

function replaceStringsInPlace(
  value: unknown,
  replacements: Map<string, string>,
): unknown {
  if (typeof value === "string") return replacements.get(value) ?? value;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const previous = value[index];
      const replacement = replaceStringsInPlace(previous, replacements);
      if (replacement !== previous) value[index] = replacement;
    }
    return value;
  }
  if (!value || typeof value !== "object") return value;

  // `frame` is freshly parsed for this message, so mutating it is safe and
  // avoids allocating a second object tree just to replace image leaves.
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const previous = record[key];
    const replacement = replaceStringsInPlace(previous, replacements);
    if (replacement !== previous) record[key] = replacement;
  }
  return value;
}

function bytesToBase64(bytes: Uint8Array): string {
  const nativeToBase64 = (bytes as Uint8Array & { toBase64?: () => string })
    .toBase64;
  if (typeof nativeToBase64 === "function") return nativeToBase64.call(bytes);

  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}

function decodeLocalRenderAssetBatch(
  buffer: ArrayBuffer,
  expectedCount: number,
): Array<{ contentType: string; body: Uint8Array }> {
  const bytes = new Uint8Array(buffer);
  if (
    bytes.length < 6 ||
    bytes[0] !== 0x4c ||
    bytes[1] !== 0x52 ||
    bytes[2] !== 0x41 ||
    bytes[3] !== 0x31
  ) {
    throw new Error("local asset batch response has an invalid signature");
  }
  const view = new DataView(buffer);
  const count = view.getUint16(4);
  if (count !== expectedCount) {
    throw new Error("local asset batch response has an incompatible count");
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const assets: Array<{ contentType: string; body: Uint8Array }> = [];
  let offset = 6;
  for (let index = 0; index < count; index += 1) {
    if (offset + 5 > bytes.length) {
      throw new Error("local asset batch response is truncated");
    }
    const contentTypeLength = bytes[offset]!;
    const bodyLength = view.getUint32(offset + 1);
    offset += 5;
    const bodyStart = offset + contentTypeLength;
    const bodyEnd = bodyStart + bodyLength;
    if (
      contentTypeLength === 0 ||
      bodyStart > bytes.length ||
      bodyEnd > bytes.length
    ) {
      throw new Error("local asset batch response has invalid asset lengths");
    }
    assets.push({
      contentType: decoder.decode(bytes.subarray(offset, bodyStart)),
      body: bytes.subarray(bodyStart, bodyEnd),
    });
    offset = bodyEnd;
  }
  if (offset !== bytes.length) {
    throw new Error("local asset batch response has trailing bytes");
  }
  return assets;
}

function localBatchUrl(endpoint: RenderAssetEndpoint): URL | null {
  if (!endpoint.batchUrl) return null;
  try {
    const base = globalThis.location?.href ?? "http://127.0.0.1/";
    const assetUrl = new URL(endpoint.url, base);
    const batchUrl = new URL(endpoint.batchUrl, base);
    if (
      batchUrl.origin !== assetUrl.origin ||
      batchUrl.pathname !== "/local-render-asset-batch"
    ) {
      return null;
    }
    batchUrl.searchParams.set("token", endpoint.token);
    return batchUrl;
  } catch {
    return null;
  }
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
  collectImageUrls(frame, endpoint.gatewayOrigin, urls, {
    initialized: false,
    value: null,
    hydratableImageUrls: new Map(),
  });
  if (urls.size === 0) return data;

  const missing = [...urls].filter((source) => !replacements.has(source));
  const hydrateOne = async (source: string): Promise<void> => {
    const request = new URL(
      endpoint.url,
      globalThis.location?.href ?? "http://127.0.0.1/",
    );
    request.searchParams.set("token", endpoint.token);
    request.searchParams.set("url", source);
    const response = await fetchImpl(request);
    if (!response.ok)
      throw new Error(`local asset endpoint returned HTTP ${response.status}`);
    const contentType =
      response.headers.get("content-type")?.split(";", 1)[0]?.trim() ||
      "image/png";
    replacements.set(
      source,
      `data:${contentType};base64,${bytesToBase64(new Uint8Array(await response.arrayBuffer()))}`,
    );
  };
  const batchUrl =
    missing.length >= MIN_BATCH_RENDER_ASSETS ? localBatchUrl(endpoint) : null;
  // Tiny fan-outs do not amortize the batch envelope and decoding work. Keep
  // their existing parallel GET path; larger image sets benefit from one POST.
  if (batchUrl && missing.length >= MIN_BATCH_RENDER_ASSETS) {
    try {
      const response = await fetchImpl(batchUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sources: missing }),
      });
      if (!response.ok)
        throw new Error(
          `local asset batch endpoint returned HTTP ${response.status}`,
        );
      const assets = decodeLocalRenderAssetBatch(
        await response.arrayBuffer(),
        missing.length,
      );
      for (const [index, source] of missing.entries()) {
        const asset = assets[index]!;
        replacements.set(
          source,
          `data:${asset.contentType};base64,${bytesToBase64(asset.body)}`,
        );
      }
    } catch {
      await Promise.all(missing.map(hydrateOne));
    }
  } else {
    await Promise.all(missing.map(hydrateOne));
  }
  return JSON.stringify(replaceStringsInPlace(frame, replacements));
}

export function createRenderAssetWebSocket(
  endpoint: RenderAssetEndpoint,
  NativeWebSocket: typeof WebSocket = globalThis.WebSocket,
): typeof WebSocket {
  class RenderAssetWebSocket extends NativeWebSocket {
    private readonly replacements = new Map<string, string>();
    private messageHandler:
      | ((this: WebSocket, event: MessageEvent) => unknown)
      | null = null;
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
            // Installed only by Prism's E2E host, never by production hosts.
            const diagnostic = (
              globalThis as {
                __PRISM_SOLAR_DIAG__?: {
                  frame?: (phase: string, data: unknown) => void;
                };
              }
            ).__PRISM_SOLAR_DIAG__?.frame;
            diagnostic?.("hydrated", data);
            this.messageHandler?.call(
              this,
              new MessageEvent("message", { data }),
            );
            diagnostic?.("dispatched", data);
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

    override get onmessage():
      | ((this: WebSocket, event: MessageEvent) => unknown)
      | null {
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
