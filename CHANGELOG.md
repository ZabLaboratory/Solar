# Changelog

All notable changes to `@zablab/solar` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/), and the project
adheres to Semantic Versioning (pre-1.0 : minor bumps may carry
behavioural changes that keep the `mount()` API stable).

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
