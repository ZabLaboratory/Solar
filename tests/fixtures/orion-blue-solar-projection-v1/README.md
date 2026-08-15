# Orion Blue/Solar projection v1 fixture

This fixture pins the existing LSDP/1.1 reader seam used by Solar:

- `bundle.json` is the content-addressed `RenderBundle` fetched after the
  snapshot advertises its `scene_version`.
- `snapshot.json` is the keyframe state that binds the preview text node.
- `delta.json` is an LSDP/1.1 delta carrying the value update. Its additional
  top-level fields mirror Orion's additive
  `orion.blue-solar-projection.v1` metadata (`schema_version`, digest,
  runtime instance, target, render revision and correlation id).

The Solar test builds the valid snapshot and delta envelopes with
`@lumencast/protocol`. It uses raw JSON only when adding those producer fields,
then feeds the result through the same codec/runtime path Solar consumes. The
metadata is deliberately ignored; the existing `patches` field remains the
only state application seam. This is a local compatibility fixture, not a live
or PGM proof.
