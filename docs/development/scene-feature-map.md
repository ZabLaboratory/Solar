# Scene runtime feature map

Solar has one scene path: LSDP state plus an exact ZabCanvas LSMLZ revision,
rendered by Vision. Scene source identity comes from the server snapshot; Solar
does not resolve or compile a RenderBundle.

| Capability | Owner | Consumers / checks |
| --- | --- | --- |
| Renderer phase acknowledgement and retained compensation frame | `src/engine/control-feedback.ts`, `src/engine/native-lsdp-runtime.ts` | phase lifecycle and fragmented read tests; real Orion/two-CEF proof |
| Startup catalog synchronization and partitioned bounded browser cache | `src/scenes/startup.ts`, `src/scenes/browser-store.ts`, `src/host-entry.ts` | `tests/unit/startup-cache.test.ts`; offline/pagination/conflict/eviction |
| Same-port child recovery from parent RAM and watcher reconnection | `src/server/native-server.ts` | `scripts/test-reception-recovery.mjs`; forced child death and immutable archive |
| Public mount lifecycle and required source provider | `src/mount.ts`, `src/types/index.ts` | `tests/unit/mount.test.ts` |
| Canvas scene lookup, version pinning, source/assets and Blue manifest verification | `src/scenes/canvas.ts`, `src/scenes/types.ts` | `tests/unit/scene-source.test.ts`; `scripts/prove-authenticated-canvas.mjs` |
| Native binary WebSocket snapshots, exact selectors, source fetch and distinct reception/presentation receipts | `src/engine/native-lsdp-runtime.ts`, `vendor/lsdp-native-browser/` | `tests/unit/native-lsdp-runtime.test.ts`; `scripts/test-native-lsdp.mjs` |
| Scalar coalescing with every mutation retained in covering presentation receipts | `src/engine/frame-patches.ts` | `tests/unit/frame-patches.test.ts`; blocked-frame native subscriber proof |
| Combined state/camera submission without a RAF cap, bounded media grace and owned bitmap lifecycle | `src/engine/vision-frames.ts`, `src/engine/vision-media-bridge.ts` | `tests/unit/vision-frames.test.ts`, `tests/unit/vision-media-bridge.test.ts`; fixed-window CEF cadence and encoded counter |
| Atomic LSML operations, text-value projection and temporary render packages with pinned assets/provenance | `src/scenes/native-document.ts` | `tests/unit/native-document.test.ts` |
| Native draft2 Merkle hashes and portable JSON conformance | `src/internal/native-tree.ts` | upstream vectors in `tests/unit/native-document.test.ts`; Rust interoperability |
| Atomic path copies and incremental native integrity without full-scene rehash per leaf | `src/internal/native-state.ts`, `src/internal/native-tree.ts` | `tests/unit/native-state.test.ts`; runtime and reception consumers |
| Shared native reception lifecycle, resources and real readiness | `src/server/` | `scripts/test-reception-server.mjs`; `scripts/test-reception-install.mjs`; Prism startup and Orion readiness |
| Ephemeral local source/mutation/full-LSML endpoints using the product host | `scripts/native-lsdp-local.mjs`, `scripts/native-lsdp-tools.mjs` | `npm run native:start`; `docs/development/native-lsdp.md` |
| Packaged platform binary verification | `scripts/package-native-server.mjs`, `scripts/check-native-package.mjs` | installed `src/server/native-server.ts` startup; release manifest |
| LSMLZ loading, snapshot/delta updates and visible frame swap | `src/engine/vision-presenter.ts` | `tests/unit/native-lsdp-runtime.test.ts`; `scripts/check-host-bundle.mjs` |
| Blue declaration and validated binding closure attached to each revision | `SceneBlueManifest` in `src/scenes/types.ts` | source provider and runtime integrity checks |
| Immutable source cache and atomic Node storage | `src/scenes/cache.ts`, `src/server/scene-store.ts` | cache/store suites; offline revision, assets, Blue closure, corruption and live-variant refusal |
| Authenticated Canvas acquisition and real full-process cold restart | `scripts/prove-authenticated-canvas.mjs`, `scripts/prove-cold-start-cef.py`, `scripts/proof/cold-start-host.mjs` | actual local Canvas capsule or explicit fixture mode; Orion/Rust/CEF, both lanes and all discovered commands; remote producer probe separate |
| First-party module reachability | `scripts/check-source-usage.mjs` | `npm run check:source-usage`; tsc/eslint for unused symbols |
| Isolated native reception, immutable hashing and frame-paced scalar receipts | `src/engine/native-worker.ts`, `native-worker-client.ts`, `frame-patches.ts`, `src/internal/native-state.ts`, `native-tree.ts`, `native-stream.ts`, `native-digest.ts` | native-state/stream/worker-client/frame-patches/digest suites; real native/CEF counter acquisition |
| Atomic completed-frame projection for CEF | `src/engine/canvas-presentation.ts`, `vision-presenter.ts` | canvas-presentation suite; recorded unchanged gray panels checked on every encoded frame |
| Local camera/screen/window/app resolution and Vision texture updates | `src/sources/capture.ts`, `src/engine/live-media.ts` | `tests/unit/capture-resolution.test.ts`, `tests/unit/live-media.test.ts` |
| Receive-only remote camera rooms, slot mapping and stream lifecycle | `src/sources/peers.ts`, `src/peer-viewer/` | peer injection, Antenne and slot-binding suites; `scripts/prove-peer-camera-cef.py` with actual Meet, publisher and two CEF viewers |
| Served host configuration and Vision static assets | `src/host-entry.ts`, `host.html`, `public/vision/` | host build and `npm run check:bundle` |
| Single Vision asset owner and strict combined release layout | `vite.config.ts`, `vite.config.host.ts`, `scripts/check-runtime-layout.mjs` | `tests/unit/runtime-layout.test.ts`; build, bundle and packing gates |

The same Vision renderer handles broadcast, control and test subscriptions. Mode
changes host audio policy; resource/selector declares the subscription. Source loads
are pinned to the incoming `(scene_id, scene_version)`; a newer snapshot aborts
an obsolete load before it can become visible.
Native subscriptions instead deliver the full LSML document and source mutations;
the source identity remains pinned while its temporary render variant changes.
Native scene_version is the source LSML address; x-orion-artifact-set is the
separate admitted Orion generation key. Both survive the preparation boundary.

The scene record retains ZabCanvas's revision-pinned Blue declarations and
binding closure alongside the LSMLZ. This is the metadata retained in the synchronized local scene and Blue cache. The cached provider now stores verified
immutable sources; served-host startup synchronization is wired when credentials
and IndexedDB are available. Solar
does not execute Blue programs itself.

The WebRTC compatibility dependency is resolved only to its receive-only viewer
entry. Its compiled scene renderer, Solar's old React renderer, bundle URL
resolver, atlas, overlay and editable-preview sideband are removed.

Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` and
`npm run check:bundle` after changing these paths. Physical camera capture,
authenticated production access and Pulsar composition still require a host
smoke test.

Qualification and maturity: docs/runbooks/qualification.md and docs/development/maturity.md own reproducible proof procedures and the current evidence boundary. The Vision asset manifest and scripts/check-vision-assets.mjs own byte pins; scripts/check-source-usage.mjs owns first-party module reachability.

Derived file/symbol/import/consumer index: [code-map](code-map.md).
Maintenance and historical-tool boundaries: [Solar tooling](../../scripts/README.md).
