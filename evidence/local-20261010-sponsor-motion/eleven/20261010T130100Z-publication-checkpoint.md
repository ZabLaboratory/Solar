# Solar motion publication checkpoint

Owner Eleven; thread 01a124c8-8595-7f01-92fd-bf0d24ba8bd1.
User explicitly authorized push and merge of Solar animation updates.
Worktree: D:/Documents/Zab/Solar/.worktrees/eleven-local-20261010-sponsor-motion.
Branch: eleven/local-20261010-sponsor-motion.
Validated product HEAD: c5b0ab5 (full SHA in Git); original motion HEAD be932c74436f385e480439c3c7cd4095b654ba4a.
Integrated upstream: 9dc261e8747ad07a294815b58adb442d546941fb.
Upstream tree equals the original 421495ae759e7f69728507d557030eef640b66a3 base exactly. Resolve squash-history conflicts by preserving the newer motion implementation; no concurrent changes were discarded.

## Product scope

Composed sequence/parallel/reference clips; delay/stagger; property-wise composition; curves/holds/springs; motion paths; native playback controls, looping and reverse; retained effect/affine/wave bindings; corresponding SVG path morph and vector reveal; bounded scheduling and exact-content compilation reuse. Local immutable scene delivery and demonstration/proof scripts are included. Contracts/limits live in docs/development/motion-system.md and the owner READMEs.

Vision artifact source remains exactly 14658e3738399fd95b1498569de369a190988b17 with all four byte pins unchanged. That source is contained in verified upstream Vision merge bb6d57f4bb941f79e0d11d31dc3b582dcf762662; provenance now states this accurately. The artifact does not pretend to be regenerated from the later merged source.

## Checkout correction

The first native-client check after integration failed: Git's general LF normalization altered four immutable vendored files, whose pinned upstream Git blobs use CRLF. Restored all four files directly from native revision e695e14f9f664f430ffc2e0e75d083fab88abc7f; verified committed blobs equal upstream bytes. Scoped -text and cr-at-eol attributes preserve bytes and recognize upstream carriage returns. No pin was weakened or replaced. Added native-client verification to existing PR CI.

## Passed on the stable candidate

- npm run lint; npm run typecheck.
- npm run check:architecture: all 50 source files reachable, derived map current, docs pass, file-size guard passes.
- npm run test:architecture: 5 passed.
- npm run check:native-client: four exact upstream files.
- npm test: 260 passed in 35 files.
- npm run test:native with the actual reference LSMLZ and Rust binary: five mutations, fragmented payload, batch atomicity, stale-base rejection, deduplication, unchanged source and cold restart/memory-only state pass. Durable receipt: 20261010T130100Z-native-interop.json.
- npm run build: complete lib/host/HTML/server/layout build.
- npm run check:bundle: self-contained host, correct runtime layout, four Vision artifact pins.
- New actual-canvas controls on rebuilt host: 20261010T130024Z-controls.json and initial/restored PNGs. All seven controls pass; one scene load; no reader runtime/console errors. Pause/seek/resume/speed/reverse/stop/second alternate iteration/cancel are checked on submitted pixels.
- git diff --check; signed commit verification. Local logs: .cache/publication/.

Only the assigned 4590 demo process tree was stopped for the full build, then restarted on 4590/4591. Other sessions preserved. Native health reports the expected reference scene/version, memory-only persistence; recoverable disconnect events include reader lifecycle/restart and are not a claim of globally empty server logs.

## Acceptance and publication boundary

User visually accepted the final reference rotoscope: “Beh gg ? Je vois 0 différence avec mon oeil humain”. Previous hand interpretation remains rejected. This is one reference's vector contour reconstruction, not arbitrary semantic rig inference or full After Effects/Jitter parity.

Merge requires green repository CI on the final head, the permitted squash method, a GitHub-verified commit and exact final tree parity on fetched origin/main. Final receipts and closure will be published in the PR. No release tag or deployment is authorized here. Preserve the clean active worktree/branch and running demo for this chat; no unrelated cleanup. Rollback by checked revert of the squash merge.
