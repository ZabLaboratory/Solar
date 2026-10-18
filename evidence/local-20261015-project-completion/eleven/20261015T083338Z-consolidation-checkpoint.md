# Consolidated Solar qualification

Owner: Main 1 / Eleven. Worktree: D:/Documents/Zab/Solar/.worktrees/eleven-local-20261015-project-integration.
Branch: eleven/local-20261015-project-integration. Source candidate: f869747f8ae3f1912f2fcf4c6064bcbf18cf6747.

Meet framing integrates commits 3c6290b and 31665ce, including direct descriptor geometry and null/non-object sourceCrop resets. Its bitmap fitting changes retain peer subscription and current stream. Worker delivery integrates 28adfc2 and ae502a3: instrumentation cannot reject the ordered queue; typed admission errors survive main-to-worker delivery; exceptions in both error observers do not become false success or strand the next notification. These source changes do not modify scene transitions or switch duration.

Validation on this combined source:
- All 303 unit tests in 36 files pass.
- Full TypeScript tsc -b passes.
- Full check:architecture passes: source usage, generated map (50 files), documentation (26 documents, 144 local links, no failures), and file-size guard (205 text files, 2 existing reviewed exceptions, no growth).
- Full JavaScript library/host/server/layout build passes. Output manifest: 62 files, 13477709 bytes. The build verifies the retained Vision artifact pins and one copy of each of 5 runtime Vision assets.
- The first architecture check failed on 5 tracked historical proof files omitted by sparse checkout. git cat-file verified all 5 exist in HEAD; only those 168832 bytes of existing proofs were materialized. The complete rerun passes. No broken link was silenced or source proof recreated.

Limits: the JavaScript build retains the old pinned WASM. The new Vision Meet Rust source at e0a5e0617073cc410f8ff48b86bc67880d1a5d4b is not compiled/admitted here, so this is not an end-to-end Meet rendering qualification. No GPU/CEF throughput, new native build, runtime replacement, shared-dev restart, public live, push, merge or installer qualification occurred. The earlier hash-verified native server interop and 512 authoritative/watch increments remain documented in 20261015T074333Z-native-interop-checkpoint.md; they are not 512 rendered frames and were not reinterpreted as such.

Only docs/development/code-map.md is an integration-derived source change beyond the cherry-picked units. Logs are compressed alongside this report. Goal remains active; native/WASM/GPU, endurance, installation and the remaining product ledger still require work. Low D: free space prevents heavyweight builds. An unrelated Main 3 evidence filename still blocks the global workspace closure guard and was preserved.
