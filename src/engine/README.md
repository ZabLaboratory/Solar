# LSDP and Vision runtime

`vision-composition-frame.ts` validates the typed `vision.native-composition-frame/1`
receipt emitted by the same GPU submission as the presenter's canvas. It checks
the exact render-variant scene identity, canonical scene grid, atlas canvas extent,
integer 1:1 bands, graph ownership and monotonic accepted pixel/layout revisions.
Capture framing remains explicit in this receipt: fit, normalized source crop,
nullable content box/position fields and zoom come from the active Vision graph.
Blend, mask and clip presence are checked as graph facts; acceptance does not
claim that the native compositor supports every such effect.
It does not derive layout from LSML or certify physical scanout. The persistent
presenter can explicitly enable native atlas output before loading; its mode ACK
is required, and a later canonical load disables that mode on the same engine.
`VisionSceneHandle.compositionFrame` exposes only a matching accepted receipt for
the current scene owner. `tests/unit/vision-composition-frame.test.ts` and
`tests/unit/vision-session.test.ts` cover these refusals and lifetime boundaries.
The native scene preparation path still uses the earlier owner-local projection;
adoption of the new receipt and coherent upstream assets remains in progress.

`vision-font-assets.ts` owns the existing host font catalog, shared acquisition
promise and legacy virtual font URLs used by `vision-presenter.ts`. Acquisition
failure clears that promise so the next attempt can retry. This extraction keeps
font ownership separate from scene receipts; it introduces no second font cache.

[`sound/`](sound/README.md) owns authored scene audio: hash-pinned packaged clips,
composed cues, routed DSP buses, live mix mutations, shared motion transport and
offline PCM. This experimental browser extension is enabled by `sceneAudio`;
it does not add a native Rust audio-device backend to Vision.

`animations.ts` owns catalogue validation, easing and the local playback clock.
Translation, rotation, opacity and blur patch private bindings in the active Vision
scene. Translation adds the sampled offset to the current authored/bound position;
source positions and the published LSML are preserved. Existing editable geometry
is projected before these animation bindings so its source authority remains aliased.
Scale retains the document-variant path and does not share the retained-position
guarantee. `scripts/sponsor-motion` exercises 35 tracks through actual native LSDP,
Solar and Vision; its capture asserts replay adds no scene-load request.

The experimental `waveAmplitude`, `wavePhase`, `waveWavelength` and `waveHarmonic`
channels patch exact `x-vision.wave*` image bindings. The pinned Vision candidate
renders two whole images on continuous textured meshes. This is a namespaced local
extension requiring that GPU candidate, not a standard LSML deformation or shader
API. Wave targets must be images and parameters are checked before playback.
One command transaction shares one start timestamp across all its targets.
The sponsor-wave capture records actual submitted-frame cadence separately from
the sampled canvas signatures; neither proves physical display scanout.

