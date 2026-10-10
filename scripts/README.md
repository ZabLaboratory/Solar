# Solar maintenance and qualification tools

[`sponsor-motion/`](sponsor-motion/README.md) creates and plays the local sponsor
LSML fixture, captures the real Solar front canvas and checks retained-scene replay.

Owner: Solar build/installation/qualification. Package commands and the following CLI tools
are active entrypoints. Helpers belong to their nearest README. They are not renderer code.
All generated output must be inside this worktree's `build/`, `dist/` or canonical `evidence/`.
No tool implicitly publishes, deploys or edits Prism. Host/camera probes launch only owned processes.

## Build, guards and installation

| File                          | Invocation / responsibility                                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `build-host-html.mjs`         | Build's versioned relative CEF HTML entry                                                                                        |
| `build-server.mjs`            | `npm run build:server`; Node reception package and declarations                                                                  |
| `check-host-bundle.mjs`       | `npm run check:bundle`; actual emitted source maps and self-contained imports                                                    |
| `check-runtime-layout.mjs`    | `npm run check:layout`; unique assets and installed-root collisions                                                              |
| `check-vision-assets.mjs`     | Build and bundle; immutable Vision file SHA-256/size pins                                                                        |
| `check-native-client.mjs`     | `npm run check:native-client`; upstream client/license/vector pins                                                               |
| `check-native-package.mjs`    | `npm run check:native-package`; packaged native manifest/binary hashes                                                           |
| `check-source-usage.mjs`      | `npm run check:source-usage`; product module/export/dependency graph                                                             |
| `check-documentation.mjs`     | `npm run check:docs`; local current links/paths/commands and tool ownership                                                      |
| `check_file_sizes.py`         | `python scripts/check_file_sizes.py`; per-file size policy and self-tests                                                        |
| `package-native-server.mjs`   | `npm run package:native -- --binary <path> --platform <platform> --revision <sha>`                                               |
| `create-runtime-manifest.mjs` | Release only; archive/version/repository/tag/output arguments, both native platforms required                                    |
| `patch-peer-viewer.mjs`       | Package postinstall; [receive-only compatibility](peer-viewer/README.md)                                                         |
| `test-peer-install.mjs`       | `npm run test:peer-install -- <runtime.tgz> <protocol.tgz>`; fresh lock-pinned hoisted deps, exact three targets and idempotence |
| `code/`                       | [Derived discovery and docs guard](code/README.md); `npm run code:read -- <query>`                                               |

The `.github/workflows/release.yml` source declares the actual release checks. A configured
runner or binary path does not prove provisioning, publication, deployment or application startup.

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

| File                             | Responsibility                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------- |
| `prove-native-cef.py`            | Native LSML mutations plus real owned Pulsar CEF scene                                 |
| `prove-scene-control-cef.py`     | Two lanes, coordinated transitions and compensation                                    |
| `prove-cold-start-cef.py`        | Complete shutdown/restart, immutable capsules, explicit real-admission or fixture mode |
| `prove-peer-camera-cef.py`       | Actual Meet, physical publisher and receive-only CEF viewers                           |
| `prove-authenticated-canvas.mjs` | Identity/source route/broker-locator probe with separate boundary verdicts             |
| `prove-read-query-gateway.mjs`   | Authoritative query/gateway diagnostic; operator denial is not broker artifact absence |
| `proof/`                         | [Capture, producer and analysis helpers](proof/README.md)                              |

Pass `--help` to Python drivers; Node diagnostic headers document their arguments. Each run
records its specific admitted source, receipt/pixel boundary, errors and owned-process cleanup.
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
