# Meet framing follow-up — Solar

- Repository: `D:\Documents\Zab\Solar`.
- Worktree: `.worktrees/eleven-local-20261015-meet-framing`.
- Branch: `eleven/local-20261015-meet-framing`.
- Follow-up base: `3c6290b6fa04eabdac8e57e54f288fbdaafede2a` (`feat(solar): apply Meet framing to peer bitmaps`).

`normalizeCrop` now treats null, non-object, and array values from an external JSON peer descriptor as neutral crop defaults before reading crop edges. This keeps a malformed/reset profile from throwing during video drawing. The new regression parses a wire-shaped descriptor with `sourceCrop: null`, publishes a peer stream, then verifies the frame upload uses neutral crop geometry, keeps the subscription alive, and reports no error. An unused local in the adjacent framing test was removed.

Validation:
- Focused Vitest: `tests/unit/live-media.test.ts`, 17 tests passed.
- `git diff --check` passed for the two owned files.
- No native/WASM build, live service, or runtime session was started. Disk space remains below the 5 GiB build guard.
