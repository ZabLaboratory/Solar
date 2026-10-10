# Solar native reception host

This Node/Electron-main entry owns the unchanged Lumencast Rust process. It is
separate from the browser renderer. A single instance accepts declared resources
for Solar and Orion; neither consumer launches a second daemon.

`SolarReceptionServer.start()` injects resource seeds and typed local routes over
stdin, waits for listeners and checks native capabilities. It creates no automatic
resource subscriptions or JavaScript recovery mirror. `replace()` sends the full desired LSML to Rust's existing
state route, which computes the diff. `apply()` sends explicit operations with a
baseline precondition. `stop()` cancels requests and reaps the owned process.

The application main host is the lifecycle authority: supply its local HTTP origin, distribute the
TCP/WebSocket addresses and invalidate readiness on terminal `onFailure`.
Rust alone owns accepted resource state. A failed child is replaced on the same
ports with empty scene resources and declared control-state seeds. Producers must
republish the active selection; no previously accepted scene is restored.
Explicit consumer watchers reconnect; `status()` exposes recovering/ready,
and `onRecovery` reports attempts. Recovery defaults to three bounded attempts.
An individual watch failure resynchronizes against the live receiver. It never
restarts a healthy child from the watcher's older state. Child exit or a
failed readiness probe remains the authority for process recovery. Watched state
uses immutable path copies and cached normative hashes, shared with Solar's reader.
`recoveryAttempts: 0` retains an explicit fatal-exit policy. `stop()` cancels
recovery and reaps children. Explicit stop/start seeds the original state.
No journal, outbox or mutated LSML is written. A lost parent cannot recover live
RAM; Orion re-admits immutable sources using its desired selection file instead.

The installed runtime resolves `native/manifest.json` and checks the platform
binary's SHA-256. Runtime startup requires neither Cargo, esbuild nor a Lumencast
source checkout. `scripts/package-native-server.mjs` supplies that release artifact.
Unit and real-native integration checks live with Solar's tests/scripts.

`FileSceneSourceStore` is the Node adapter for immutable source capsules. It
publishes once by same-directory staging/link and accepts only opaque SHA-256 keys.
Identical concurrent writes succeed; conflicting bytes preserve the accepted file.
The cached provider verifies each capsule before reuse. Supply a per-account
application directory and retention policy. No credential/live mutation is saved.
This store does not replace Orion's signed Blue/source admission or daemon lifecycle.

## Installation fonts

`installation-fonts.ts` owns immutable font files under the installation user-data
`Solar/fonts` directory. It enumerates packaged editor fonts, Windows system and
per-user font directories, and registered external Windows font paths from
`windows-fonts.ts`. Only new/modified sources are copied and content-addressed;
unchanged files reuse the installation index. TTF/OTF/TTC/WOFF/WOFF2 are admitted;
legacy Windows FON/FNT bitmap files are reported as unsupported. The authenticated
loopback catalogue belongs to the receiver lifecycle and has explicit origin,
file-count, byte and digest checks. No scene data is written to this catalogue.
The browser receives its endpoint through `ReceptionConnection.fontCatalog`.
`tests/unit/installation-fonts.test.ts` covers cold/warm preparation, incremental
additions, deduplication, endpoint authorization and corrupt file rejection.

`SolarReceptionServer.replace` validates portable JSON, Unicode, safe numbers and
the native depth/node budgets before its route transaction. It does not compute a
Merkle hash whose result would be discarded: the Rust receiver hashes the accepted
resource, and subscribers continue checking normative before/after hashes. Snapshot
read verification and initial resource checks retain their existing Merkle hashes.

## Launcher scene library

`SceneSourceLibrary` owns immutable sources only. Its directory is partitioned by
SHA-256(gateway, stable account id); no token is persisted. `synchronize` walks every
accessible catalogue page and verifies current descriptors before disk reuse.
Sources include the published LSMLZ assets and complete Blue closure. A completed
pass atomically publishes its index and prunes obsolete capsules; interrupted passes
never publish a partial catalogue. An index on disk cannot authorize reads after restart.
`read` serves only revisions admitted by the current pass. `revoke` clears admission.
The application owns launch waiting, refresh cadence and abort on account/logout.
Tests exercise 75 scenes, unchanged transfers, revised sources, removals and cancellation.
