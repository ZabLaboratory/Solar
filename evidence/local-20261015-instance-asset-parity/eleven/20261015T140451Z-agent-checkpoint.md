# AGENT_CHECKPOINT — instance asset parity

- Work unit: goal21 / Eleven / Main1 instance-asset-parity.
- Repository: D:\Documents\Zab\Solar.
- Worktree: D:\Documents\Zab\Solar\.worktrees\eleven-local-20261015-instance-asset-parity.
- Branch: eleven/local-20261015-instance-asset-parity.
- Base revision: 0df2d5dedd03ecd8dee00814073bea28c630e326.
- Scope: exact child LSML acquisition, safe named and SHA-1 package assets admitted only from verified exact LSMLZ cache packages, plus existing SHA-256-addressed Canvas HTTP assets.
- Excluded: Vision edits, capture/editor resolution, embedded child LSML HTTP(S) image URL rewriting, transition duration, shared runtime/process/audio/output changes, project-integration WT and its frozen dist/fixtures, and remote publication.
- Parent direction applied: keep root/default requests LSMLZ; exact children request LSML; no fallback LSMLZ after integrity, budget, or abort errors; no invented identity or named/SHA-1 HTTP permissiveness.
- Contract finding: safe named/SHA-1 package paths are legal in Vision and can be served from verified LSMLZ cache conversion. Current ZabCanvas HTTP descriptors only enumerate SHA-256-addressed local assets; historical SHA-1 and arbitrary named HTTP paths are unsupported by the upstream asset service. Embedded remote image URLs remain a separate limitation. Main proxy forwards the exact identity headers needed by Solar.
- Implementation: bounded archive admission and duplicate detection before unzipSync; safe reference checks; recognized SHA-1/SHA-256 verification; local LSMLZ-to-LSML provider projection; exact child source fetch and transport digest checks; strict scene-version, revision, ETag/body, and asset-path validation for separate HTTP assets.
- Durable proof: 20261015T140451Z-contract-audit.md, 20261015T140451Z-browser-qualification.json, 20261015T140451Z-browser-pixels.png.
- Validation: focused 4-file asset/source/provider suite 43/43 passed; lint, typecheck, build, source-usage/code-map/docs/file-size architecture checks and bundle checks passed. Private Chrome instance-runtime proof passed with 5 samples, embedded SHA-1 WOFF2 and named nested PNG, revision/live binding mutation, WebGL context restoration, and active-output preservation after missing or wrong-SHA-1 child assets.
- Full suite: 345/352 passed; the only failing file is untouched tests/unit/meet-viewer-identity-race.test.ts (7 timing/identity failures), reproduced by npm test -- --maxWorkers=1. This remains outside the owned scene-source subtree.
- Security checks in focused coverage include malformed input, duplicate exact/case-fold paths, traversal/unsafe paths and overlong paths, wrong hashes, missing assets, expansion budgets, aborted fetches, HTTP header absence/mismatch, and rejected child acquisition preserving accepted output.
- External pins were read-only; no external repo, shared runtime, remote service, or shared dev process was written or used.

This checkpoint is evidence only. The implementation is intended to be committed with the configured SSH signing key; remote publication is not authorized.
