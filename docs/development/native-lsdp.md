# Native LSDP in Solar

The native Rust server remains unchanged. Solar owns its reception host in
`src/server/`, exported as `@zablab/solar/server`; the browser is its subscriber.
The application main host must start one shared instance and supply its TCP
address to Orion and WebSocket address to Solar. Resources `solar/program`, `solar/preview`,
`solar/generations`, `solar/sessions` and `orion/state` are independent.
Initially null means no scene selected, not a
renderable demo. Orion performs a native handshake/read at startup and readiness.
The host must invalidate readiness on receiver failure, reset it on logout, and
await the owned receiver at shutdown. While its parent survives, automatic child
recovery uses the same ports but starts scene resources empty and control resources
from declared seeds. The host neither subscribes automatically nor mirrors accepted
state. Producers republish the active selection after receiver loss. Explicit
stop/start uses the original seeds; parent loss drops live state.

Orion's ordered producer actor publishes original LSML, validated Blue output
mutations, editable inputs, cameras and overlay state to this node. Solar has
one native subscription path. Collections use a selector for an exact scene
generation or API test-session ID; unrelated entries cannot retarget Vision.
Scene-intent, editable and camera responses await native application ACK.

## Mutation application contract

After sending, the producer is outside the mutation application/rendering contract.
Solar receives and verifies native LSDP state, applies it, and Vision renders it.
Neither scalar nor structural mutations query `orion/state`, request Orion
permission, or await producer feedback. Native transport receipts and local
`solar:lsdp-received` / `solar:lsdp-applied` observations retain transaction,
sequence and state identity; they expose no `x-orion` projection. Explicit
scene-selection transition phases have separate coordination receipts.

Mutation latency is measured at Solar/Vision, with its boundary stated explicitly:
verified reception occurs after the transport worker's integrity checks, while
presentation means GPU submission and completed front-canvas copy. A producer's
HTTP command, preliminary state read or acknowledgement is not this duration.

## Run the current scene without saving mutations

Use an existing native platform binary. Package it after the Solar build:

```powershell
npm.cmd run build
npm.cmd run package:native -- --binary <path-to-lsdpd.exe> --platform win32-x64 --revision e695e14f9f664f430ffc2e0e75d083fab88abc7f
npm.cmd run check:native-package
npm.cmd run native:start -- --scene <original.lsmlz> --port 8099
```

Open `http://127.0.0.1:8099/` as a Pulsar CEF browser source or browser page.
The launcher serves Solar and the immutable original archive, and starts Rust
with `--settings -`. Its configuration and original LSML are injected by stdin;
there is no bootstrap file, journal, outbox, asset store or LSML export.
The development `--lsdp-bin` override is optional; installed startup resolves the
shipped binary, verifies SHA-256 and needs no source checkout/build tools.
`--camera "<physical-camera-label>"` optionally maps the existing
`obs-virtual-camera` authored reference in this test scene to a host camera.

Apply ordinary add/remove/replace/test JSON Pointer operations:

```powershell
$operations = '[{"op":"replace","path":"/layout/children/1/background","value":"#203248"}]'
Invoke-RestMethod http://127.0.0.1:8099/mutations -Method Post -ContentType application/json -Body $operations
```

`POST /lsml` accepts the complete desired LSML JSON object. The product host
sends it to Rust's existing typed `state` route. Rust reads B and computes the
Merkle diff to A, skipping unchanged subtrees. The host does not turn it into
a whole-root replacement. Stable route IDs are supported by the product API
for retries. `/mutations` uses explicit operations and a baseline precondition.
Both paths modify receiver RAM only.

The existing embedding adapter contract uses a session-token-gated `/solar/native`
route to report the common endpoints. Its installed application lifecycle is a separate
Prism integration proof; these are not endpoints implemented by the Solar browser.
`POST /solar/native/{program|preview}/lsml` receives `{document,id?}` and
`POST /solar/native/{program|preview}/mutations` receives
`{operations,id?,beforeHash?}`. The embedding host may translate `native=program`/`native=preview` to trusted
`__SOLAR_CONFIG__.nativeLSDP`; Solar itself reads that config or explicit `lsdp`,
`resource` and `selector` query parameters. Source
archives/assets and Blue provenance still come from the exact source provider.

The release archive includes `server/index.mjs`, declarations and
`native/manifest.json` with platform binaries. Release assembly requires Windows
and Linux inputs (`SOLAR_LSDP_WINDOWS_BINARY`, `SOLAR_LSDP_LINUX_BINARY` runner
variables); absence blocks publication. This local work verifies Windows only,
and does not claim those release inputs are provisioned on CI.

