# Changelog

All notable changes to `@zablab/solar` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/), and the project
adheres to Semantic Versioning (pre-1.0 : minor bumps may carry
behavioural changes that keep the `mount()` API stable).

## [Unreleased]

## [0.2.12] - 2026-06-28

### Added

- **Antenne `x-zab.meet-peer` activation** (re-vendor of Solar `main` #29 `69631a3`
  / #31 `d020d67`). This version cut packages the merged meet-peer broadcast path so
  the bundle vendored by Prism (`resources/solar/v0.2.12/`) and static-served by Orion
  (`/orion/static/solar/v0.2.12/`) carries it. The host bundle now consumes the
  `@lumencast/runtime@0.11.0` `onReservedLeaves` hook (antenne controller, `mount.ts`)
  and renders the `x-zab.meet-peer` kind (slotRef re-keying from the #29 registry). No
  source change in this version beyond the package version bump — it exists to give the
  meet-peer-bearing bundle a distinct immutable version path (the previous `v0.2.11`
  artefact predates #29/#31 and must not be overwritten under its frozen cache key).

### Changed

- `@lumencast/runtime` `^0.9.0` → `^0.11.0` (already on `main` via #31; recorded here for
  the version cut).

### Fixed

- **Transparent host page background** (`host.html`). The host page now sets
  `background: transparent` instead of `#000`. Pulsar's CEF browser_source
  composites the host over the OBS scene in alpha; an opaque background painted
  a full-frame black fill that hid every native OBS source anchored behind the
  browser_source. For an `x-zab.capture` scene — whose only on-air content is a
  transparent placeholder (getUserMedia is blocked on air) — that produced a
  fully black antenna while the native cam/screen source rendered correctly but
  invisibly underneath. Opaque scene content still paints over the transparent
  page exactly as before, so non-capture scenes are unchanged.

## [0.2.10] - 2026-06-24

### Added

- **`x-zab.capture` device resolution** (Lumencast ADR 004 §A1.3). `mount()`
  now forwards a `resolveCaptureDevice(deviceRef, sourceKind)` resolver to the
  runtime's ACQUIRE path. The default resolver reads a host-injected page
  global, `window.__ZAB_CAPTURE_DEVICES__` (a `deviceRef → deviceId` map the
  Prism preview host pins via its scene-server bootstrap), and maps a bundle's
  LOGICAL `deviceRef` onto a physical `getUserMedia` `deviceId`. Absent/empty
  map → `null` → the runtime acquires the host's default cam (no constraint).
  A host may override via `MountOptions.resolveCaptureDevice`. Solar never
  calls `getUserMedia` itself — acquisition stays in the runtime. New public
  type `ResolveCaptureDevice` (`src/types/index.ts`); wiring in `src/mount.ts`.
  Only consulted on a capture-capable host (the Electron preview webview);
  on-air (CEF/Pulsar) renders the placeholder.

### Changed

- Bump `@lumencast/runtime` from the local `0.8.0` test tarball to the
  published **`^0.9.0`** from npm (lockfile resolves `0.9.0`, transitively
  `@lumencast/protocol@0.9.0`). 0.9.0 ships context-aware capture
  (ACQUIRE/PLACEHOLDER) and the ADR 011 I7 keyframe-compositing fix **natively**
  — the `patch-package` crutch (`patches/`, the `.local-runtime/` test tarball,
  and the `patch-package` devDependency) is removed entirely; `npm ci` no longer
  applies any patch. Solar's public surface is unchanged.

## [0.2.9] - 2026-06-13

Fix the keyframe-animation RUNTIME so `core.animation.play@1` actually moves
and fades at the antenna (ADR 011 I7, 3rd and last link). The render bundle
Orion served was already correct — a keyframed `frame` wrapper carrying the
target's static geometry (x:80,y:360, 160×160) with the animated
`transform`/`opacity` keyframes, the resolved target nested beneath — yet the
box rendered 100×100 pinned at (0,0), immobile, with no translateX and no fade
(proven by live frame-diff, tir I7 #2). Two distinct runtime bugs in
`@lumencast/runtime`'s keyframe path, BOTH dropping the animated geometry:

- **Dead wrapper box.** The `KeyframePlayer` wrapped the played subtree in a
  `<motion.div style={{display:"contents"}}>`. A `display:contents` element
  generates no box, so the browser silently dropped the `transform`/`opacity`/
  `filter` framer-motion wrote onto it — the wrapper's geometry never
  composited and the nested target rendered dead at its default origin. The
  player is now a real compositing box (`position:absolute; inset:0`) that also
  becomes the containing block for the absolutely-positioned target nested
  beneath, preserving its authored x/y.
- **Wrong framer transform key.** `compileForFramer` emitted the authored
  `translateX`/`translateY` channels verbatim, but framer-motion animates
  transform through its shorthand motion keys `x`/`y` — so the translation was
  silently ignored even once the box composited (only the opacity fade
  survived). The translate channels now map onto the framer keys.

Both are repairs to the EXISTING keyframe player (no new runtime primitive —
ADR 011 §6 criterion #6), shipped as a committed `patch-package` patch over
`@lumencast/runtime@0.6.0` since the buggy code lives in the bundled
dependency. Solar re-bundles the patched runtime into `dist/`. The wipe-cover
degenerate case (full-screen self-painting cover, no nested target) is
preserved: the cover still fills the screen and fades through the same
keyframe path; its byte-pinned authored shape is unchanged.

A runtime test (`tests/unit/animation-compositing.test.tsx`) mounts Solar
end-to-end against a bundle shaped exactly like the live render-bundle and
proves the wrapper composites the keyframe `translateX(400px)` + `opacity:1`
onto a real positioned box, with the nested 160×160 target preserved at
(80,360) — not (0,0)/default. The wipe-cover test reads the live opacity off
the new compositing box.

`mount()` / `SolarError` public surface unchanged (patch). Refs ADR 011 I7.

## [0.2.8] - 2026-06-12

Extract the show-token from the packed `orionUrl` — the missing half of the
0.2.6 auth-header fix. 0.2.6 added `Authorization: Bearer <token>` to the
render-bundle fetch and assumed Solar already forwarded the show token through
`mount({ token })`. In production it did not: the Pulsar browser source
addresses Solar with `index.html?orion=<orionUrl>&mode=broadcast`, where the
show-token lives **inside** `orionUrl`'s query
(`…/show/stream.lsdp?token=<SHOW>`), not as a top-level `?token=`. The host
entries read `params.get("token")` and got `""`, so `mount({ token: "" })` →
the runtime resolved an empty token → the bundle GET went out header-less →
Orion behind ZabGate replied **401** → black frame (`BUNDLE_FETCH_FAILED`).

The host and dev entries now resolve the show-token via `resolveShowToken()`
(explicit top-level `?token=` wins, else the token embedded in `orionUrl`),
and pass it to `mount({ token })`. The runtime then attaches
`Authorization: Bearer <show-token>` to the render-bundle fetch. Solar-only —
**no `@lumencast/runtime` change**, no new dependency. `mount()` / `SolarError`
public surface unchanged (patch).

An end-to-end test mounts the real runtime against the Pulsar browser-source
URL shape and asserts the bundle GET carries `Authorization: Bearer <token>`
(and that an empty token yields a header-less fetch — the regression guard).

Refs Zablab architecture (show-token: Pulsar CEF → Orion WS upgrade).

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
