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
digest, with 64 entries/512 MiB and eviction. `startup.ts` warms at most 64 scenes
from Canvas' bounded paginated catalog and keeps pinned reads available offline.
The served host wires that path when it has a Canvas credential and IndexedDB.
Partial/unpublished entries do not block a verified online scene. Prism startup
is unchanged in this scope.
See `docs/development/source-cache.md` and the cache/store test suites.

Tests in `tests/unit/scene-source.test.ts` cover descriptor acquisition,
LSML/LSMLZ delivery, authentication forwarding, version pinning, content hashes,
manifest digest and mismatch rejection, untrusted destinations, request errors
and response-size limits.

The trusted Prism host can opt into `local-authoring.ts` for Preview and editable
generations. It reads only a loopback endpoint, verifies the original LSML content
address and each embedded asset hash, and produces an ephemeral revision-zero
`LocalSceneSourceDelivery`. It has no Blue manifest or offline/publication claim,
and never enters the published cache. Only HTTP 404 permits a published-source
lookup; authentication, integrity and transport failures remain visible. Native
RAM defaults are applied to a newly addressed Vision package, preserving the base.

`editable-bindings.ts` projects legacy editor translate/size wrappers into Vision
geometry on that private clone. Geometry patches rebuild the package; scalar
text and shape style bindings keep the live delta path. Published source bytes
and their content address remain immutable. Font bytes come from the archive.
