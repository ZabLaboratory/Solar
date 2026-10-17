# Solar maintenance and qualification tools

[`kumiki-motion/`](kumiki-motion/README.md) authors the original vector motion study.
[`sound-design/`](sound-design/README.md) extends it with original music/sound assets,
LSML cue composition and a real native canvas/live audio qualification capture.

[`sponsor-motion/`](sponsor-motion/README.md) creates and plays the local sponsor
LSML fixture, captures the real Solar front canvas and checks retained-scene replay.

[`kumiki-motion/`](kumiki-motion/README.md) authors an original five-act vector
choreography of the canonical Kumiki mark and reuses the native motion reader.

[`z-bug/`](z-bug/README.md) traces the confirmed landing Z into two vector arrows
and authors a transparent stream-corner animation through that same reader.

Owner: Solar build/installation/qualification. Package commands and the following CLI tools
are active entrypoints. Helpers belong to their nearest README. They are not renderer code.
All generated output must be inside this worktree's `build/`, `dist/` or canonical `evidence/`.
No tool implicitly publishes, deploys or edits Prism. Host/camera probes launch only owned processes.

## Build, guards and installation

| File                          | Invocation / responsibility                                                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `build-host-html.mjs`         | Build's versioned relative CEF HTML entry                                                                                                      |
| `build-server.mjs`            | `npm run build:server`; Node reception package and declarations                                                                                |
| `check-host-bundle.mjs`       | `npm run check:bundle`; actual emitted source maps and self-contained imports                                                                  |
| `check-runtime-layout.mjs`    | `npm run check:layout`; unique assets and installed-root collisions                                                                            |
| `check-vision-assets.mjs`     | Build and bundle; immutable Vision file SHA-256/size pins                                                                                      |
| `check-native-client.mjs`     | `npm run check:native-client`; upstream client/license/vector pins                                                                             |
| `check-native-package.mjs`    | `npm run check:native-package`; packaged native manifest/binary hashes                                                                         |
| `check-source-usage.mjs`      | `npm run check:source-usage`; product module/export/dependency graph                                                                           |
| `check-documentation.mjs`     | `npm run check:docs`; local current links/paths/commands and tool ownership                                                                    |
| `check_file_sizes.py`         | `python scripts/check_file_sizes.py`; per-file size policy and self-tests                                                                      |
| `package-native-server.mjs`   | `npm run package:native -- --binary <path> --platform <platform> --revision <sha>`; validates arguments and the existing package before writes |
| `create-runtime-manifest.mjs` | Release only; archive/version/repository/tag/output arguments, both native platforms required                                                  |
| `patch-peer-viewer.mjs`       | Package postinstall; [receive-only compatibility](peer-viewer/README.md)                                                                       |
| `test-peer-install.mjs`       | `npm run test:peer-install -- <runtime.tgz> <protocol.tgz>`; fresh lock-pinned hoisted deps, exact three targets and idempotence               |
| `code/`                       | [Derived discovery and docs guard](code/README.md); `npm run code:read -- <query>`                                                             |

The `.github/workflows/release.yml` source declares the actual release checks. A configured
runner or binary path does not prove provisioning, publication, deployment or application startup.

`node --test tests/tooling/native-package.test.mjs` covers rejection without package mutation and a
matching-revision multi-platform extension.

## Real native and process-level checks

| File                          | Invocation / responsibility                                                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `native-lsdp-local.mjs`       | `npm run native:start -- --help`; same product receiver, RAM-only mutation host                                                         |
| `native-lsdp-tools.mjs`       | Helper used by local/proof producers; runtime bundling/native reads                                                                     |
| `test-native-lsdp.mjs`        | `npm run test:native -- <scene.lsmlz>`; actual binary snapshots/operations                                                              |
| `test-reception-server.mjs`   | `node scripts/test-reception-server.mjs <scene.lsmlz> <Orion>`                                                                          |
| `test-reception-install.mjs`  | `node scripts/test-reception-install.mjs <scene.lsmlz> <Prism-read-only> <Orion>`; installed dist and existing adapter loaded in memory |
| `test-reception-recovery.mjs` | `node scripts/test-reception-recovery.mjs <scene.lsmlz>`; child loss and same-port recovery                                             |
| `test-reception-burst.mjs`    | `node scripts/test-reception-burst.mjs <scene.lsmlz>`; native burst/recovery boundary, not pixel cadence                                |
| `test-packaged-cache.mjs`     | `node scripts/test-packaged-cache.mjs`; built immutable store/export boundary                                                           |

The integration adapter test's Prism argument is read-only; the full installed application
lifecycle remains a separate Prism task. See [qualification](../docs/runbooks/qualification.md).

