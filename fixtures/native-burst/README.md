# Native LSDP browser burst fixture

`native-burst.lsmlz` is a one-text LSML 1.1 scene for the private native burst
qualification. Its single default, `__lit.text.text_msxz43eh_1`, starts at
`0000/0512` and is the only field mutated by the producer. The scene has no
camera, video, audio, network asset, second lane, or scene-switch behavior.

Regenerate both the canonical source and the stored archive with:

```powershell
node scripts/proof/generate-native-burst-fixture.mjs
```

The scenario drives the real local Rust LSDP daemon and the exact Solar/Vision
host assets copied into the private qualification worktree. Native receipts,
Solar receive/applied events, resyncs, retained-front-canvas pixels, and final
authoritative state are recorded as separate boundaries.
