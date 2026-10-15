# Scene source and Blue manifest

The native projection supports historical attestation fixtures with an empty root
`stack` and omitted direction: only that empty root receives `vertical`. The
source bytes and validation pins stay intact. Non-empty stacks and explicit
invalid directions retain Vision's strict validation.

`canvas.ts` is Solar's online `SceneSourceProvider`. It looks up a scene by
identifier in ZabCanvas, obtains the published source descriptor, then downloads
the exact LSMLZ archive (or LSML plus individually hashed assets) pinned by the
snapshot's `scene_version`. Solar rejects a descriptor or response that changes
scene identity, revision, version, digest, origin, or size limits. It never
falls back to a different version or to a compiled bundle.

`instances.ts` walks semantic layout children and repeat templates to acquire
the exact pinned sources of active LSML instances through that same provider,
requesting plain LSML so Canvas can use its existing separately fetched, exact
revision asset files. The local source provider re-expresses the already verified
LSMLZ capsule as the same LSML bytes plus its original asset paths and bytes;
root scene requests remain LSMLZ. One acquisition deduplicates repeated
references, retains distinct child versions, and rejects cycles, depth beyond
eight, more than 256 sources, 128 MiB expanded dependencies or 100,000 traversed
layout nodes. Shared dependencies still count toward each path's depth. Metadata
and parameter objects are not scene children. The graph has no global or inactive
lifetime. Missing exact sources fail with `BUNDLE_FETCH_FAILED` before Vision load;
cancellation preserves the owner's reason. `cache.ts` supplies the existing
content/manifest verifier: online instance admission does not require offline
Blue readiness, while cache reads/writes keep that stricter default. It admits
safe `assets/...` paths permitted by Vision, verifies top-level 40-hex SHA-1 and
64-hex SHA-256 addresses, and retains transport digests for separately cached
named assets. Duplicate archive entries, unsafe paths and over-budget packages
fail before Vision load. The verified documents and expanded byte counts are
reused for traversal instead of parsing an archive again for each occurrence.
`native-scene-frames.ts` forwards the exact child LSML bytes and explicit asset
paths/bytes to Vision's instance-aware load message. `scripts/qualify-instance-runtime.mjs`
drives that real path in a private Chrome/Vite page: LSMLZ root, plain LSML child,
a legacy SHA-1-addressed WOFF2 font, a named nested PNG, asymmetric pixels for all
four fit modes, a live `bindParams` update, WebGL context loss/restoration, and
missing-child and wrong-hash failures that leave the accepted frame intact. Its
result and pixel capture are recorded under the current qualification evidence
directory; the injected child fixture proves Vision admission and failure
preservation, not named/SHA-1 delivery from Canvas. Provider tests separately
exercise Canvas's pinned HTTP source/asset requests and its origin, redirect,
size, abort, exact revision and digest checks. ZabCanvas's current HTTP descriptor
lists only `assets/<64 lowercase hex>.<ext>` files; Solar verifies each file
against that SHA-256 path and the response's `X-Scene-Version`,
`X-Scene-Revision` and body ETag. The producer's source-delivery contract also
explicitly refuses legacy SHA-1 local asset paths. Named and SHA-1 assets are
supported when already present in a verified exact LSMLZ local capsule and
converted locally, but are unavailable through the current Canvas separated-file
HTTP contract. Solar does not invent a digest for named URLs or retry a failed
LSML request as LSMLZ. The package path
does not rewrite `http(s)` image URLs embedded in child LSML or route them through
the active scene image provider; those URLs remain outside child package parity.
Capture composition, editor asset resolution, shared runtime admission and public
output are also outside this qualification.

Each delivery carries the ZabCanvas Blue manifest for that same validated
revision. `blue_manifest` includes the scene's declared Blue bindings and
blueprints, validation record, binding closure, offline-readiness result and a
canonical manifest digest. The runtime checks its scene id, revision and version
against the downloaded LSMLZ before retaining it with the active Vision scene.
That keeps the dependency declaration beside the scene bytes for later local
storage and Blue resolution; it does not make Solar an executor of Blue.