`native-lsdp-runtime.ts` connects to the real Lumencast Rust server through the
portable draft2 binary WebSocket client. A fragmented `state.read` loads the
full LSML resource, then a hash-pinned subscription delivers atomic tree or
application mutations. `scenes/native-document.ts` prepares temporary render
packages in memory and leaves source/Blue pins unchanged. Flat defaults use
Vision patches; structure edits use the same hidden-canvas frame swap. Its
snapshot, structural and command ACKs wait for Vision submission. Scalar state
notifications return `received` only after atomic LSML/integrity checks. Disconnect, stale state and failed
application recover through a fresh resource snapshot. The camera pool spans
document rebuilds. See `docs/development/native-lsdp.md` for local operation.
If preparation advances the resource between read and subscribe, BASE_MISMATCH
causes a fresh read/render/hash check, bounded to four attempts on that connection.
Other failures and repeated conflicts remain visible and reconnect normally.
The separate composition publisher also handles its own terminal socket close:
it is discarded without a remote clear, then the runtime's shared reconnect
backoff refreshes its token and republishes only the latest accepted plan or
clear. This retry leaves a healthy primary LSML connection in place; primary
recovery takes priority and runtime disconnect cancels pending composition work.
`NativeCompositionSession` stores accepted source state while the peer is absent
and replays that latest state when a replacement peer starts; it reports retry
success only after the replacement peer completes its first current publication.
When the trusted host config enables `nativeCompositionLSDP`, the runtime also
derives compositor metadata from that same active LSML document and publishes
it to the separate `solar/composition` resource. It does not mutate the source
LSML, insert plan fields into native snapshots, or wait for this side-channel
before returning the existing mutation or frame receipt. Main claims the
physical A/B producer nonce in that resource; Solar verifies the nonce before
each graph CAS and never changes the owner map. The publisher keeps one
read/write active and only the latest pending plan. Pending callers can receive
`superseded`; this is not an LSML ACK. `clear` is an ordinary latest-state
action and may be superseded by a newer plan. `retire` is terminal: it blocks
later side-channel work and clears after the active operation before closing
the peer. Publisher, session replay and reconnect paths have targeted Solar unit
coverage; real cross-process/Main/Pulsar composition remains a separate qualification.
`native-worker-client.ts` owns the dedicated `native-worker.ts` transport and
LSML verification thread. It certifies each state through its private Worker
channel; the render consumer reuses that exact structured-clone state instead of
repeating Merkle hashing on the drawing thread. Certification is scoped to the
callback context and removed after delivery, so network fields or caller-created
contexts cannot claim it. Direct reception without a Worker retains full hashing.
Every native callback waits for the ordered main consumer. Scalar `received`
returns after LSML verification and admission to `FramePatches`, before Vision
submission; structural, snapshot and command receipts retain their stronger
application/rendering boundary. The pinned browser adapter's existing 32-channel
window therefore bounds worker deliveries while main admission is pending. Both
sides abort on disconnect, including pending connection/request work. A snapshot
can bypass the main notification queue to complete same-connection resync.
Worker timing is best-effort: missing or throwing Performance APIs drop only the
sample and cannot block a transaction receipt. A failed transaction is returned
to the worker as an error before `onIncomingFailed` runs; if that lifecycle hook
throws and an `onClose` handler is registered, its exception is forwarded through
that lifecycle path. Exceptions from either observer are reported to the console
and cannot turn the original transaction failure into a successful receipt or
poison the ordered delivery queue.
`tests/unit/native-worker.test.ts` exercises the worker callback itself: scalar
receipts stay pending until main admission, and a refused admission propagates
its typed error. The transport is mocked; this does not measure native window
throughput or GPU presentation.
`internal/native-stream.ts` owns notification identity/order/integrity and scalar
classification. The worker uses a local SHA-256 implementation for native frame
checksums; the byte-pinned upstream client still compares every checksum. This
does not change the window's crypto implementation or any native protocol bytes.
`internal/native-state.ts` applies atomic operations by copying only their paths.
Unchanged immutable subtrees retain their draft2 Merkle digests; changes to existing
object keys update only the affected persistent map branches. Incoming values,
whole-resource node/depth budgets and notification before/after hashes remain
checked. `frame-patches.ts` merges scalar state through a microtask with
one GPU submission in flight. It retains every transaction identity and emits
`solar:lsdp-applied` only after the covering Vision frame is submitted, including
`presentation.throughSequence`, final hash and mutation count. Earlier
`solar:lsdp-received` proves LSML application, never displayed pixels. Structure,
camera/animation commands and coordinated transitions drain pending frames first.
Ordinary mutation reception, application and presentation are producer-independent:
Solar never queries `orion/state` or waits for Orion for these mutations. Events
carry native transaction/state identity, without an `x-orion` projection. Only
explicit scene-selection transition phases use `control-feedback.ts`; this is
not a mutation application or presentation dependency.
The physical resources `solar/lane-a` and `solar/lane-b` process these phases
using the validated `x-solar-transition.lane` role. Either engine can acknowledge
Preview or Program after Take; its physical name never fixes its logical role.
Legacy logical resources keep their explicit Program/Preview role. Missing roles
on physical transition metadata are rejected rather than silently ignored.
Reserved `__cam.*` leaves stay in native authority, outside Vision defaults;
positional camera names therefore cannot invalidate Vision's binding grammar.
Native document replacement pauses video uploads and drains GPU work while
the new package is loaded into the persistent Vision engine. The same
media controller and tracks then resume into the new layer. CEF validation
must assert static images, text and panels as well as the camera and mutation
receipt; camera-only output is a failed scene.

Collections retain their full resource hash while `selector` projects exactly
one generation/session into Vision. Updates to another entry are acknowledged
without changing the visible scene. Missing or deleted entries clear the
renderer. The old Orion LSDP/1 client has been removed from Solar.

