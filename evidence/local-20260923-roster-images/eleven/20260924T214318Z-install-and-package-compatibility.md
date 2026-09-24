# Solar install and Lumencast package compatibility — 2026-09-24

This supersedes the **release-gate status**, not the CEF observations, in
`20260924T192219Z-cef-remote-and-release-gate.md` and
`20260924T204415Z-solar-slot-dedupe.md`. Those reports correctly describe the
earlier failing candidate and remain as historical evidence.

## Exact candidates

- Lumencast integration commit: `977aaeb5d918c5d6b05b5a5368451533b7b36493`.
- Built and packed `@lumencast/runtime@0.18.2` from that commit; tarball SHA-256:
  `e838f984a3d532e88f60dcb77c0079d8a326b986aa141529b067b88176504b99`.
  The tarball contains `dist/lumencast.js`, `dist/index.js`, `dist/mount.js`,
  `dist/webrtc/index.js`, and `dist/render/roster-image-preload.js`. The version
  number is unchanged for **local compatibility testing**; this is not an npm
  release and cannot be selected by a clean Solar install from the registry.
- Solar's Vite library/host builds resolve `@lumencast/runtime` to the packaged
  readable `dist/index.js`; Vitest resolves to its `src/index.ts`. Solar's
  postinstall patches the readable modules used by those paths. This avoids
  depending on minified symbol names, which changed in the candidate bundle.
  The existing minified patch compatibility code remains, but its log lines
  must not be interpreted as proof that a particular minified chunk changed.

## Validation

| Environment | Commands / observation | Result |
| --- | --- | --- |
| Published registry package, lockfile dependencies | `npm ci --offline` with postinstall | Passed; `@lumencast/runtime@0.18.2` and protocol 0.18.2 installed, zero npm audit vulnerabilities. |
| Published package | `npm test`; `npm run build`; `npm run check:bundle`; `SOLAR_E2E_BROWSER=system-chrome npm run test:e2e` | 194/194 unit tests, build, bundle checks, and 3/3 served-host browser tests passed. Host JS: 456,498 B raw / 150,377 B gz. |
| Exact local Lumencast tarball, locked Solar dependencies | `npm install --no-save --ignore-scripts --offline <tarball>`, postinstall script, `npm test`, typecheck, lint, build, bundle checks, served-host E2E | 194/194 unit tests, typecheck, lint, build, bundle checks, and 3/3 browser tests passed. Host JS: 496,260 B raw / 162,584 B gz. |
| WebRTC readable modules | `tests/unit/meet-viewer-identity-race.test.ts` within Solar's suite | 7/7 passed with the exact tarball after postinstall. |
| Lumencast integration | full workspace build and tests; runtime browser E2E | 998 runtime tests passed (2 skipped), 345 compiler tests passed (5 skipped), 18/18 browser E2E passed. Format, lint, typecheck, bundle budget and no-fetch guard passed. |

The first candidate-only full Solar run hit a pre-existing timing weakness in
`atlas-mount-e2e.test.tsx`: it waited for any host `div`, not the fetched scene.
The test now waits for an authored 400 px box; its focused and full reruns pass.
An experimental `npm install --package-lock=false` also upgraded 129 unrelated
dependencies and made the wipe animation test fail. Restoring `npm ci` lockfile
versions resolved that failure; all candidate numbers above use the locked set.

## Boundaries

- `preloadRosterImages` stays off by default. The published 0.18.2 package
  does not contain it; clean Solar CI can verify compatibility but cannot
  exercise the opt-in preload until a **separate Lumencast npm release** and
  dependency update. No package publication or Solar release is claimed here.
- The prior Pulsar CEF Blue probe established identical pixels and moved three
  image fetch/decode operations before a roster-led switch. Its physical
  generation-wire timing ranges overlapped; it did **not** prove a reliable
  prepare-to-Take latency gain. No new full Prism/Orion physical Take or live
  Program proof was performed in this compatibility pass.
- The runtime browser zero-loss fixture uses swatch assets; its 0.3471
  full-reference SSIM is a scaffold metric, **not** a 100% Figma reconstruction
  proof or a template-stats pixel regression comparison.
