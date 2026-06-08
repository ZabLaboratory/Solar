// Host / standalone bootstrap entry — the production counterpart of
// src/dev-entry.tsx, compiled into the self-contained `dist/host/` bundle.
//
// Per ADR 001 (dual-build) this entry is the root of the *host* Vite
// target: an app-mode build that inlines every runtime dep (react,
// react-dom, @preact/signals-react, framer-motion) so the emitted JS
// carries ZERO bare ESM specifiers. That bundle is what Orion
// static-serves at /static/solar/v{N}/ and the Pulsar CEF loads with no
// bundler and no <script type="importmap">.
//
// It mirrors dev-entry.tsx's bootstrap surface (read URL query params →
// mount() against the requested Orion endpoint) so the served form and
// the dev form stay behaviourally identical. It is NOT part of the
// published @zablab/solar package entry (that stays src/index.ts, library
// mode, externals) — it never ships in solar.js.

import { mount } from "./mount";
import type { SolarMode } from "./types";

const params = new URLSearchParams(window.location.search);
const orionUrl =
  params.get("orion") ?? `wss://${location.host}/orion/api/v1/show/stream`;
const token = params.get("token") ?? "";
const modeParam = params.get("mode") ?? "broadcast";
const mode: SolarMode = (["broadcast", "control", "test"] as const).includes(
  modeParam as SolarMode,
)
  ? (modeParam as SolarMode)
  : "broadcast";
const scene = params.get("scene") ?? undefined;
const testSession = params.get("session") ?? undefined;

const target = document.getElementById("scene");
if (!(target instanceof HTMLElement)) {
  document.body.textContent = "Solar host: #scene target missing";
  throw new Error("solar host: #scene target missing");
}

mount({
  target,
  orionUrl,
  token,
  mode,
  ...(mode === "test" && scene ? { scene } : {}),
  ...(mode === "test" && testSession ? { testSession } : {}),
  onError: (err) => {
    // Broadcast hosts must not surface chrome — log to console and let the
    // operator overlay (control/test modes) display a degraded state
    // through Solar's own UI.
    console.error("[solar]", err);
  },
});