## Scene/camera/producer qualification

| File                               | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prove-native-cef.py`              | Native LSML mutations plus real owned Pulsar CEF scene                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `prove-scene-control-cef.py`       | Two lanes, coordinated transitions and compensation                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `prove-cold-start-cef.py`          | Complete shutdown/restart, immutable capsules, explicit real-admission or fixture mode                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `prove-peer-camera-cef.py`         | Actual Meet, physical publisher and receive-only CEF viewers                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `qualify-native-burst.mjs`         | `node scripts/proof/qualify-native-burst.mjs --mode paced --duration 3900 --playwright-root <Prism>` or `--mode burst`; real private Rust/Solar/Vision path, separate ACK/event/pixel evidence                                                                                                                                                                                                                                                                                                                        |
| `qualify-meet-framing.mjs`         | Private Chrome, Solar controller and Vision WASM pixels for a synthetic peer, plus bounded capture-stage Performance entries; `--out build/meet-framing --playwright-root <Prism>`; excludes LSDP, real Meet and CEF                                                                                                                                                                                                                                                                                                  |
| `qualify-native-media.mjs`         | `node scripts/qualify-native-media.mjs --out-prefix <canonical-evidence-prefix> --playwright-root <Prism>`; real Solar presenter and pinned Vision WASM verify native capture delegation, synthetic peer pixels, mutation, resize and peer retirement. Optional `--baseline-ref <exact-sha>` injects only the historical presenter in the private Vite fixture and requires the demonstrated duplicate capture failure. No shared app, physical capture, network Meet, Main/CEF or LSDP qualification.                |
| `qualify-instance-runtime.mjs`     | `node scripts/qualify-instance-runtime.mjs --out-prefix <canonical-file-prefix> --playwright-root <Prism> --context-only false`; full exact-source/image qualification writes `-result.json`, `-pixels.png`, or `-failure.json` directly beside the canonical UTC prefix; legacy `--out <directory>` retains its directory output. Private Chrome/Vision WASM/WebGL covers named/SHA-1 assets, child HTTP images, mutation, failure and context restoration; Canvas HTTP package assets remain SHA-256-addressed only |
| `proof/qualify-repeat-runtime.mjs` | Prism import/export provenance, nested Repeat scopes, real native LSDP collection updates, visible last-frame retention after malformed-key rejection, corrected-snapshot reconnect, then acknowledged collection and scalar mutations in one private scene; see [proof helpers](proof/README.md) for invocation and evidence scope                                                                                                                                                                                   |
| `proof/qualify-image-lifetime.mjs` | `node scripts/proof/qualify-image-lifetime.mjs --playwright-root <Prism-node_modules> --lsdp-bin <lsdpd.exe> --count 512`; distinct dynamic-image URLs, real WebGL loss/restore, rejected-path frame retention and corrected-snapshot recovery through the pinned Vision runtime; see [proof helpers](proof/README.md) for evidence boundaries                                                                                                                                                                        |
| `prove-authenticated-canvas.mjs`   | Identity/source route/broker-locator probe with separate boundary verdicts                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `prove-read-query-gateway.mjs`     | Authoritative query/gateway diagnostic; operator denial is not broker artifact absence                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `proof/`                           | [Capture, producer and analysis helpers](proof/README.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

Pass `--help` to Python drivers; Node diagnostic headers document their arguments. Each run
records its specific admitted source, receipt/pixel boundary, errors and owned-process cleanup.
The Repeat run keeps one private scene identity/version while updating nested team and player
collections and records Solar's Vision asset pins beside each captured canvas. The valid
leaf/reorder/add/remove renders qualify, while the duplicate-key probe exposes a partial
recovery failure: native acceptance precedes Vision refusal, and Solar hides the retained
canvas layer.
External success is never inferred from a unit test or a connection ACK.

## Historical evidence

The old React/bundle postinstall is removed. Session-specific `certify-chain.py`,
`consolidate-maturity.py`, `consolidate-canvas-offline.py` and the early fixture-only
`verify-canvas-acquisition.mjs` are archived byte-for-byte under
[les preuves historiques du commit 421495ae759e7f69728507d557030eef640b66a3](https://github.com/ZabLaboratory/Solar/blob/421495ae759e7f69728507d557030eef640b66a3/evidence/local-20261005-solar-audit/forge).
They are retained to explain immutable phase certificates and hashes, not to rewrite current
source or docs. Owner: the corresponding qualification phase; review condition: deletion
requires retiring the linked historical certificate. The dated burst reproduction script
remains with its captured baseline, as documented in the cadence runbook.
