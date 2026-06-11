# Changelog

All notable changes to `@zablab/solar` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/), and the project
adheres to Semantic Versioning (pre-1.0 : minor bumps may carry
behavioural changes that keep the `mount()` API stable).

## [0.2.6] - 2026-06-11

Auth header for the render-bundle fetch — clears the 401 black frame
behind ZabGate. `@lumencast/runtime` **^0.6.0** now sends the show token
as `Authorization: Bearer <token>` on the render-bundle fetch (previously
the bundle URL carried no credentials, so Orion behind ZabGate replied
401 and nothing rendered). Solar already forwards the show token through
`mount({ token })`, and the runtime propagates it to the bundle request
automatically — **no Solar code change**. `mount()` / `SolarError`
public surface and the LSDP wire dialect are **unchanged**, so this is a
patch. Lockfile resolves `@lumencast/runtime` 0.5.0 → 0.6.0; no new
third-party dependency.

Refs Orion ADR 004 § 2 (render-bundle route), ADR 007 (thin adapter).

## [0.2.5] - 2026-06-11

Render-bundle URL resolver — unblocks the black frame behind ZabGate.
The runtime fetched the bundle from its default host-root LSDP layout
(`https://<host>/lsdp/v1/scenes/{id}/bundle`) and **404'd**; Orion behind
ZabGate serves it at
`https://zabgate.cyell.dev/orion/api/v1/scenes/{id}/render-bundle?v={hash}`,
so nothing rendered. `@lumencast/runtime` **^0.5.0** adds
`MountOptions.resolveBundleUrl?: (sceneId, sceneVersion) => string`;
`mount()` now derives the gateway-prefixed URL from the WS `orionUrl` and
passes it through. New internal helper `orionBundleUrl(serverUrl)` :
`wss`→`https` / `ws`→`http`, strip the `/show/stream.lsdp` WS suffix to
recover the API root, rebuild `…/scenes/{id}/render-bundle?v={hash}` with
percent-encoded scene id and version (Orion's `r.URL.Query().Get("v")`
URL-decodes back for the byte-for-byte hash match). This is exactly the
adapter's job under ADR 007 — it owns Orion's URL contract; the mapping is
kept minimal and unit-tested. `mount()` / `SolarError` public surface and
the LSDP wire dialect are **unchanged**, so this is a patch. Lockfile
resolves `@lumencast/runtime` 0.4.0 → 0.5.0 (+ `@lumencast/protocol`
0.4.0 → 0.5.0); no new third-party dependency.

Refs Orion ADR 004 § 2 (render-bundle route), ADR 007 (thin adapter).

## [0.2.4] - 2026-06-09

