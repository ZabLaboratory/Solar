// Production bootstrap for the single LSDP-to-Vision renderer.

import { createCanvasSceneSourceProvider } from "./scenes/canvas";
import { createLocalAuthoringSourceProvider } from "./scenes/local-authoring";
import {
  BrowserSceneSourceStore,
  sceneCacheNamespace,
} from "./scenes/browser-store";
import {
  createStartupSceneSourceProvider,
  synchronizeSceneSources,
} from "./scenes/startup";
import { mount } from "./mount";
import type { SolarMode } from "./types";

interface SolarHostConfig {
  canvasApiUrl?: string;
  canvasToken?: string;
  localAuthoringSourceUrl?: string;
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
const cache =
  canvasToken && typeof indexedDB !== "undefined"
    ? new BrowserSceneSourceStore(
        sceneCacheNamespace(canvasApiUrl, canvasToken),
      )
    : null;
const lifetime = new AbortController();
window.addEventListener(
  "pagehide",
  () => {
    lifetime.abort();
    void cache?.close();
  },
  { once: true },
);
if (cache) {
  document.documentElement.dataset.solarCache = "synchronizing";
  void synchronizeSceneSources(canvasOptions, upstream, cache, lifetime.signal)
    .then((report) => {
      document.documentElement.dataset.solarCache =
        report.failures.length || report.truncated ? "partial" : "ready";
      document.documentElement.dataset.solarCachedScenes = String(
        report.cached,
      );
    })
    .catch(() => {
      if (!lifetime.signal.aborted)
        document.documentElement.dataset.solarCache = "offline";
    });
}
mount({
  target,
  nativeLSDP: {
    url: nativeUrl,
    resource: config?.nativeLSDP?.resource ?? params.get("resource") ?? "scene",
    selector:
      config?.nativeLSDP?.selector ?? params.get("selector") ?? undefined,
  },
  token,
  mode,
  sceneSourceProvider: cache
    ? createStartupSceneSourceProvider(upstream, cache)
    : upstream,
  localSceneSourceProvider: config?.localAuthoringSourceUrl
    ? createLocalAuthoringSourceProvider(
        config.localAuthoringSourceUrl,
        canvasToken,
      )
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
