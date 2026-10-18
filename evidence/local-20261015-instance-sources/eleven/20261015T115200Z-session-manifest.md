# Active instance source acquisition

Owner: Eleven. Unit local-20261015-instance-sources, Solar branch
eleven/local-20261015-instance-sources, base 4926afc5793f36c5c71689b0ed0f9a8c0155015e.
Mandate: remaining project corrections excluding transition and switch duration.

Reuse the existing SceneSourceProvider exact-version source API and source verifier
to acquire the dependency graph of an active LSML scene. No compiler, rendered
scene cache, alternate fetch API, Blue execution or inactive graph retention.
Bound depth, total sources/bytes and traversal; preserve cancellation, exact source
identity and typed failure. Deliver the verified packages through the existing
Vision load message using the matching engine API under implementation.

Code context: scenes README/canvas.ts/types.ts/cache.ts/native-document.ts and
engine/native-scene-frames.ts/vision-presenter.ts. Existing source verifier owns
canonical addressing and cache validation; online dependency admission must not
mistake offline Blue readiness for an immutable-source integrity requirement.
Adapt that verifier with defaults preserving current cache callers rather than
create another hashing/ZIP validator. Engine owns instance-local rendering and
parameter semantics; Solar owns acquisition and active dependency lifetime.

Allowed local code/tests/docs/signed commits; no runtime shared publication,
remote changes, app restart or transition work. Actual child remote images,
native capture composition, editor preview and full engine pixel proofs remain
explicit qualification requirements. Preserve source worktrees and frozen package.
