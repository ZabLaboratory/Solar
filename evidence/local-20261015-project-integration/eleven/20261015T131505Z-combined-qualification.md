# Consolidated Solar, Vision and LSDP-native qualification

Owner: Eleven/Main1. Continuation of the full project-completion mandate; transition and scene-switch duration are excluded. Local integration only, no remote publication or shared-runtime admission.

Source candidate: Solar signed merge `92d00ede6543128e32db5a6ec31c40b155c14c7c`, combining installation-font diagnostics (`b60189958d9cd3044c193fd6f631c56812b62b4f`) and exact active-instance acquisition plus the release Vision ABI/pin (`94fd95d5269567dbde057b2801633f862ec1ca59`). Vision source is `728e1247a830fec777b4a234af5d8cd9d20dc311`, retained in Vision integration `61fcc7c62eed42667278cdb8474b47c34851744f`. Native server source is `4d197aefbde76cacc8ffd70cb84edec031575f5b`, retained in native integration `2feecd56ffd7bde6714ef996de067306c29b20cd`.

## Checks executed on the combined Solar worktree

- `npm test`: 344 tests, 40 files, PASS.
- `npm run typecheck`, `npm run lint`: PASS.
- `npm run check:architecture`: PASS; all 59 source files reachable, zero unused modules/exports/dependencies, current code map, 31 documents and 171 local links, 270 text files and two reviewed size exceptions.
- `npm run build`, `npm run check:bundle`: PASS; persistent Vision host, three self-contained JavaScript chunks, exact four Vision pins.
- `package-native-server.mjs` with the exact release native server, `check:native-package`, `check:native-client`: PASS. Native SHA256 `083f06c25248f2ca3f2523f41c966012499bce77cc68117c6b12de160bf93448`; portable client stays at `e695e14f9f664f430ffc2e0e75d083fab88abc7f`.
- `npm run test:native -- --lsdp-bin <qualified native release>`: PASS, five mutations, fragmented payload, rejected-batch atomicity, stale-base refusal, duplicate idempotency, unchanged source, memory-only restart semantics. Synthetic scene; no real stream.
- `node scripts/qualify-instance-runtime.mjs --out .cache/combined-instance-qualification-available-fonts --playwright-root D:/Documents/Zab/Prism`: PASS in Chrome 154.0.8037.98, four phases. Exact local root/children, four fits, child WOFF2/PNG, live bindParams mutation, context loss/restoration, missing-child refusal preserving the active frame.
- `git diff --check`: PASS.

The first architecture run failed because sparse checkout omitted the newly linked tracked evidence folder. The first combined browser run failed in font preload because sparse checkout omitted tracked `public/fonts`; its missing-asset response was not a font. Materialized only the exact tracked evidence/font paths, reran both successfully, then rebuilt the package with fonts present. No product fallback, asset validation or test assertion was weakened. The initial browser failure is preserved separately.

## Limits

Prepared installation font files are not a claim that every face was registered by the engine. Child paths named without SHA256 or using SHA1, remote HTTP child assets, child capture composition, editor resolution and installed/shared-runtime admission remain unqualified. This does not close the full instance-parity, endurance, Live, WAN or native-mask requirements. Common dev remains on its previously admitted immutable package until a separately qualified handoff.
