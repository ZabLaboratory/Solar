# Solar native capture translation latency

## Assignment

Measure and, if justified by the measurement, optimize the native Solar capture
translation receipt-to-composition path for capture x/y scalar mutations. Preserve
Vision receipt validation and the canonical LSML/composition contracts. Scene
transitions, scene-switch duration, and Prism are outside this work unit.

## Provenance

- Repository: `D:\Documents\Zab\Solar`
- Worktree: `D:\Documents\Zab\Solar\.worktrees\forge-local-20261018-solar-native-capture-translation`
- Branch: `forge/local-20261018-solar-native-capture-translation`
- Base: `7992ec825329f2f1eea7dc545d889662efde549f`
- Base parent: `ca6af362544e26e9e940dac4ff37204d5a555405`
- Base source branch: `eleven/local-20261018-vision-silent-init-deadline`
- Base source worktree was clean when inspected. Its native-composition runtime,
  receipt, and projection files supplied the required behavior absent from the
  canonical main checkout at `f5c303f4709d12caa8f2e0c4ae263aa53717591d`.
- A later integration branch, `eleven/local-20261018-vision-image-assets` at
  `6c3a1f8ccfe56f210247fa240010b8c7bb829521`, descends from the base. The scoped
  composition runtime, session, contracts, and tests have no changes in that
  ancestry range; this work remains based on the explicitly assigned `7992ec8`.

## Initial inspection

- `src/scenes/native-composition.ts` validates and projects the accepted Vision
  composition frame; `src/engine/native-lsdp-runtime.ts` accepts composition
  after the scalar patch is applied to the active scene.
- `src/engine/native-composition-session.ts` uses `NativeSceneFrames` to obtain
  the active receipt, then records the projection with the exact LSML state hash.
- Focused tests are in `tests/unit/native-composition.test.ts`,
  `tests/unit/native-composition-session.test.ts`, and
  `tests/unit/native-lsdp-runtime-composition.test.ts`.
- Existing `tests/proof/native-burst-analysis.test.mjs` analyzes generic burst
  queue and presentation measurements; it does not mutate capture x/y or time
  the native composition receipt/projection path.

## Results

The deterministic off-air benchmark is in
`tests/bench/native-composition-capture-translation.bench.ts`. The final raw
Vitest JSON and verbose output are
`20261018T142827Z-final-benchmark.json` and
`20261018T142827Z-final-benchmark.txt`; the report at
`20261018T142827Z-AGENT_REPORT.md` documents the method, timings, limits and
checks. Mean receipt-to-projection-to-plan-hash cost was 0.1189 ms at 1 capture,
3.1828 ms at 64 captures, and 48.9336 ms at 1024 synthetic captures. Only the
1024 stress case exceeded 16.67 ms; plan canonicalization dominated it.

No production optimization was retained. Removing projector validation would
weaken the mutable receipt boundary for a small synthetic-only gain, while
ordinary measured cases are comfortably under one 60 Hz frame. Solar's 1-capture
synchronous composition section is not a material frame-budget cost in this
benchmark; no conclusion about downstream Prism reconciliation is made.

Focused verification passed: 67 tests across 5 unit files, TypeScript
typecheck, focused ESLint, Prettier check and `npm run check:docs`. Full command
and result detail is in `20261018T142827Z-AGENT_REPORT.md`.
