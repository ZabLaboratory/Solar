# Scene source and Blue manifest

`canvas.ts` is Solar's online `SceneSourceProvider`. It looks up a scene by
identifier in ZabCanvas, obtains the published source descriptor, then downloads
the exact LSMLZ archive (or LSML plus individually hashed assets) pinned by the
snapshot's `scene_version`. Solar rejects a descriptor or response that changes
scene identity, revision, version, digest, origin, or size limits. It never
falls back to a different version or to a compiled bundle.

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
LSML/LSMLZ delivery, authentication forwarding, version pinning, content hashes,
manifest digest and mismatch rejection, untrusted destinations, request errors
and response-size limits.

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

`native-document.ts` owns private render aliases and allowed-host image acquisition.
Solar retains source/assets only for the active scene and its continuous mutations.
A scene change acquires the incoming source anew; returning A → B → A fetches A
again and mounts a fresh Vision frame. Inactive frames are disposed, never cached.
Independent image requests for the active scene deduplicate by URL and run concurrently.
Image changes resolve only affected leaves, leaving the source document untouched.

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
