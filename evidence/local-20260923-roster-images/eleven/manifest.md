# Solar / Lumencast roster-image integration — local proof (2026-09-23)

> Status update 2026-09-24 21:43 UTC: the clean-install and exact-package
> compatibility gates below have since been repaired and rerun. See
> `20260924T214318Z-install-and-package-compatibility.md` for current test
> results and the remaining npm-release / physical-Take boundaries.
>
> Correction du 2026-09-24 : the 192/192 Solar result below used an already-patched
> dependency copy, not the exact release candidate package. Rebuilding with the
> candidate Lumencast `dist` overlaid exposed 7 failing WebRTC tests (185/192).
> Clean `npm ci` also fails on the existing postinstall patch. The candidate
> must not be released on the basis of this earlier green suite. See
> `20260924T192219Z-cef-remote-and-release-gate.md` for the exact CEF HTTPS
> proof and corrected release decision.

## Candidate and scope

- Lumencast worktree: `D:/Documents/Lumencast/.worktrees/lumencast-runtime-static-mount-20260923`.
- Solar worktree: `D:/Documents/Zab/Solar/.worktrees/eleven-local-20260923-roster-images`.
- Solar forwards Lumencast's generic `preloadRosterImages` option only when a
  served Program URL explicitly carries `?preload_roster_images=1`. Unflagged
  Program, editable Preview and control hosts omit the key. No Prism URL was
  changed and nothing was enabled on air.
- The two repositories remain uncommitted. No package was published and no
  service or Pulsar installation was updated.

## Criterion -> risk -> command -> observed proof

| Criterion | Main risk | Command / artefact | Observation |
| --- | --- | --- | --- |
| Solar forwards only an explicit Program opt-in | Accidental Preview/on-air cost | `npm test` | 31 files, 192/192 tests passed, including host and adapter key-absence checks |
| Rostered Blue images are ready before switch | Bundle-only warm mistaken for image readiness | `node evidence/local-20260923-roster-images/eleven/probe-served-host.mjs` | With flag, 3 image requests and 3 detached decodes before switch, 0 requests at switch; without flag, 0 before and 3 at switch |
| Scene still renders fully | Image preload changes output or breaks asset gate | `served-host-results.json`, `warm.png`, `cold.png` | 30/30 DOM images decoded in both variants; no page/runtime errors; final 1920x1080 screenshot SHA equal (`c600b648b5fd4d6cd0aec90f640d42bbdd7805b767212cb15a7f13b49b605825`) |
| Pulsar/CEF loads the built Solar host and renders a scene switch | Browser-only proof mistaken for Program proof | `node evidence/local-20260923-roster-images/eleven/probe-served-host.mjs --cef` | OBS `browser_source` produced distinct Stage and Blue 1920x1080 PNGs; visual inspection shows the Blue player/champion/team imagery; scene/input removal requested and Pulsar process reaped |
| Keyframe behavior survives the static runtime fast path | `animation.play` loses its authored `x/y` transform | Solar `animation-compositing.test.tsx`, Lumencast `static-render-path.test.tsx` | Candidate initially failed Solar test while installed runtime passed; generic `keyframed` placement fix made both pass |
| Existing runtime and host checks stay green | Wider regression, unwanted headless fetch or bundle growth | Lumencast Vitest, TypeScript, Vite, bundle/no-fetch; Solar lint/typecheck/build/bundle/E2E | Lumencast 998/998 tests passed (2 skipped); Solar 192/192, host E2E 3/3, lint/typecheck/build/bundle checks passed |

The Blue fixture is Orion's `canvas-chat-sponso.scene-bundle.json`, SHA-256
`e862a652f6725b78e7937f22c885d73892da256a989686f348696f588a0b8110`:
342 nodes, 30 image elements, three unique image URLs. Those historical Figma
URLs are expired. The Chrome test keeps the original bundle and URL allowlist,
intercepting only the three image responses with local images whose SHA-256
matches `zab-blue-image-assets/manifest.json` in the prior evidence folder.
Thus it proves transfer/decode placement and final-render parity for
representative bytes, not recovery of the original Figma pixels.
The candidate Lumencast `dist/lumencast.js` SHA-256 is
`b80560682911fb1fadd3761281e3ae19967deafc0f5a1383cee05509c5e61dde`;
the built Solar `dist/host/index.html` SHA-256 is
`298c8caa7668e39accef3680f48329a8f6b0c48041d9b8a9d9f6eeb62e044c1c`.

CEF cannot use Playwright response interception. Its test derives a separate
content-addressed Blue bundle (`sha256:9593783580c59578acaebef9583918065885b4dc43d4d3ed4ab53e5a8b4b4bb1`)
from the same tree, replacing the three expired sources with the same verified
local images as `data:` URLs. This proves Pulsar/CEF scene rendering with
images; **it does not measure remote-image preloading**, which deliberately
skips `data:` URLs. See `cef-results.json`, `cef-stage.png`, `cef-blue.png`.

The single Solar-host Chrome run reports 77 ms cold versus 51 ms warm from
switch request to all images decoded. That is an illustrative observation,
**not** a latency claim; the earlier direct-runtime interleaved 80-trial
benchmark is the stronger distributional evidence.

## Release / activation gate

1. Publish a versioned Lumencast runtime containing this change, then update
   Solar's dependency and lockfile. Solar currently declares `^0.18.2`; that
   published package does not expose the new behavior. A production Solar
   build today could silently accept the option while doing no image warming.
2. Repair or retire Solar's existing `postinstall` patch script against a
   clean package install. `npm ci --offline` in this worktree failed on its
   peer-stream-registry source matcher. Local validation used the already-
   patched Solar dependency copy plus the new Lumencast `dist` overlaid into
   this worktree's disposable `node_modules` (entry SHA-256 above), not a
   clean CI install. This is a packaging gate, not
   evidence that `npm ci` is green.
3. Do not set the flag by default on physical Program lanes yet. Prism's
   current physical-lane path uses `generation.lsdp`; Orion can advertise a
   single scene just before activation, but that is not proof of sufficient
   lead time for image decode. The Chrome benefit is proven for an early,
   persistent `scene_roster` before a later switch. Measure the actual
   prepare-to-Take interval with remote assets in Pulsar before activation.
4. The CEF proof and Chrome proof are complementary, not a single CEF remote
   A/B. No CI, release, signed commit, merge, deployment or on-air adoption is
   claimed.