`types.ts` is the renderer-independent boundary for an online provider or a
synchronized local provider. `SceneSourceDelivery.assets` carries
verified standalone assets for plain LSML; LSMLZ embeds its own assets for
Vision. `cache.ts` supplies an exact-revision cached provider and capsule codec.
`SceneSourceStore` is application-owned; the server entry supplies atomic Node
`FileSceneSourceStore`. Reads verify source/content address/assets/Blue closure;
incomplete offline metadata, live variants and corrupt bytes fail visibly.
Unpinned discovery remains online. `browser-store.ts` implements atomic IndexedDB
storage shared by both physical lanes, partitioned by API/embedding credential
digest, with 64 entries/512 MiB and eviction. This optional IndexedDB adapter is
not used by Prism. `startup.ts` walks every accessible paginated Canvas scene,
without a default scene-count ceiling. `src/server/scene-library.ts` owns the
account-partitioned launcher disk library, descriptor revalidation and revision pruning.
The served host uses `local-library.ts` when Main supplies `sceneSourcesUrl`,
otherwise direct Canvas acquisition. Local reads carry an exact source version and
revalidate source/assets/manifest. Editable scene state remains on native LSDP;
unpublished standard scenes are counted separately. No inactive graph is retained.
See `docs/development/source-cache.md` and the cache/store test suites.

Tests in `tests/unit/scene-source.test.ts` cover descriptor acquisition,
LSML/LSMLZ delivery, authenticated exact child acquisition with separately fetched
assets, version pinning, response revision/ETag headers, content hashes, manifest
digest and mismatch rejection, untrusted destinations, request errors and
response-size limits. Cache and
instance-source suites cover named and SHA-1 packages, wrong hashes, duplicate and
traversal entries, aborts, graph budgets and failure before renderer admission.

The trusted Prism host can opt into `local-authoring.ts` reads `x-solar-authoring` from the active, verified LSDP
resource. The `solar.authoring/1` delivery contains an immutable `lsml_bundle`
base, content-addressed non-font asset bytes and font digest references. Font
bytes stay in the installation/host bank and are not resent with the scene. Solar
verifies the base identity/address and asset hashes, with a 16 MiB admission
budget. No Orion HTTP source request is made. Only absence of the native
extension permits published ZabCanvas acquisition; malformed native delivery
fails visibly. A required font must already be acknowledged in Vision's bank
before loading; a missing digest fails visibly. Mutable defaults remain at the resource root and reach Vision
through LSDP mutations. The authoring extension is excluded from Vision's render
package and never enters the published source cache.

`editable-bindings.ts` projects legacy editor translate/size wrappers into Vision
scalar `position.x/y` and `size.w/h` bindings on that private clone. Position
arrays project to two private scalar aliases; move, resize, text and shape style
patches use Vision's retained arena and the live delta path. Published source bytes
and their content address remain immutable. Font bytes come from scene assets,
licensed host faces, and the trusted authenticated loopback Prism font registry.
Host font acquisition verifies hashes, caches verified bytes, and completes
before scene admission. Mutations reuse the admitted font set.

The trusted `nativeComposition` option projects a private pixel atlas matching
Prism capture bands. Local capture nodes become empty frames because Pulsar owns
their pixels; Meet peer nodes retain their Solar rendering. Root background paint
appears only in the first band. The presentation surface has fixed pixel
dimensions, independent of a stale warm CEF viewport, and native scene items
compose each band with the captures in authored paint order.

Capture-only trailing bands stay transparent in the browser without allocating
Vision GPU/front-canvas pixels for them. Inner empty bands retain their offsets
so capture/overlay paint order remains exact. The atlas contract test covers both.

The composition projection returns its surface dimensions explicitly: one band
uses the native viewport; multiple bands use viewport height times band count.
Authored root size is optional and never determines that presentation surface.
If that root size is absent, the private render projection supplies the viewport
size required by Vision; explicitly authored sizes and saved sources stay intact.
Scene packaging tests cover absent root size, smaller authored roots, and
capture-only scenes without modifying the source document.

