# Solar

## Current runtime

Solar is the host-side LSDP client for the Zablab broadcast platform. Orion
provides authoritative scene identity and mutable leaf state. Solar requests
the exact scene revision by identifier from ZabCanvas and presents its LSMLZ
archive with Lumencast Vision.
The required `nativeLSDP: { url, resource, selector? }` reads a complete LSML resource
from the actual Lumencast Rust server through its draft2 WebSocket binding.
Solar keeps the original source/assets and Blue manifest pinned, applies flat
default changes in Vision, and rebuilds structural variants only in memory.
The local `native:start` harness writes neither config nor mutated LSML.
`src/server/` is the product reception host, exported as `@zablab/solar/server`.
A Node/Electron main host launches one instance for declared Solar/Orion resources,
waits for capability/resource reads, and owns shutdown/session reset. Prism must
wire this lifecycle in its integration. The local
harness uses that same host. Full LSML uses Rust's existing state-diff route.

There is one renderer for broadcast, control and test subscriptions. Solar does
not compile Blue programs, fetch or render a compiled scene bundle, or retain a
React scene tree. A scene switch is an LSDP state transition: Solar loads the
version pinned by the incoming snapshot, applies queued mutations, then presents
the new Vision scene.

The public API is `mount()` plus types. `MountOptions.sceneSourceProvider` is
required. `createCanvasSceneSourceProvider()` is the online ZabCanvas provider;
createCachedSceneSourceProvider() wraps that boundary with a verified local store. Synchronization at application startup remains owned by the host.

## Blue and local scene preparation

Each ZabCanvas delivery includes the Blue declarations, validation record,
binding closure and readiness result pinned to the exact source revision. Solar
retains this manifest beside the active source and in verified immutable
scene/Blue cache capsules. Blue execution remains server-owned; its scene changes arrive
through LSDP mutations. Solar does not run Blue locally.

The online provider fetches scenes from ZabCanvas. The optional cached provider retains only immutable exact revisions and complete offline Blue manifests; FileSceneSourceStore publishes capsules once and refuses conflicting bytes. The served browser host synchronizes at startup with bounded quota/LRU eviction in credential-partitioned IndexedDB. Node consumers supply an account-specific directory and retention policy. See docs/development/source-cache.md.
Do not remove the Blue manifest from `SceneSourceDelivery`: LSML alone does not
describe every validated Blue dependency needed for offline preparation.

## Cameras and live media

Vision reports live media descriptors while loading LSMLZ. Solar resolves local
camera, screen, window and application references through the host capture map,
and joins remote camera rooms through the receive-only peer viewer. Solar fits
each video frame to Vision's declared texture and uploads it as an `ImageBitmap`.
Capture availability is not restricted by Solar mode; missing or denied sources
remain transparent and report recoverable errors.

`@lumencast/runtime` is retained only for its receive-only WebRTC viewer entry.
The compiled scene renderer is excluded from both Solar builds.

## Source ownership

- `src/engine/vision-presenter.ts` owns Vision canvas lifecycle, patches,
  resizing and live texture calls.
- `src/engine/native-lsdp-runtime.ts` owns native resource snapshots,
  hash-pinned subscriptions, exact generation/session projection, source/Blue
  pins, atomic state reception and separate presentation receipts after frame submission.
- `src/engine/frame-patches.ts` owns scalar coalescing and covering presentation
  receipts; commands and structure keep their ordered execution.
- `src/engine/vision-frames.ts` owns one combined state/media submission in flight
  through MessageChannel. `vision-media-bridge.ts` captures the supported WASM
  engine dependency for upload before that same submission. Fixed-window cadence
  and encoded pixels are qualified in `docs/development/render-cadence.md`.
- `src/internal/native-tree.ts` owns draft2 Merkle hashing, checked against the
  byte-pinned upstream vectors and the real native server.
- `src/internal/native-state.ts` owns immutable atomic operation application and
  incremental integrity for browser and reception subscriptions.
- `src/engine/live-media.ts` owns local/remote stream subscriptions, camera
  capture pools, frame upload, texture clearing and stream cleanup.
- `src/scenes/` owns the scene source provider contract, ZabCanvas acquisition,
  content/version checks and Blue manifest integrity.
- `src/sources/` owns host capture resolution and remote peer stream access.
- `src/host-entry.ts` owns standalone-host URL/config parsing. It reads no scene
  identity from configuration; the LSDP snapshot is authoritative.
- `scripts/native-lsdp-local.mjs` and `scripts/native-lsdp-tools.mjs` own the
  ephemeral local Rust process, read-only archive serving and mutation endpoint;
  `docs/development/native-lsdp.md` documents their use and limits.
- `src/server/` owns native binary verification, receiver process lifecycle,
  declared resources, native state-diff delivery, operation delivery and probes.
  `scripts/package-native-server.mjs` and `scripts/check-native-package.mjs`
  assemble and verify platform binaries in the release archive.

The former React renderer, compiled bundle path, atlas/overlay, and editable
preview sideband are removed. ADR files and historical changelog entries record
the previous design and are not current runtime instructions.

## Validation

```bash
npm run lint
npm run typecheck
npm run check:architecture
npm run check:native-client
npm test
npm run build
npm run check:bundle
```

These checks prove local code and artifact construction. They do not prove
authenticated access to production ZabCanvas, physical camera permission,
Pulsar CEF compositing or deployment.

## Discovery

Use `npm run code:read -- <path-or-symbol>` and `npm run code:find -- <query>`.
The generated index is [docs/development/code-map.md](docs/development/code-map.md);
active maintenance/qualification tools and retained history have explicit ownership
in [scripts/README.md](scripts/README.md). `npm run check:architecture` checks
module/export/dependency reachability, the derived index, local documentation and file sizes.