The endpoint reads the native resource, prepares `lsdp.apply/1` with its Merkle
`beforeHash` and a fresh transaction ID, then sends it to Rust. It returns the
native authoritative receipt, which proves server application. Solar separately
emits `solar:lsdp-applied` on its mount target after Vision submits the changed
frame. Scalar defaults use a distinct native `received` receipt after integrity
and atomic LSML application, plus `solar:lsdp-received`. The frame queue combines
the latest scalar values through the actual Vision submission barrier, using a
MessageChannel task rather than a 60 Hz animation-frame cap; every original
transaction gets a presentation event after its covering submission, carrying
`presentation.throughSequence`, final state hash and covered mutation count.
This permits intermediate values to be overwritten without discarding mutations
or claiming every intermediate state was visible. Structural edits, commands
and lane transitions drain that queue and retain synchronous applied receipts.
Camera images and state can share a submission. Camera-only work allows at most
8.33 ms for a patch to arrive; state and explicit barriers bypass that grace.
`scripts/proof/analyse-render-cadence.py` counts native ACKs, sequential LSML
reception and completed distinct mutation frames in fixed 100/1000 ms windows.
The latter requires the Vision submission and completed front-canvas copy,
and excludes camera-only frames. Physical scan-out and encoded video pixels
remain separate measurements; `analyse-native-counter.py` reads actual pixels.
The local harness records these observations in `/health`, alongside
camera acquisition and errors; `/state` reads current RAM state. All diagnostic
history is bounded and in memory. No request writes the edited document.

Ctrl+C stops the owned HTTP/native processes. Restarting seeds the original
LSML again and drops all mutations. Source archives are opened read-only.

## API and source provenance

```ts
mount({
  target,
  nativeLSDP: { url: "ws://127.0.0.1:4520/lsdp", resource: "scene" },
  token: "", // local native server without configured authentication
  mode: "test",
  sceneSourceProvider,
});
```

The native resource contains full LSML, including scene identity, layout and
defaults. Its `scene_id` and `scene_version` identify the published source
origin used to fetch its assets and Blue manifest. That origin remains pinned
during edits. Changing origin fields triggers an exact new source request.
LSML's JCS address and LSDP's `tree-sha256:` hash are different contracts.

Flat `/defaults/<binding>` add/replace updates go through Vision's retained
patch API, including `__lit` values. A new remote image URL is fetched from the
scene's allowed hosts and added to a temporary archive in memory before staging
the updated presenter; previously packaged URLs use the retained patch path.
The `solar:lsdp-applied` observation reports the actual `patch` or `document`
render path. Numeric/null text bindings use private string aliases without
changing the raw source variables. A removal, nested/default collection edit
or structural/layout mutation prepares a new LSMLZ **only in RAM**, preserving
the original binary assets. It recomputes the temporary variant's content
address for Vision and swaps after its first submitted frame. Vision currently
offers binding updates, not a complete source-document mutation API; this
bounded rebuild keeps arbitrary source edits correct. Adding new binary assets
still requires a source delivery containing them.

The temporary render package does not alter the source delivery, original
LSML bytes, Blue manifest or published revision. It does not assert a new Blue
validation for edited content. The local launcher marks its fixture manifest
`local-source-only`, with readiness false, rather than pretending to have a
ZabCanvas validation record. Production source providers retain their checks.

Snapshot subscriptions close the read/subscribe race with the native server's
baseline hash check. Explicit resync obtains a new snapshot on the same connection;
invalid operations or failed renders close the session and recover from a fresh
native snapshot. An in-flight read/subscription race retries at most four times.
Late work is aborted on disconnect or credential rotation. Rebuilding a
document shares the capture pool across the old and new Vision layers.
Before staging another Vision canvas, Solar pauses camera uploads and drains
the old presenter's GPU queue. It resumes uploads after old-engine teardown,
while keeping the capture tracks acquired. This prevents overlapping WebGL
work from erasing static scene layers during an otherwise accepted mutation.

Scalar state is received and verified in a dedicated Solar worker. The main
consumer emits `solar:lsdp-received` after ordered LSML application; a frame queue
merges replaceable values while preserving every transaction ID. Following a
successful Vision submission, `solar:lsdp-applied` includes the original state
hash and `presentation` with the covering sequence/hash/count. A covering frame
does not claim that each overwritten intermediate value appeared on screen.
Commands, camera/animation effects and structure drain this queue before execution.

The pinned Rust subscription has a bounded event buffer and no historical replay.
A producer faster than that subscriber can trigger `SUBSCRIBER_LAGGED`. Solar
resynchronizes the final LSML; that run cannot certify receipt/rendering of every
intermediate transaction. Mutation throughput, covering submissions and distinct
encoded counter values must be reported separately. `scripts/proof/native-burst-producer.mjs`
supports immediate queuing and an explicit paced duration. `analyse-native-counter.py`
reads the real counter pixels and recorded HUD clock, exports exactly 60 source
frames over one second, and retains its frame-by-frame values/alignment uncertainty.

## Validation and protocol pin

```powershell
npm.cmd run check:native-client
npm.cmd run test:native -- --lsdp-bin <path-to-lsdpd.exe> --scene <original.lsmlz>
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run check:bundle
```

Native interoperability checks use the real Rust process: fragmented snapshot
and mutations, hash agreement, add/remove/replace/test, atomic failed batches,
stale baselines, idempotency, unchanged source bytes and restart reset.
Runtime tests also cover ACK timing, renderer failure and lifecycle aborts.
The exact upstream browser files and vectors are byte-pinned in
`vendor/lsdp-native-browser`; their owner/provenance are documented there.
CEF screenshots remain a separate host-level proof.
