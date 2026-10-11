# Solar consolidation validation

- Repository/worktree: `ZabLaboratory/Solar`, `eleven/local-20261011-vision-merge`
- Base: `origin/main` at `9c8f837d5049a54a61ff83aba1fe9e9c49c35b48`
- Scope: pin the new signed Vision build, keep its upstream source provenance, and retain regression tests/documentation for mixed native composition. The scene-local-library and launch-sync implementation is already present in this refreshed `main`; it was not duplicated.
- Vision source commit: `64d0cfc7d7a539d1e4c7fcfcddafbf771bacd49e`. The matching generated JS/WASM files and SHA-256 pins are in `public/vision/`; the merged upstream revision will be recorded after Vision PR #7 merges.

## Validation

- `npm ci` — passed. npm reported 6 dependency audit findings (5 moderate, 1 high); dependencies were not changed.
- `npm run lint` — passed.
- `npm run typecheck` — passed.
- `npm test -- --reporter=dot` — 35 files, 261 tests passed.
- `npm run build` — passed.
- `npm run check:bundle` — passed: five Vision assets, one runtime copy each, host bundle and artifact hashes verified.
- `npm run check:architecture` — passed: all 50 source files reachable, code map current, documentation checks clean, file-size guard clean.

Vision PR #7 is open; this Solar branch is intentionally awaiting that upstream merge so `merged_revision` can pin the exact GitHub-integrated commit.