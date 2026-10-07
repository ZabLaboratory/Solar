# Solar native reception host

This Node/Electron-main entry owns the unchanged Lumencast Rust process. It is
separate from the browser renderer. A single instance accepts declared resources
for Solar and Orion; neither consumer launches a second daemon.

`SolarReceptionServer.start()` injects resource seeds and typed local routes over
stdin, waits for listeners, checks native capabilities and reads all resources over
the real protocol. `replace()` sends the full desired LSML to Rust's existing
state route, which computes the diff. `apply()` sends explicit operations with a
baseline precondition. `stop()` cancels requests and reaps the owned process.

The application main host is the lifecycle authority: supply its local HTTP origin, distribute the
TCP/WebSocket addresses and invalidate readiness on terminal `onFailure`.
The host watches accepted external resource updates into bounded resource
snapshots in parent RAM. A failed child is replaced on the same ports, restoring
those snapshots and reconnecting watchers; `status()` exposes recovering/ready,
and `onRecovery` reports attempts. Recovery defaults to three bounded attempts.
An individual watch failure resynchronizes against the live receiver. It never
restarts a healthy child from the watcher's older checkpoint. Child exit or a
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