`native-document.ts` owns private render aliases and allowed-host image acquisition.
Solar retains source/assets only for the active scene and its continuous mutations.
A scene change acquires the incoming source anew; returning A → B → A fetches A
again and mounts a fresh Vision frame. Inactive frames are disposed, never cached.
Independent image requests for the active scene deduplicate by URL and run concurrently.
URL lookup is a 128-entry LRU; decoded response bytes are deduplicated by content
address and held in a separate 128-image/64 MiB LRU. One image is capped at 8 MiB,
and at most eight distinct URL requests fetch concurrently. URL retention and the
request queue each cap at 128; at full concurrency, up to 120 distinct URLs can wait
in the bounded FIFO, so a batch of small images is not rejected just because it
contains more than eight leaves. Response chunks reserve their actual byte
length as they arrive; cached images plus in-flight body bytes stay within 64 MiB.
When that combined budget is full and every cached image is pinned, the affected
acquisition fails explicitly rather than waiting on the frame submission that depends
on it. Staged patch bytes remain pinned until Vision's frame queue accepts or rejects
them. Eviction removes only Solar's dynamic copy: source-package bytes remain immutable,
and Vision owns the bytes admitted by its accepted graph. Image changes resolve only
affected leaves, leaving the source document untouched.

`local-images.ts` adapts Prism's existing authenticated loopback render-asset cache
to the optional `SceneImageAssetsProvider`. Only the configured gateway's hashed
Canvas assets and the existing Data Dragon image paths use that route; other URLs
retain direct acquisition. LSML's allowed-host policy applies before either path.
Host bytes are trusted cache deliveries, then checked for MIME, size and content
address before Vision admission. The adapter streams at most 8 MiB, forwards
cancellation and sends the local credential only to the validated loopback route.
`host-entry.ts` consumes the host's existing injected endpoint; native images no
longer depend on the legacy DOM image interception. Local-images/native-document
tests cover that boundary and preserve the original source URL and Blue pins.

`installation-fonts.ts` streams verified catalogue bytes in batches of at most
32 files/64 MiB to the persistent Vision engine. Transport batches are released
after admission. Native authoring assets are admitted from each fresh LSDP scene state;
the persistent engine font bank deduplicates registered faces.
A scene does not gain a cached lifecycle through this font-only reuse.

Persistent native rendering separates safe, flat font assets from the temporary
LSMLZ package. Their SHA-1/SHA-256 path addresses remain checked before transfer;
the original delivery and default packaging still contain the fonts. The host
admits only new font digests to the engine, awaiting Rust acknowledgement before
loading the fresh package. Native authoring assets are hash-checked before transfer. Continuous editing
uses the existing native mutation path; it does not reacquire an HTTP envelope.

`canonical-render.ts` uses the normative canonicalizer once for the zero-version LSML,
hashes those bytes and stamps only the root version slot. Its byte-for-byte tests
compare the package with `@lumencast/canonical`, including nested version keys and
escaped/Unicode values. No second serializer or scene retention is introduced.

`verified-font.ts` owns private immutable font snapshots and their checked digest.
The host font registry retains these font-only references; the persistent presenter
checks its Rust-acknowledged digest bank before copying bytes for a new admission.
External raw font arrays still enter through a defensive copy and hash. Returned
transfer copies cannot change the snapshot or invalidate its digest. Scene font
path addresses are checked before separation, including SHA-1 legacy paths.

The native persistent path transfers the canonical LSML bytes plus explicit assets
directly to Vision. It does not build a temporary ZIP. `renderPackage` keeps LSMLZ
as its default for import/export and other existing consumers; the native frame
owner explicitly selects direct parts. Rust validates the same path classes,
content addresses, required references and budgets before replacing the scene.
HTTP images still resolve through the active image bindings and LSDP patches.

Within the active `NativeSceneAssets`, owned font snapshots also survive structural
rebuilds. Plain delivery arrays are copied on acquisition, so subsequent caller
mutation cannot invalidate that verification. This active owner is released on
scene change; no scene instance or inactive asset owner is retained.

Mixed native compositions isolate root images above captures into their own
stable bands, even in normal blend mode. Other root objects with non-normal
blend are isolated too. Vision renders those nodes with normal blend and their
original opacity, geometry and effects; the source LSML remains intact. Pulsar
owns the final W3C blend against native captures and previous Solar bands.
Pure Solar scenes retain Vision's existing blend implementation. The isolated
source must never contain adjacent ordinary objects or a second application of
the same blend. `tests/unit/editable-bindings.test.ts` checks this projection.
