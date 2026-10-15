# Contract audit — instance asset parity

## Authority pins inspected read-only

- Vision 3D integration checkout: D:\Documents\Lumencast\lumencast-vision\.worktrees\eleven-local-20261015-vision3d-integration at 61fcc7c62eed42667278cdb8474b47c34851744f.
- ZabCanvas source delivery checkout: D:\Documents\Zab\ZabCanvas\.worktrees\forge-local-20261003-source-delivery at 54b778370c95926c86e1f51cab4c032acf457f5c.
- Prism Main proxy checkout: D:\Documents\Zab\Prism\.worktrees\eleven-local-20261015-project-integration at 9051f4b05076bd04e9c5014f2d54966991396798. The Solar project-integration checkpoint at f8e18ba is separate and was not used as this worktree base.
- No external checkout was changed. The dirty/untracked state observed in the external checkouts was preserved.

## Supported package and provider paths

Vision package admission in crates/vision-assets/src/lib.rs classifies ZIP entries before extraction, rejects duplicate names including case-fold collisions, enforces limits, validates safe assets/ references, and checks recognized content-addresses. A flat assets/<40 lowercase hex>.<ext> path is SHA-1 checked; a flat assets/<64 lowercase hex>.<ext> path is SHA-256 checked. Other safe named asset paths are allowed within the package when referenced and present. Vision host package_input.rs repeats reference safety checks. This is the contract Solar follows for exact locally cached LSMLZ packages.

Solar local-library behavior preserves the current root/default LSMLZ provider request and response. An explicit exact-child LSML request can be fulfilled from the already verified, pinned LSMLZ cache by projecting the original LSML bytes and files as an LSML source; the source identity and exact scene id/version remain pinned. On cache miss, the existing provider receives the exact LSML format, scene id, version, and abort signal. Cache transport digests protect cached standalone bytes from corruption but do not create or replace scene identity. Archive parsing is bounded before expansion, duplicate entries are rejected before unzipSync can overwrite, and unsafe paths, absent references, integrity mismatches, budget excess, and aborts fail closed. Failed child acquisition leaves the previously accepted scene output intact.

## Current HTTP contract and unsupported boundary

ZabCanvas's source-delivery document defines /source descriptors plus LSML and LSMLZ. The descriptor emitter maps only source-local assets/ references to version-pinned asset URLs. The current producer path uses assets/<sha256>.<ext>; historical SHA-1 is explicitly refused by scene_source_assets.py because the Canvas blob store has SHA-256 keys and renaming would alter identity. It has no mapping or digest authority for arbitrary named or SHA-1 file URLs. Solar therefore keeps descriptor HTTP assets limited to the exact SHA-256-addressed form; missing, wrong-version, wrong-revision, wrong-ETag, and body-digest mismatches are integrity failures. The child request remains format lsml and does not retry LSMLZ after integrity, budget, or abort failures.

ZabCanvas's existing response contract supplies Cache-Control: private, no-store, X-Scene-Version, X-Scene-Revision, and a quoted ETag computed from the actual response bytes. Solar checks the separate asset response's exact requested scene version and descriptor revision and verifies the ETag digest against the body, as well as the body against its SHA-256 path. Tests cover the exact revision, absent and mismatched headers, ETag/body disagreement, wrong content, cancellation, and resource limits. A future Canvas change that supports named or SHA-1 HTTP assets must define how those assets are enumerated and integrity-bound before Solar can admit them.

HTTP(S) image URLs embedded directly inside the child LSML are a separate unresolved boundary. This work does not rewrite the document, convert those URLs into package references, or establish another state authority. The present parity claim covers safe package-local named/SHA-1 assets from exact LSMLZ cache conversion and separately delivered HTTP assets only when the existing Canvas descriptor uses SHA-256 paths.

## Existing Main proxy compatibility

Prism Main's local Canvas proxy relays upstream response headers including ETag, X-Scene-Version, and X-Scene-Revision and streams bytes; its proxy tests assert source-identity header forwarding. The source delivery integration uses this proxy path. No header rewrite or new proxy was added, and no Prism change is required for the stricter client verification.

## Evidence sources

- ZabCanvas docs/development/source-delivery.md lines 19-21, 52-59.
- ZabCanvas src/zabcanvas/services/scene_source_assets.py lines 23-25, 81-96, 116-119; routes/scene_sources.py lines 93-105, 147-170, 174-192; tests/test_scene_source_delivery.py.
- Vision crates/vision-assets/src/lib.rs lines 417-421, 552-578, 677-728; crates/vision-host/src/package_input.rs lines 140-143, 168-197.
- Prism src/main/scenes/server/proxy.ts lines 115-137 and src/main/scenes/_test/scene-server.proxy.test.ts around the source identity header forwarding case.
