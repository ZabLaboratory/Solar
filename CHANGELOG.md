# Changelog

All notable changes to `@zablab/solar` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — chantier Solar action runner

### Added

- **`Patch.action` descriptor** on the wire protocol — Solar now
  reconstructs dense patches locally rather than receiving them
  frame-by-frame. Six built-in kinds : `count-up`, `curve-path`,
  `text-reveal`, `stagger-group`, `reorder`, `mask-reveal`.
  Patches without `action` flow through the existing
  `transitions.ts` mapper unchanged — fully backward compatible.
- **`animate/action-runner.ts`** dispatcher + per-kind sub-runners
  in `animate/runners/`. Unknown kinds raise
  `UnknownActionKindError` ; hosts can register custom kinds via
  `registerActionRunner(kind, fn)`.
- **`animate/flip.ts`** — single source of truth for FLIP. Solar's
  `reorder` runner consumes it directly ; Prism's preview
  flip-runtime imports it via `@zablab/solar/animate/flip`.
- **`animate/easing-resolver.ts`** — resolve `EasingRef` (string id or
  inline spring) into a CSS easing string plus a `t → eased t`
  function.
- **`PrismScene` public class** at `scene/prism-scene.ts` exposing
  `mount`, `unmount`, `playAnimation`, `stopAnimation`, `on`/`off`,
  `connectToOrion`, `disconnectFromOrion`, `setScene`. Lets any web
  host run a Prism-authored scene without Pulsar, CEF, or Electron.
- **DOM binder** (`scene/binder.ts`) — one-way bindings via
  `data-anim-path` / `data-anim-attr`.
- **Examples** : `examples/embed-vanilla/` (UMD `<script>` tag) and
  `examples/embed-react/` (forwardRef wrapper).
- **Docs** : `docs/embed-on-website.md` (integration guide),
  `docs/action-descriptors.md` (protocol reference).
- **Packaging** : multi-entry ESM (`dist/solar.js`,
  `dist/animate/flip.js`), UMD bundle (`dist/solar.umd.js`),
  ESM alias (`dist/solar.esm.js`), public types
  (`dist/solar.d.ts`). `npm publish --dry-run` is green.

### Changed

- `react`, `react-dom`, `framer-motion` moved from `dependencies` to
  `peerDependencies`. Hosts supply their own copies — Solar links
  against them via `external` in both Vite configs.
- `package.json` `main` now points at the ESM bundle ; `unpkg` /
  `jsdelivr` fields target the UMD build for CDN consumers.

### Backward compatibility

- The existing `mount()` API is unchanged. ADR 002 wire messages
  (snapshot, delta, scene_changed) are unchanged. The
  `Patch.action` field is additive ; legacy patches keep their
  semantics.
- Once published, the `PrismScene` class surface is contract.
  Breaking it requires a major bump per ADR 003.

## [0.1.1] — animation bundle field

- `RenderBundle.animations?` field carried through but not yet
  dispatched (chantier animation-engine A8 + B-pivot).

## [0.1.0] — initial release (2026-05-02)

- Scene runtime bundle for the Zablab broadcast platform. Same
  bundle in Pulsar CEF, Prism webview, and editor preview iframe.
