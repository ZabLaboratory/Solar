# LSDP and Vision runtime

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
LSML verification thread. Simple state reception continues while CEF draws;
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
Reserved `__cam.*` leaves stay in native authority, outside Vision defaults;
positional camera names therefore cannot invalidate Vision's binding grammar.
Native document replacement pauses video uploads and drains GPU work while
the next Vision layer is staged and the previous engine released. The same
media controller and tracks then resume into the new layer. CEF validation
must assert static images, text and panels as well as the camera and mutation
receipt; camera-only output is a failed scene.

Collections retain their full resource hash while `selector` projects exactly
one generation/session into Vision. Updates to another entry are acknowledged
without changing the visible scene. Missing or deleted entries clear the
renderer. The old Orion LSDP/1 client has been removed from Solar.

`vision-presenter.ts` owns one hidden Vision canvas until its initial snapshot
has been applied and a frame submitted. It then swaps the canvas into view and
disposes the previous Vision scene. Scene assets remain in LSMLZ and Vision
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
An image already packaged can be selected by a normal patch. A new image stages
an archive containing its bytes and swaps the presenter after its first frame;
the media controller and physical camera tracks remain acquired.

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

`animations.ts` consumes Orion's `__animation.<asset>` command leaves and the
LSML animation catalogue `{id:{target,keyframes:{duration_ms,easing,steps}}}`.
Opacity, rotation and blur use private Vision bindings; translation/scale use
the existing scene swap from original geometry. The source stays untouched.
Named CSS easing and cubic-bezier are sampled from the authored curve. Unsupported
channels/easing fail explicitly before rendering. Only one animation submission
is in flight, repeated commands are deduplicated, and a new command replays.
Final frames survive an unrelated structural mutation, but clear on scene change
or removal. Geometry swaps are more expensive than scalar GPU patches.
