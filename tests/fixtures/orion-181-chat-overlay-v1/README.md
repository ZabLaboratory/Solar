# Orion #181 stateful chat overlay fixture

This fixture is the Solar-side consumer artifact for the authenticated
Orion/Blue #181 chat overlay. It is deliberately smaller than the producer
program: the producer bytes remain owned by Blue and Orion, while this folder
pins their identity, the render bundle, and the LSDP/1.1 frames Solar reads.

## Producer provenance

- Work unit: `ZabLaboratory/Solar#50`, ADR-BLUE-012 R6 revision
  `f2afceac32ad8c29f6043920cce9d362cc963614`.
- Blue PR #327 merged at `5d644a6a2f1b25682c9d79ffdcb470c6d2f92216`.
- Orion PR #382 merged at `c5a2c25b2aed1d68079ed0ab6224625a51516358`.
- Blue source: `tests/contract/orion_181_chat_overlay_program.json`.
- Orion copy: `internal/api/testdata/orion_181_chat_overlay_program.json`.
- Both producer files are 5,505 bytes and byte-identical. Their file SHA-256 is
  `fc5cd671729f44bbe09ad278d93a8cc0ac0add9c275c541df2aa6b16f4a3b97a`.
- The compiler-stamped program identity is
  `sha256:e37e2d6e989b4b56f1ff1b74a4f6323331d263fd80b2dc829a5b293deaf502ef`.

`provenance.json` records the producer copies, source revision, state
declarations, and the exact projection metadata used by the Orion test. The
program digest is distinct from the JSON file hash; both are retained so a
future regeneration can detect either kind of drift.

The authenticated program declares `overlay_message` and `chat_count` as
stateful outputs. Its real producer test establishes these projections:

| frame         | accepted chat event      | `overlay_message` | `chat_count` |
| ------------- | ------------------------ | ----------------- | ------------ |
| snapshot      | baseline                 | `""`              | `0`          |
| delta `seq=2` | `evt-1`, message `gg`    | `chat: gg`        | `1`          |
| delta `seq=3` | `evt-2`, message `hello` | `chat: hello`     | `2`          |

## Solar render and wire contract

- `bundle.json` is a content-addressed `RenderBundle`; its verified
  `scene_version` is `sha256:6bc6a9dbdcb4c24c7f2811c21a3344859610ab734ee49d112b159f84a5f97bee`.
- The bundle contains only two text leaves, bound to the producer outputs
  `overlay_message` and `chat_count`.
- `snapshot.json` is the baseline LSDP/1.1 keyframe.
- `delta-evt-1.json` and `delta-evt-2.json` retain Orion's additive
  `orion.blue-solar-projection.v1` fields alongside the normal `patches` and
  `cause` envelope. Solar applies only the leaf patches; it does not interpret
  the producer metadata or reimplement Blue's program.
- Orion's `scene_digest` is intentionally distinct from the RenderBundle
  `scene_version`; the reader test proves that this additive audit metadata is
  semantically ignored while the patches update the DOM.

`tests/unit/orion-181-chat-overlay.test.tsx` loads these files, verifies the
bundle hash with `@lumencast/protocol`, creates frames through the real codec,
and drives the real Solar `mount()` seam. It also checks the reader's
contractual duplicate-sequence drop and the fail-closed scene-version mismatch.
It does not re-prove Blue/Orion producer ordering, event acceptance, or a live
PGM/Twitch output.
