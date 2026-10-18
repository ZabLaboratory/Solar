# Worker admission regression coverage

Owner: Main 1 / Eleven. Worktree and branch: Solar/.worktrees/eleven-local-20261015-project-integration / eleven/local-20261015-project-integration. Base: 03a4957, continuing integration verification. No product implementation change.

Existing client tests mock the Worker boundary; they could not detect the worker returning a scalar success before the main result. The new native-worker.test.ts imports the actual worker and mocks only BrowserLSDP transport. A real NativeState snapshot and valid hash-pinned scalar event prove the callback remains pending until main admission and returns the exact supplied receipt. A second case proves a typed main admission error is rejected instead of being turned into success. Test crypto overrides and worker handlers are isolated and restored. The source README and generated discovery map expose this coverage and its boundary.

Both new tests pass. All 36 unit suites pass: 297 tests (21.04 seconds), superseding the overlapping 295 count. TypeScript, targeted ESLint, generated code-map check and git diff --check pass. No native browser transport, channel-window throughput, GPU frame, performance, active runtime or switch/transition behavior is qualified by these mocked-transport tests. No shared-dev restart or binary admission.
