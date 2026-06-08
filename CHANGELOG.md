# Changelog

All notable changes to `@zablab/solar` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/), and the project
adheres to Semantic Versioning (pre-1.0 : minor bumps may carry
behavioural changes that keep the `mount()` API stable).

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
