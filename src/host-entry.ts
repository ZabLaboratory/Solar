import { VerifiedFont } from "./scenes/verified-font";
import { installationFontBatches } from "./scenes/installation-fonts";
// Production bootstrap for the single LSDP-to-Vision renderer.

import { createCanvasSceneSourceProvider } from "./scenes/canvas";
import { createLocalSceneSourceProvider } from "./scenes/local-library";
import {
  createLocalImageAssetsProvider,
  type LocalRenderAssetEndpoint,
} from "./scenes/local-images";
import { mount } from "./mount";
import type { SolarMode } from "./types";

interface SolarHostConfig {
  nativeComposition?: { width: number; height: number };
  canvasApiUrl?: string;
  canvasToken?: string;
  sceneSourcesUrl?: string;
  fontAssetsUrl?: string;
  installationFontCatalog?: { url: string; token: string };
  nativeLSDP?: { url: string; resource: string; selector?: string };
}

const DEFAULT_CANVAS_API = "https://zabgate.cyell.dev/canvas/api/v1";
const params = new URLSearchParams(window.location.search);
const config = (globalThis as { __SOLAR_CONFIG__?: SolarHostConfig })
  .__SOLAR_CONFIG__;

const nativeUrl = config?.nativeLSDP?.url ?? params.get("lsdp") ?? undefined;
const connectionUrl = nativeUrl;
if (!connectionUrl) {
  document.body.textContent = "Solar: local native LSDP URL required (lsdp)";
  throw new Error("SOLAR_LSDP_REQUIRED");
}
try {
  const parsed = new URL(connectionUrl);
  const loopback = /^(127\.0\.0\.1|localhost|\[::1\]|::1)$/i.test(
    parsed.hostname,
  );
  if (!loopback || !/^(ws|wss):$/i.test(parsed.protocol)) {
    throw new Error("SOLAR_NATIVE_LSDP_REQUIRED");
  }
} catch {
  document.body.textContent = "Solar: local native LSDP connection required";
  throw new Error("SOLAR_NATIVE_LSDP_REQUIRED");
}

const token = config?.nativeLSDP ? "" : (params.get("token") ?? "");
const canvasApiUrl = config?.canvasApiUrl ?? DEFAULT_CANVAS_API;
const canvasToken = config?.canvasToken ?? params.get("canvas_token") ?? token;
const fontCache = new Map<string, VerifiedFont>();
async function localFonts(signal: AbortSignal): Promise<VerifiedFont[]> {
  const url = new URL(config!.fontAssetsUrl!);
  if (
    !/^(127\.0\.0\.1|localhost|\[::1\])$/i.test(url.hostname) ||
    !/^https?:$/.test(url.protocol)
  )
    throw new Error("SOLAR_FONT_HOST_REQUIRED");
  const headers = { Authorization: `Bearer ${canvasToken}` };
  const response = await fetch(url, {
    headers,
    signal,
    cache: "no-store",
    redirect: "error",
  });
  if (!response.ok) throw new Error("SOLAR_FONT_MANIFEST_UNAVAILABLE");
  const hashes: unknown = await response.json();
  if (
    !Array.isArray(hashes) ||
    hashes.length > 64 ||
    hashes.some(
      (hash) => typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash),
    )
  )
    throw new Error("SOLAR_FONT_MANIFEST_INVALID");
  for (const key of fontCache.keys())
    if (!hashes.includes(key)) fontCache.delete(key);
  const fonts: VerifiedFont[] = [];
  let size = 0;
  for (const hash of hashes) {
    let bytes = fontCache.get(hash);
    if (!bytes) {
      const asset = await fetch(`${url.href}/${hash}`, {
        headers,
        signal,
        redirect: "error",
      });
      if (
        !asset.ok ||
        Number(asset.headers.get("content-length")) > 8 * 1024 * 1024
      )
        throw new Error("SOLAR_FONT_ASSET_UNAVAILABLE");
      bytes = await VerifiedFont.admit(
        new Uint8Array(await asset.arrayBuffer()),
        hash,
      );
    }
    size += bytes.byteLength;
    if (size > 8 * 1024 * 1024) throw new Error("SOLAR_FONT_RESOURCE_LIMIT");
    fontCache.set(hash, bytes);
    fonts.push(bytes);
  }
  return fonts;
}
const modeParam = params.get("mode") ?? "broadcast";
const mode: SolarMode = (["broadcast", "control", "test"] as const).includes(
  modeParam as SolarMode,
)
  ? (modeParam as SolarMode)
  : "broadcast";
const target = document.getElementById("scene");
if (!(target instanceof HTMLElement)) {
  document.body.textContent = "Solar: #scene target missing";
  throw new Error("SOLAR_TARGET_REQUIRED");
}

const canvasOptions = { apiUrl: canvasApiUrl, token: canvasToken };
const upstream = createCanvasSceneSourceProvider(canvasOptions);
mount({
  sceneImageAssetsProvider: globalThis.__ZAB_RENDER_ASSET_ENDPOINT__
    ? createLocalImageAssetsProvider(globalThis.__ZAB_RENDER_ASSET_ENDPOINT__)
    : undefined,
  nativeComposition: config?.nativeComposition,
  target,
  nativeLSDP: {
    url: nativeUrl,
    resource: config?.nativeLSDP?.resource ?? params.get("resource") ?? "scene",
    selector:
      config?.nativeLSDP?.selector ?? params.get("selector") ?? undefined,
  },
  token,
  mode,
  sceneSourceProvider: config?.sceneSourcesUrl
    ? createLocalSceneSourceProvider(
        config.sceneSourcesUrl,
        canvasToken,
        upstream,
      )
    : upstream,
  fontAssetsProvider: config?.fontAssetsUrl ? localFonts : undefined,
  installationFonts: config?.installationFontCatalog
    ? () => installationFontBatches(config.installationFontCatalog!)
    : undefined,
  liveAudio: mode === "broadcast" || mode === "test",
  onError: (error) => {
    console.error(
      `[solar] ${error.code}: ${error.message}` +
        (error.recoverable ? " (recoverable)" : " (fatal)"),
    );
  },
  onStatus: (status) => {
    document.documentElement.dataset.solarStatus = status;
  },
});

declare global {
  var __ZAB_RENDER_ASSET_ENDPOINT__: LocalRenderAssetEndpoint | undefined;
  // Set by the trusted embedding host before this module loads. Scene identity
  // always comes from LSDP snapshots; this config contains source API access only.
  var __SOLAR_CONFIG__: SolarHostConfig | undefined;
  var __ZAB_CAPTURE_DEVICES__:
    | Record<
        string,
        {
          label?: string;
          deviceId?: string;
          captureSourceId?: string;
          kind?: string;
        }
      >
    | undefined;
  var __ZAB_CAPTURE_DEFAULT_SCREEN__:
    | {
        label?: string;
        deviceId?: string;
        captureSourceId?: string;
        kind?: string;
      }
    | null
    | undefined;
  var __ZAB_CAPTURE_RESOLVE_DEFAULT_SCREEN__:
    | (() => Promise<{
        label?: string;
        deviceId?: string;
        captureSourceId?: string;
        kind?: string;
      } | null>)
    | undefined;
  var __ZAB_PEER_VIEWER__: unknown | undefined;
  var __ZAB_DISABLE_PEER_VIEWER__: boolean | undefined;
}
