# Checkpoint — Meet framing (Solar)

- Repository: `D:\Documents\Zab\Solar`.
- Worktree: `.worktrees/eleven-local-20261015-meet-framing`.
- Branch/base: `eleven/local-20261015-meet-framing` at `c0d4b3425a5fafc2bc96367390d877717df5bb2a` before this unit's commit.
- Source candidate: `.worktrees/eleven-local-20261013-solar-qualification` at the same base, with pre-existing uncommitted product changes.
- Scope: Solar live-media descriptor and bitmap framing only; `native-lsdp-runtime.ts` and generated WASM were not edited.

The peer DTO carries `object_fit`, authored `size`, `contentBox`, `sourceCrop`, `sourceZoom`, and `objectPosition`. Bitmap preparation applies crop, contain/cover/fill, zoom, position, and a content box scaled from authored to upload dimensions. Framing-only updates dirty the current image while preserving the peer stream subscription. `clipEffects` stays on the Vision image node and is consumed by the Vision renderer.

The four files below were copied in full from the source candidate to preserve its pre-existing hunks, then the Meet delta was applied. The SHA-256 source/baseline values are recorded in `20261015T070854Z-baseline-manifest.json`; the final hashes below distinguish the result of this unit's edits from that copy:

| File | Source/baseline SHA-256 | Final worktree SHA-256 |
|---|---|---|
| `src/engine/README.md` | `A3930F2C3B95D03DA116754B6C18D0A1DAEDDFF31A0577644931E80F8192742F` | `3172640AE4553A5C3E660E84C5F1AEB2BD186CC28B958BC6C26CAA7FF8929E6F` |
| `src/engine/live-media.ts` | `EA3B4F983C8CBCDC26C80810040537E51C7D0463AF73ECD03EE443B8A8D2AE6E` | `20E67FBCB59406E5D96CDFD1FB38765F227B69AACC5BC1CB7A80412351F97EF1` |
| `src/engine/vision-presenter.ts` | `A75A41EFF229EB8AB12CB8150FF59E5A08072940A5C52A61C1D58D1464609CBE` | `1FB19027637C0A34965B03E1833D02DDD2A4D7E3A4119FE402FF970F01559F12` |
| `tests/unit/live-media.test.ts` | `BC3E57BBDF46B202126A1FD6E5C55372B967801026A4771F7E399AB5118A0881` | `FC5BC9B1D3F0B9177E995FE017817E13F881BDDC01C99D200001301EE1087014` |

The copied README and runtime files include previously existing source-candidate changes beyond Meet. They remain intact and are explicitly part of the baseline copy; only these four required source paths and this evidence are included. No other source-candidate files, LSDP-owned runtime module, generated WASM, `target/`, or build output are staged.

Validation completed:

- `vitest run tests/unit/live-media.test.ts --reporter=dot` using Solar's existing canonical `node_modules`: 16 tests passed. Assertions cover contain/cover/fill draw geometry, asymmetric horizontal and vertical crop, zoom, object position, scaled content box, and framing updates without resubscribing the peer source.
- `git diff --check` passed for the four owned paths.
- Prettier's full-file check flags pre-existing formatting in `live-media.ts` and `tests/unit/live-media.test.ts` in the source baseline; `vision-presenter.ts` passes. The copied files were not globally reformatted to avoid rewriting unrelated existing code.
- No native build, WASM rebuild, live service, or runtime session was started. D: had 382,296,064 bytes free at checkpoint, below the 5 GiB build guard.

The Solar tests validate bitmap behavior locally. End-to-end WASM/live rendering remains for later integration after disk space is available.
