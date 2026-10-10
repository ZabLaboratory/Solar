# LSDP and Vision runtime

`animations.ts` owns catalogue validation, easing and the local playback clock.
Translation, rotation, opacity and blur patch private bindings in the active Vision
scene. Translation adds the sampled offset to the current authored/bound position;
source positions and the published LSML are preserved. Existing editable geometry
is projected before these animation bindings so its source authority remains aliased.
Scale retains the document-variant path and does not share the retained-position
guarantee. `scripts/sponsor-motion` exercises 35 tracks through actual native LSDP,
Solar and Vision; its capture asserts replay adds no scene-load request.

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
`native-worker-client.ts` owns the dedicated `native-worker.ts` transport and
LSML verification thread. It certifies each state through its private Worker
channel; the render consumer reuses that exact structured-clone state instead of
repeating Merkle hashing on the drawing thread. Certification is scoped to the
callback context and removed after delivery, so network fields or caller-created
contexts cannot claim it. Direct reception without a Worker retains full hashing.
Simple state reception continues while CEF draws;
snapshot, structure and command receipts still await the main consumer. Both
sides abort on disconnect, including pending connection/request work. A snapshot
can bypass the main notification queue to complete same-connection resync.
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

`vision-presenter.ts` owns one Vision engine, GPU canvas and presentation surface
per native host target. An empty engine starts once; fresh scene packages use
Vision's serialized `load` request on that same device/surface. The outgoing
scene's images, graph, geometry and composition caches are released.
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
Explicit WebGL context-loss recovery remains distinct from a scene switch.
Absolute native assignments compare accepted
documents before rendering, so finalization does not mount the prepared scene again.
Preparation carries the current and candidate sources; compact commit/finalize
assignments carry the candidate at the resource root. A fresh renderer reconstructs
that stage from the root, while older payloads with an embedded source remain valid.
Bounded `solar:native-stage` measures separate worker verification/delivery,
classification, source/package/fonts, arena reuse, image resolution and feedback.
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
Camera-only work waits at most one 120 Hz interval for state to join it; a patch
or explicit lifecycle barrier bypasses that grace. Superseded and consumed
bitmaps are released, and failure rejects all covered callers. The supported
`loadWasm` dependency captures the real engine in `vision-media-bridge.ts`,
allowing camera upload before the same patch submission. This scheduling
interval is a policy, not evidence that the engine achieves 120 completed
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

`animations.ts` consumes native LSDP `__animation.<asset>` command leaves and the
LSML animation catalogue `{id:{target,keyframes:{duration_ms,easing,steps}}}`.
Opacity, rotation and blur use private Vision bindings; translation/scale use
the existing scene swap from original geometry. The source stays untouched.
Named CSS easing and cubic-bezier are sampled from the authored curve. Unsupported
channels/easing fail explicitly before rendering. Only one animation submission
is in flight, repeated commands are deduplicated, and a new command replays.
Final frames survive an unrelated structural mutation, but clear on scene change
or removal. Geometry swaps are more expensive than scalar GPU patches.

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
