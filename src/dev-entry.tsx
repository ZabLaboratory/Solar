// Dev / e2e harness entry. NOT shipped in the library bundle.
//
// Reads URL query params and mounts Solar against the requested
// Orion endpoint. Used by `npm run dev` and by Playwright e2e tests
// (which set the params to point at the test mock-orion).

import { mount } from "./index";
import type { SolarMode } from "./types";

const params = new URLSearchParams(window.location.search);

const orionUrl =
  params.get("orion") ?? "ws://127.0.0.1:8080/orion/api/v1/show/stream";
const token = params.get("token") ?? "dev-token";
const modeParam = params.get("mode") ?? "control";
const mode: SolarMode =
  modeParam === "broadcast" || modeParam === "test" || modeParam === "control"
    ? (modeParam as SolarMode)
    : "control";
const scene = params.get("scene") ?? undefined;
const testSession = params.get("session") ?? undefined;

const target = document.getElementById("scene");
if (!(target instanceof HTMLElement)) {
  throw new Error("dev-entry : #scene target missing");
}

mount({
  target,
  orionUrl,
  token,
  mode,
  ...(mode === "test" && scene ? { scene } : {}),
  ...(mode === "test" && testSession ? { testSession } : {}),
  onError: (err) => {
    console.error("[solar]", err);
  },
});
