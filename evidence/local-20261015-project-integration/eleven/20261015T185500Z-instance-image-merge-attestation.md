# Instance HTTP image admission

Owner: Eleven / Main1, thread `01a11a8b-8f4f-7fc2-abc4-7983042e4f63`.
Target: `eleven/local-20261015-project-integration`, base285b42d.
Reviewed signed source: `18ec2a2c526873015f11b88659e755a34de0df5d`, including dd487f1.

The runtime-only child image adaptation reuses NativeSceneAssets policy, bounded
fetch/cache and leases. Original source bytes, revision and delivery pins remain
immutable. Child-authored images use their child's host policy; parent-provided
image values use the parent policy. Existing bindParams mutation resolution is
reused; there is no second cache or transport.

Root reviewed the source preparation and lifetime code. That review found a
late sibling lease on rejected parallel child preparation. A deterministic red
test reproduced it; wait-all settlement now precedes cleanup and the test proves
exactly-once release. Root also checked the final PNG and report JSON: final run
Chrome155.0.8059.41, static orange image, bound image blue after a 404/retry;
source bytes unchanged; WebGL loss/restore accepted. Earlier Chrome154 evidence
is explicitly the pre-race-fix run. Original and final proof hashes are distinct.

Worker checks:82 targeted tests, TypeScript/lint/architecture/source usage/docs/
file-size/build/Vision pins/script syntax/diff and workspace guard pass. The
generator now supports an explicit canonical file prefix; moving proof files did
not modify their contents or invent another browser run.

Limits: synthetic loopback image/source fixtures, actual Solar presenter and
pinned Vision WASM/WebGL. No ZabCanvas production service, installed Prism,
physical capture, common runtime admission, public output or memory profile.
No transitions, readiness policy or switch-duration changes are included.

This is a local integration merge. Repeat affected source/image/recovery tests,
typecheck and bundle checks on the combined candidate. Do not publish or replace
the common runtime based solely on this fixture proof.
