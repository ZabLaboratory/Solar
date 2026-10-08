# Receive-only dependency compatibility

Owner: Solar installation adapter. Entry: `../patch-peer-viewer.mjs` via package postinstall.
The package ships this folder, so hoisted dependencies work in an installed application.
Only the three consumed `@lumencast/runtime/dist/webrtc/` files are written. Source,
compiled scene bundles, React primitives and protocol image limits are outside this adapter.

- `registry.mjs`: stream re-emission and peer-generation ownership.
- `viewer.mjs`: identity/roster, stale generations, retry offers/glare and serialized signaling.
- `roster.mjs`: the viewer's authoritative room roster across signaling races.
- `rooms.mjs`: room/credential handoff while retaining the old video until the replacement owns it.

Ordered patches assert the supported upstream text contract and remain idempotent. They
preserve the viewer's useful behavior; they do not launch a publisher or add a renderer.
On an upstream version change, compare pristine and patched files, rerun the viewer tests
and installed-package checks, then retire patches that the upstream has absorbed.

Checks: meet-viewer-identity-race, publisher-offer-policy, injection, slot-binding and
Antenne suites. The audit compares fresh tarballs with lockfile SHA-512 verification,
requires exactly those three changed files, verifies byte equivalence to the qualified
viewer, and runs the installer twice. See the repository audit report for those hashes.