During an admitted coordinated transition, a null coordinator mirror seed keeps
the committed presentation and its compensation frame until finalization. It
does not discard the accepted scene or its active source assets before the
finalize receipt. A null state after finalization still clears the renderer and
retires both frames; ordinary clears outside that transition remain authoritative.
Native runtime tests cover the null seed, cleanup without remount or refetch,
and an actual clear after finalization.

`vision-presenter.ts` owns one Vision engine, GPU canvas and presentation surface
per native host target. An empty engine starts once; fresh scene packages use
Vision's serialized `load` request on that same device/surface. The outgoing
scene's images, graph, geometry and composition caches are released.
The native connection starts that empty engine and admits installation fonts
before reading its first resource snapshot. Both physical hosts therefore warm
independently of scene selection. Empty prewarm creates no LSML package, scene
identity, media subscription or visible presentation; the first real load shares
its lifetime and queue. Host disconnection aborts prewarm and queued admission.
The engine-owned font registry survives scene replacement: installation fonts
are preloaded once at engine startup, and additional scene fonts are admitted
by content digest only when new. Scene-local layout and glyph caches remain fresh.
There is no inactive source or scene retention and A-B-A loads A freshly.
Runtime packages exclude the separately admitted flat font files. WebCrypto
identifies supplied font bytes; only acknowledged digests are reused in this
engine session. New fonts still pass Rust decoding and registration limits.
Package preparation and host font discovery run concurrently. A live-media clear
acknowledges without drawing when Rust reports that its active texture was already
transparent; clearing actual live pixels still submits a frame.
`native-scene-frames.ts` owns verified source acquisition and temporary packages.
Scene handles close their observers and pending work on retirement without
terminating the host engine. Stale handles cannot submit into a newer scene.
Clearing the active scene keeps the engine ready; host disconnect terminates it.
Each persistent mount captures the current host lifetime before it enters the
serialized scene-load queue. Terminal disconnect aborts that lifetime immediately,
including queued mounts and pending presenter/font/frame work; each settled wait
removes its abort listener. A later explicit mount starts a fresh lifetime, while
late work and callbacks from the retired lifetime cannot attach to or retire it.
Disposing a scene handle or switching scenes remains nonterminal and retains the
single host presenter.
If a replacement `load` fails, Solar reports the Vision error, clears the failed
engine scene, and leaves the layer's existing opacity unchanged. The retained
front canvas is not cleared by that engine request, so an active scene keeps its
last submitted frame visible; a first load or empty prewarm remains hidden because
its layer starts hidden. The rejected transaction still has no applied-presentation
receipt. A later valid snapshot reloads the same engine and the next valid mutation
can resume normal presentation.
Explicit WebGL context-loss recovery remains distinct from a scene switch.
Solar's host path uses Vision's desynchronized WebGL2 main-thread presenter; it
does not automatically switch to Vision's standalone WebGPU worker or its
separate software renderer. On a recoverable loss, Vision retains accepted scene
state, recreates the WebGL projection and re-registers its active images. Solar
keeps the last submitted front canvas until the restored frame is submitted. A
failed restoration is reported as a `context` presenter error and reaches the
host error callback when no request waiter owns it. The private
`qualify-instance-runtime.mjs --context-only true` mode exercises loss, restore
and same-scene pixels without preparing a second scene.
Absolute native assignments compare accepted
documents before rendering, so finalization does not mount the prepared scene again.
Preparation carries the current and candidate sources; compact commit/finalize
assignments carry the candidate at the resource root. A fresh renderer reconstructs
that stage from the root, while older payloads with an embedded source remain valid.
Bounded `solar:native-stage` measures separate worker verification/delivery,
main-consumer queue wait/depth/high-water, FramePatches pending count/high-water/oldest
age, classification, source/package/fonts, arena reuse, image resolution and feedback.
Their numeric durations and reuse categories contain no source values or tokens.
Scene assets remain in LSMLZ and Vision
loads them directly. There is no render-bundle URL, compile step, React render
tree or renderer selection flag.
`canvas-presentation.ts` retains a synchronized front canvas for CEF. Only actual
Vision `frame-submitted` messages copy the complete GPU surface; the engine's
desynchronized canvas remains hidden. Copy failure rejects the pending presentation
receipt. Camera frames use the same boundary, keeping partial GPU draws out of
the broadcast compositor.

