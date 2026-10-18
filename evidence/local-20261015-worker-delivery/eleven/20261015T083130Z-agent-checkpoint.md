# Checkpoint — observer double failure follow-up

- Worktree: `D:\Documents\Zab\Solar\.worktrees\eleven-local-20261015-worker-delivery`.
- Branch: `eleven/local-20261015-worker-delivery`.
- Follow-up base: Root integration `2a2958adc9f3942ec2a5f192528032a121697d63` (contains the original `28adfc2` change set).
- Scope remains `src/engine/native-worker-client.ts`, `tests/unit/native-worker-client.test.ts`, `src/engine/README.md`, and this evidence.

## Change and validation

The `onClose` lifecycle callback now has an explicit guard when invoked after `onIncomingFailed` throws. The original transaction failure is posted to the worker first and retains its optional typed code; no success receipt is emitted. Observer callback exceptions are reported through `console.error` when possible and cannot reject the ordered queue. Admission and close policy were not changed.

The existing typed-admission test now makes both `onIncomingFailed` and `onClose` throw. It verifies the `ADMISSION_FAILED` error receipt, the absence of a success value for that delivery, a successful receipt for the next queued delivery, and console reporting of the second observer exception.

Validated against the isolated worktree with the focused `native-worker-client.test.ts` suite (Vitest 4.1.5, 9/9), strict targeted TypeScript `--noEmit`, Prettier `--check`, and `git diff --check`. D: free space at validation was 394 674 176 bytes. The shared runtime, DLLs, build outputs, and other worktrees were not touched.