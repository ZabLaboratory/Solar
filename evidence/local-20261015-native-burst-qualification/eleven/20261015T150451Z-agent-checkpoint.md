# Native LSDP qualification agent checkpoint

## Worktree identity

- Repository: `D:/Documents/Zab/Solar`
- Worktree: `D:/Documents/Zab/Solar/.worktrees/eleven-local-20261015-native-burst-qualification`
- Branch: `eleven/local-20261015-native-burst-qualification`
- Starting commit and HEAD before this unit: `623a9450d01be5df3b8e7765c6ef59ae8a2eff4d`
- Local `.worktrees/` exclusion and evidence directory are present. The only dependency link in this worktree is `node_modules` → `D:/Documents/Zab/Solar/.worktrees/eleven-local-20261015-project-integration/node_modules`; the target was inspected, the link was explicitly authorized, and no dependency content was written.

## Owned changes

- Added a deterministic one-text LSML/LSMLZ fixture and its generator under `fixtures/native-burst/` and `scripts/proof/`.
- Added a private real-daemon Solar/Vision headless Chrome qualification runner, with immediate burst and paced modes, bounded event capture, error phase/timestamp attribution, hash/identity correlation, queue summaries, nearest-rank latency quantiles, post-ACK drain boundaries, and retained-canvas/OCR sample counts.
- Extended the native producer to preserve the native ACK's optional state hash as `null` when the wire ACK has no hash.
- Added eight focused Node tests and updated the native LSDP development docs and script indexes.
- Added browser, pixel, preflight, copied-dist provenance, and qualification-manifest evidence. Detailed results are in `20261015T150406Z-agent-report.md` and checksums are in `20261015T150406Z-qualification-manifest.json`.

No Solar runtime source, Rust code, protocol, transport bounds, Vision pin, native pin, shared development process, or remote publication was changed. No scene switch, physical camera, audio, CEF, or external streaming action was used. The dist copy is isolated to this worktree and its 92-file hash provenance is recorded.

## Validation

- `node --test tests/proof/native-burst-analysis.test.mjs`: 8 passed.
- `npm.cmd run typecheck`: passed.
- `npm.cmd run lint`: passed.
- `npm.cmd run check:architecture`: passed.
- `npm.cmd test -- --maxWorkers=1`: 41 files, 361 tests passed.
- Private real browser: sustained 512/512 at 131.51 tx/s passed; immediate burst received 512 native ACKs but only 44/512 Solar receive/apply identity/hash events before `SUBSCRIBER_LAGGED` resync. The final daemon hash and OCR match after recovery; the burst per-transaction qualification remains failed.

Latency boundaries distinguish native ACK from Solar presentation. Sustained receive-to-post-submission p50/p95/max was 1.70/3.00/10.40 ms; burst observed pairs were 2.60/4.80/11.40 ms before resync. Logical covering submissions are not display frame counts. Retained-canvas display frame identity, GPU completion, and physical scanout are unavailable.

## Checkpoint status

This checkpoint records the completed Solar/browser qualification work and the burst limitation without changing native transport. The isolated native investigation requested by the parent remains separate work. The worktree must stay available for that handoff until consolidation; no cleanup or remote operation is authorized here.