`vision-frames.ts` owns the submission barrier and uses a MessageChannel task
instead of the host's 60 Hz RAF. Pending scalar values and the latest owned
bitmap per camera can share one actual frame; every caller waits for completion.
Camera-only work schedules the same immediate task as state; arrivals before
that task share a submission without a fixed timer delay. Superseded and consumed
bitmaps are released, and failure rejects all covered callers. The supported
`loadWasm` dependency captures the real engine in `vision-media-bridge.ts`,
allowing camera upload before the same patch submission. This scheduling
policy is not evidence that the engine achieves 120 completed
mutation frames/s; fixed-window CEF measurements establish that separately.
The retained Vision candidate, independent encoded-counter checks and fixed
measurement boundaries are documented in
[`render-cadence.md`](../../docs/development/render-cadence.md).

The temporary render package gives text-bound scene variables private string
aliases. Blue may return a numeric score while LSML uses it as text; the original
numeric value remains available to geometry and other bindings. Patch updates
refresh both uses without changing the authoritative native document, source
archive or Blue pins. Repeater row bindings retain their own context.

Image-bound URLs are resolved by Solar against the LSML `assets.allowedHosts`
policy without forwarding credentials. The bytes become hashed assets in the
temporary RAM archive, while the native document retains the original URL.
Independent image fetches and decodes run together. New images are admitted as
immutable content-addressed assets into the retained engine before one state/GPU
submission. Rust verifies hashes, encoded dimensions and resource budgets; rejected
assets/patches preserve the accepted scene. The archive and Blue source pins do not
change. The media controller and physical camera tracks remain acquired.

The bundled Vision engine must render canonical LSML frame `background` and
`backgrounds`, including nested panels and bound color changes. Rendering text,
images and cameras without those surfaces is an incomplete scene and does not
pass the CEF visual check.

`live-media.ts` maps Vision's LSML live-source descriptors to Solar-owned
capture streams or the receive-only peer viewer. Every camera frame is fitted
to its declared texture and sent to Vision as an `ImageBitmap`; disconnects
clear the texture. Local references are resolved through `sources/capture.ts`;
peer slots use `sources/peers.ts`. Neither source kind is gated on broadcast
mode.

Meet's `x-zab.meet-framing/1` LSML profile carries direct image framing
(`object_fit`, `contentBox`, `sourceCrop`, `sourceZoom`, `objectPosition` and
`clipEffects`). Vision projects fit and authored image bounds into the peer
descriptor. `live-media.ts` applies crop, fit, zoom and position in the source
bitmap, scaling the content box from authored dimensions to the bounded texture.
Hot framing changes request a freshly prepared bitmap while retaining the peer
subscription and active stream. Vision keeps `clipEffects` on the normalized
image node, where its image renderer clips the effect boundary. Prism's older
`metadata.figma.captureFraming` stays available as export compatibility data
and is not the runtime rendering authority.

Each media session owns one pending video-frame callback, or one animation-frame
fallback. Repeated readiness from `play()` and `loadeddata` reuses that watcher;
it cannot create another chain. A consumed callback clears its handle before
rescheduling. Missing peer streams stop the chain, and a returning stream resumes
it. Disposal cancels the remaining watcher and pending upload.
Decode errors clear readiness and pending dirtiness before clearing the texture,
so a fallback cannot upload stale pixels. Later `loadeddata` events can restart
the same session after recovery; readiness/error listeners remain active.
Each stream attachment or decode error advances a session revision. Bitmap
preparation checks that revision after its asynchronous work and before sending
the complete batch, so an obsolete image cannot restore a cleared texture after
the stream has already recovered. Rejected bitmaps are closed locally.
`live-media-metrics.ts` aggregates RVFC/RAF callback counts, presented-frame
deltas where a continuous metadata baseline exists, callback coalescing, bitmap
preparation outcomes and durations, and `updateMedia` acknowledgments. It emits
bounded `solar:live-media-stage` Performance entries at most once per second and
flushes the last partial sample on disposal after the rate limit permits it; the
history is capped at 64 entries.
The entry detail contains counts and durations only, never source paths. A null
presented-frame delta means at least one callback in that sample had no usable
baseline. `mediaUpdateAckMsTotal` measures Solar's `updateMedia` wait per request,
while presenter frame-submitted receipts and `renderSubmitCallMsTotal` are counted
once per queued presenter submission even when several requests are coalesced into
it. The latter uses the pinned presenter's elapsed `engine.render()` call timing
when supplied. These are submission/ack measurements, not GPU
completion. The browser presenter exposes no GPU completion fence or readback to
Solar, so `gpuCompletionAvailable` remains false and `gpuCompletionMs` remains
null. The diagnostic sample is local to the Solar page and adds no per-frame IPC.
The asynchronous `play()` completion and rejection also belong to that revision;
obsolete completion cannot restore readiness, and obsolete rejection cannot report
an error for a replacement stream. A new attachment clears readiness and dirtiness
until its own readiness signal arrives.
Texture size and fitting are presentation properties, not capture identity.
Changing them resizes/refits the current texture, invalidates obsolete pending
bitmaps and requests a fresh upload without stopping tracks or resolving the
device again. A source kind, device reference or peer slot change still replaces
the session and releases the old capture normally.
Frame callbacks schedule one coalesced upload microtask instead of waiting for a
second animation-frame boundary after a render completes. One upload remains in
flight; dirty state retains only the latest pending video content. Pause and
disposal invalidate the queued token, so an old callback cannot consume a resumed
pump. The fallback video watcher still uses animation frames when the browser
does not support video-frame callbacks.