Mount-play default-timing fallback — rebuild against
`@lumencast/runtime` **^0.4.0** (lumencast-js PR #25, published v0.4.0).
v0.3.0 wired framer `initial`/`animate` but resolved the transition
only from the primitive's native prop keys; on the real wire shape
(Orion emits the raw LSML `animate` envelope under `transitions` with a
`transition` key the runtime never looked up) `toFramer(undefined)`
returned `{ duration: 0 }` and the element snapped blank→settled in a
single frame — no ramp. Runtime 0.4.0 adds `resolveTransition` +
`DEFAULT_MOUNT_PLAY_TRANSITION` (400 ms default tween) so a `from`
without an explicit per-prop transition mount-plays with the runtime's
default timing instead of a zero-duration snap. **No Solar `src/`
change** : the fix ships inside the self-contained host bundle by
rebuilding with the patched runtime — exactly what a Solar release is
for. `mount()` / `SolarError` surface and the LSDP wire dialect are
**unchanged**. Lockfile resolves `@lumencast/runtime`
0.3.0 → 0.4.0 (+ `@lumencast/protocol` 0.3.0 → 0.4.0); no new
third-party dependency, audit posture byte-identical to 0.2.3
(same 3 pre-existing transitive advisories, none introduced here).

Refs M10 final pass.

## [0.2.3] - 2026-06-09

Mount-play foundation — rebuild against `@lumencast/runtime` **^0.3.0**
(lumencast-js PR #23) : the LSML 1.1 `animate` directive now carries a
`from` (mount-time initial state), the compiler lowers it to a flat
`animate_initial` framer map, and the runtime primitives (Image / Frame /
Text / Shape) pass framer-motion `initial={from}` + `animate={target}` —
an authored scene **plays its animation on mount** (e.g. the Zab
white+logo transition scene fades + scales the logo in) with **no
KeyframePlayer and no compiler-generated transition code**. Without
`from`, behaviour is byte-identical to 0.2.2 (no mount-play). No Solar
`src/` change : the capability ships inside the self-contained host
bundle (`dist/host/**`) by rebuilding with the patched runtime. `mount()`
/ `SolarError` public surface and the LSDP wire dialect are **unchanged**.
GPU-only rule respected : `from` drives `opacity` / `transform` only.

## [0.2.2] - 2026-06-09

M10 overlay engine — `wipe-cover` authored element (`src/overlay/wipe-cover.ts`,
#12). The full-screen opaque cover the Blue-driven `scene_control` leaf replays
(reveal → hold → retract) now paints a **visible magenta fill**
(`DEFAULT_COVER_FILL = #C81E5A`) so the on-air transition is provably *our*
engine's paint (the MID frame is magenta, not an ambiguous cold/black capture)
and the in-DOM transition is visible. `mount()` / `SolarError` public surface
and the LSDP wire dialect are **unchanged** — this is a patch publishing the
already-reviewed overlay (Pulsar ADR 003 Amendment 4 §A4.2). Refs #12.

## [0.2.1] - 2026-06-08

Served-bundle fix. `v0.2.0`'s served artefact (`dist/index.html` +
`solar.js`) was built in **library mode** with every runtime dep marked
`external`, so the bundle Orion static-serves and the Pulsar CEF loads
carried **bare ESM specifiers** (`react`, `react-dom/client`,
`@preact/signals-react`, `@preact/signals-react/runtime`, `framer-motion`,
`react/jsx-runtime`) that a bundler-less, import-map-less browser cannot
resolve — `mount()` never ran and the broadcast frame stayed black (B4).
The `mount()` / `SolarError` public surface and the LSDP wire dialect are
**unchanged**, so this is a patch. Refs ADR-001, #9.

### Added

- **Dual-build: a self-contained "host / standalone" target.** A second
  Vite build (`vite.config.host.ts`, app mode, **no externals**) inlines
  react / react-dom / @preact/signals-react / framer-motion and emits
  `dist/host/**` — a hashed, relatively-imported ESM bundle with **zero
  bare specifiers**. This is the artefact Orion static-serves at
  `/orion/static/solar/v0.2.1/` and the CEF loads. `npm run build` now
  produces **both** outputs from the same `src/`: the library entry
  (`dist/solar.js`, externals, for `@zablab/solar`/Prism — unchanged) and
  the host bundle. Host bootstrap moved from inline HTML to
  `src/host-entry.tsx`.
- **CI gates against the B4 regression.** `scripts/check-host-bundle.mjs`
  scans `dist/host/**` and fails on any bare ESM specifier; a Playwright
  smoke test (`tests/e2e/host-bundle.spec.ts`) loads the served bundle in
  a real browser with **no import map** and asserts `mount()` runs with no
  module-resolution error. Both wired into `ci.yml` and `release.yml`.
- **Dedicated host-bundle size budget** in `scripts/check-bundle-size.mjs`
  (deps inlined → necessarily larger; not held to the library budgets).

### Unchanged

- `@zablab/solar`'s package entry (`exports`, `dist/solar.js`, externals)
  is byte-shape-compatible for Prism. The library gzip budgets still pass.

## [0.2.0] - 2026-06-08

LSDP-capable release. The deployed `v0.1.1` bundle only spoke Solar's
bespoke wire ; `v0.2.0` is the first bundle that speaks **LSDP/1.1** end
to end, which Orion v2 and the Pulsar bundle require.

### Changed

- **Wire dialect bespoke → LSDP/1.1.** `mount()` now routes the full
  lifecycle (subscribe → snapshot → bundle fetch → delta → scene_changed
  → crossfade → token rotation → teardown) through `@lumencast/runtime`
  (`LSML 1.1` render + `LSDP/1.1` transport). The public `mount()` +
  `SolarError` surface the three hosts (Pulsar CEF / Prism webview /
  editor preview) depend on is unchanged — only the dialect on the wire
  changes, hence a minor (not patch) bump. Refs ADR-002 §A1.2,
  Orion ADR-001.

### Removed

- **Bespoke `src/transport/`.** Solar's home-grown codec / sequence /
  reconnect layer was a duplicate of what `@lumencast/runtime` ships to
  spec ; it is gone. Solar is now a thin adapter over the runtime
  (per ADR-007 sub-chantier B).

### Dependencies

- Requires `@lumencast/runtime ^0.2.0` (resolved `0.2.0`, with
  `@lumencast/protocol 0.2.0` for the LSDP/1.1 wire).

## [0.1.1]

Last bespoke-wire bundle. Superseded by `0.2.0` for any LSDP host.
