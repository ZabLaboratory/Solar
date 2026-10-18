# Solar native group composition checkpoint

- Work unit: `local-20261015-native-group-composition`.
- Repository/worktree: `D:\Documents\Zab\Solar\.worktrees\eleven-local-20261015-native-group-composition`.
- Branch: `eleven/local-20261015-native-group-composition`.
- Base: signed Solar native-package checkpoint `486d87dbee1845423e4db32dd4c710119fdae133`.
- Checkpoint UTC: `2026-10-15T23:15:29Z`.

## Scope delivered in this checkpoint

Solar now derives an ordered group graph and owner-local Solar surface slots from the active LSML document selected by the existing lane snapshot. The synthetic root is neutral; authored root style is represented by one authored child group. Capture children carry the authored component ID, local size, transform, local opacity, effective visibility and crop. Surfaces retain one explicit owner and coordinate space. Solar reads the texture ceiling from the existing Vision WebGL2 session; it does not create another rendering context.

A versioned `solar/composition` LSDP side channel carries the plan with the exact active source identity and snapshot hash. Main owns physical `A`/`B` producer claims through CAS on that same resource; Solar verifies the current nonce on each write/clear and does not mutate the producer table. The derived publisher has one peer operation in flight and at most one latest pending plan. Superseded/retired publication promises do not replace LSML mutation receipts.

## Validation

- Targeted Vitest: `npm exec -- vitest run tests/unit/native-composition-publisher.test.ts tests/unit/native-composition.test.ts tests/unit/native-document.test.ts tests/unit/vision-session.test.ts tests/unit/editable-bindings.test.ts tests/unit/native-lsdp-runtime.test.ts tests/unit/native-lsdp-runtime-composition.test.ts` — 7 files, 103 tests passed (recorded before this docs-only checkpoint).
- `npm run typecheck` — passed (recorded for the same source checkpoint; not rerun for this documentation/map refresh).
- `npm run code:map` — mapped 68 source files.
- `npm run check:source-usage` — 68/68 reachable; no unused exports/dependencies or problems.
- `npm run code:check` — passed; map current at 68 files.
- `npm run check:docs` — passed; 31 documents, 191 local links, no failures.
- `python scripts/check_file_sizes.py` — passed; 305 text files and four reviewed exceptions, no growth.
- `npm exec -- prettier --check --` on the changed source, tests, Markdown, JSON and existing start evidence — passed.
- `git diff --check` — exit 0; Git reports only its existing CRLF-to-LF warning for `tests/unit/editable-bindings.test.ts`.
- No app, CEF, native runtime, GPU build, or shared runtime was started.

## Boundaries still open

This is a planner/publisher foundation, not native mixed-pixel qualification. Solar only resolves fixed frames for the native group plan. Auto-layout, grid and repeat geometry remain unresolved and fail closed. Effects extending beyond an owner's bounds remain unresolved. The current Pulsar consumer explicitly refuses Solar surface bands, non-null masks and unsupported group blend modes, so no native mixed-group output is claimed. Vision's active-session projection getter and exact repeated-instance identity consumption remain a separate integration step.

No product merge, push, runtime or public output is included in this checkpoint.