The active scene record keeps the ZabCanvas Blue manifest pinned to the source
revision. This is the input needed by the synchronized local scene store; Blue
program invocation remains server-owned and its resulting scene changes travel
as LSDP mutations. The host can now compose the verified source cache provider;
application startup synchronization remains outside this renderer.

`mount.ts` is the sole public lifecycle boundary. `disconnect()` tears down the
socket, in-flight LSMLZ load, peer sessions, capture streams and Vision presenter.
`setToken()` rotates the native subscription credential and reopens from a fresh
hash-verified snapshot. Canvas credentials remain owned by SceneSourceProvider;
peer credentials are refreshed from reserved native leaves or the host channel.

Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` and
`npm run check:bundle` after changing these paths. Hardware cameras and the live
CEF compositor still need a host-level smoke test.

`animations.ts` projects compiled motion onto private retained bindings and preserves
source authority. [`motion`](motion/README.md) owns timeline compilation, curves and
the single playback clock. Nested sequences/parallel compositions, per-segment
curves, cubic paths and native command controls share this clock. Scale/skew/pivots
use the pinned Vision GPU affine extension; playback never reloads a scene.
The [motion contract and audit](../../docs/development/motion-system.md) records
supported effects, LSML compatibility, deterministic overlap and remaining gaps.

Persistent font admission accepts owned `VerifiedFont` snapshots as well as raw
font arrays. Only the owned snapshot may reuse its verified digest; mutable caller
arrays are copied and hashed. An already acknowledged digest causes no transfer
copy or WASM admission. Host manifest acquisition still occurs on each scene load
so changes to the registry remain observable.

During a persistent structural/effect load, the current front surface stays
visible and attached. Only a newly created session starts hidden. The replacement
is presented after its submitted frame; reusing the engine must not reapply the
initial opacity-zero staging rule to the active layer. This also avoids detaching
and reattaching its GPU/front canvases during ordinary document replacement.

The pinned Vision engine accepts live text style leaves and stroke.width/stroke.color. Glyph outlines are tessellated by Rust in positioned scene pixels; Solar transports these as ordinary LSDP mutations.

`scripts/qualify-meet-framing.mjs --out <directory> --playwright-root <existing-Prism-checkout>`
is a retained development qualification for the committed Vision package. It owns
a private ephemeral loopback server and Chrome instance, closes both, and drives
the real `LiveMediaController` with a synthetic canvas `MediaStream`. The browser
fixture in `tests/browser/meet-framing.html` checks literal pixel expectations for
contain, fill and horizontal/vertical crop mutations in one Vision engine. This
qualifies bitmap fitting and descriptor hot patches; it does not exercise LSDP,
Meet signaling, physical capture, CEF, 1080p60 or switch timing. The caller owns
the explicit output directory; no shared development session is attached.

## Vision contracts

`vision-contracts.ts` owns the host/presenter message, live-media descriptor,
render-package and scene-handle TypeScript contracts. `vision-presenter.ts`
re-exports their existing names for its consumers and continues to own the
persistent host, load, patch, frame and teardown implementations. Verified active
instance packages travel in the existing load message; dependency fetching remains
with `scenes/instances.ts`, and instance state/rendering remains with Vision.
