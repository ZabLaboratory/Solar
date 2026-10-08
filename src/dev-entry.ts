// Local/e2e bootstrap. Every scene is acquired from ZabCanvas and rendered by Vision.

import { createCanvasSceneSourceProvider } from "./scenes/canvas";
import { mount } from "./mount";
import type { SolarMode } from "./types";

const params = new URLSearchParams(window.location.search);
const nativeUrl = params.get("lsdp");
if (!nativeUrl)
  throw new Error(
    "SOLAR_NATIVE_LSDP_REQUIRED: pass lsdp and resource query parameters",
  );
const token = params.get("token") ?? "";
const modeParam = params.get("mode") ?? "broadcast";
const mode: SolarMode = (["broadcast", "control", "test"] as const).includes(
  modeParam as SolarMode,
)
  ? (modeParam as SolarMode)
  : "broadcast";
const target = document.getElementById("scene");
if (!(target instanceof HTMLElement)) throw new Error("SOLAR_TARGET_REQUIRED");

mount({
  target,
  nativeLSDP: {
    url: nativeUrl,
    resource: params.get("resource") ?? "scene",
    selector: params.get("selector") ?? undefined,
  },
  token,
  mode,
  sceneSourceProvider: createCanvasSceneSourceProvider({
    apiUrl:
      params.get("canvas_api") ?? "https://zabgate.cyell.dev/canvas/api/v1",
    token: params.get("canvas_token") ?? token,
  }),
  liveAudio: mode === "broadcast" || mode === "test",
  onError: (error) =>
    console.error(`[solar dev] ${error.code}: ${error.message}`),
  onStatus: (status) => {
    document.documentElement.dataset.solarStatus = status;
  },
});
