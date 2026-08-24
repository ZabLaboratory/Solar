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
import { resolveShowToken } from "./internal/resolve-show-token";
import { atlasMountOptions } from "./internal/atlas-mount";
import { localBundleUrl } from "./internal/local-bundle-url";
import type { SolarMode } from "./types";
// Self-hosted Geist / Geist Mono @font-face — Solar's served host/CEF/atlas
// page owns its fonts (Prism's editor CSS never reaches it). Vite inlines the
// woff2 as hashed, relatively-referenced assets under dist/host/ (base "./"),
// so the CEF resolves them with no bundler/import map.
import "./styles/fonts.css";

const params = new URLSearchParams(window.location.search);
if (params.get("disable_peer_viewer") === "1") {
  (globalThis as { __ZAB_DISABLE_PEER_VIEWER__?: boolean }).__ZAB_DISABLE_PEER_VIEWER__ = true;
}
const orionUrl =
  params.get("orion") ?? `wss://${location.host}/orion/api/v1/show/stream`;
// The Pulsar browser source packs the show-token inside `orionUrl`'s query
// (`…/show/stream.lsdp?token=<SHOW>`), not as a top-level `?token=`. Surface
// it so the runtime can attach `Authorization: Bearer <token>` to the
// render-bundle fetch — otherwise the GET is header-less and Orion 401s.
const token = resolveShowToken(orionUrl, params.get("token"));
const bundleBase = params.get("bundle");
const resolveBundleUrl =
  bundleBase === null
    ? undefined
    : (sceneId: string, sceneVersion: string): string =>
        localBundleUrl(
          bundleBase,
          window.location.href,
          sceneId,
          sceneVersion,
        );
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
  ...(resolveBundleUrl !== undefined ? { resolveBundleUrl } : {}),
  token,
  mode,
  // This is the SERVED bundle — the flux réellement diffusé/enregistré (antenne
  // prod via Orion, REC/test render via Prism's scene-server, Pulsar CEF atlas).
  // Un-mute guest-peer WebRTC audio so it reaches the on-air / recording mix
  // (runtime ≥ 0.13.0). Opt in ONLY for the diffused/recorded modes: `control`
  // is Solar's interactive operator view (like the dev-entry editor) where the
  // room may be open elsewhere — un-muting there would cause echo/feedback, so
  // it stays muted. dev-entry.tsx never opts in for the same reason. Allowlist
  // (not `!== "control"`) so any future mode defaults to muted per the runtime's
  // opt-in DANGER contract.
  liveAudio: mode === "broadcast" || mode === "test",
  ...(mode === "test" && scene ? { scene } : {}),
  ...(mode === "test" && testSession ? { testSession } : {}),
  // ADR 013 Prism §3.1 (issue #41) — `?atlas=` opts into the texture-atlas
  // z-band render. Absent/malformed → no `transformRoot` key → verbatim render.
  ...atlasMountOptions(window.location.search),
  onError: (err) => {
    // Broadcast hosts must not surface chrome — log to console and let the
    // operator overlay (control/test modes) display a degraded state
    // through Solar's own UI.
    //
    // SolarError is a plain `{ code, message, recoverable }` object (NOT an
    // Error subclass), so a CEF/console bridge that string-coerces the
    // second arg renders it as the useless `[object Object]` — which hid
    // the real cause during the M3 black-screen incident. Log the fields
    // explicitly so `code`/`message` always survive, whatever the host
    // console does with object args.
    console.error(
      `[solar] ${err.code}: ${err.message}` +
        (err.recoverable ? " (recoverable)" : " (fatal)"),
    );
  },
});
