# Agent checkpoint — rejected active mutation recovery

Checkpoint time: `20261015T171850Z`.

- Repository root: `D:/Documents/Zab/Solar/.worktrees/eleven-local-20261015-rejected-mutation-frame`
- Git common directory: `D:/Documents/Zab/Solar/.git`
- Branch: `eleven/local-20261015-rejected-mutation-frame`
- Starting/base HEAD: `cc2707bf16d71941c7432436d2f438f08d70cc35`
- Owner boundary: active malformed snapshot/mutation recovery only. No transition,
  readiness, switch-duration, historical scene cache, shared runtime, audio/output,
  remote push or merge changes.

The active layer now keeps its prior opacity when a Vision replacement load fails;
the existing `clear-scene`, no-op message handler and thrown error remain. Tests
prove the first failed load remains hidden, while a rejected replacement after a
valid frame retains the same visible layer/front canvas and permits a same-engine
valid reload. The real private Repeat proof in `20261015T171332Z-repeat-report.json`
also confirms native error preservation, unchanged visible pixels after rejection,
snapshot recovery back to `live` with no invented applied event, then a real
collection `applied` event with 604 changed pixels and a separate scalar `applied`
event with 173 changed pixels.

Validation passed: targeted Vision session tests (12), script syntax, typecheck,
lint, code map/current-map check, source-usage and documentation/architecture
checks, host/server build, bundle checks and `git diff --check`. The detailed run,
actual hashes, capture filenames and scope limits are recorded in
`20261015T171332Z-agent-report.md` and the accompanying JSON/pixel evidence.

The signed commit records this checkpoint and all owned source, tests, discovery,
driver and evidence. Worktree is retained clean for review/handoff.
