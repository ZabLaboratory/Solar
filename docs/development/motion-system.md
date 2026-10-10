# Motion runtime contract and audit — 2026-10-10

Owner: Solar playback; Vision owns retained drawing and GPU effects. This local
candidate continues the sponsor-motion and continuous-motion worktrees. It is not
published, merged into Prism or qualified for Pulsar Program. The actual consumer
is the Solar native LSDP demonstration, rendered by the pinned Vision WASM engine.

## Findings and corrections

| Finding before this change | Current behavior |
|---|---|
| One animation entry per target overwrote another whole target | Independent tracks merge per target/property |
| Scale rebuilt source geometry and loaded a scene every frame | Retained GPU scale/skew/anchor; descendants follow parent transforms |
| Raw steps and easing parsed repeatedly in the hot path | Bounded plans/tracks/curve functions compile once from immutable source |
| Global easing only | Curve per outgoing segment and property; hold, cubic Bézier, damped spring |
| Flat catalogue with no composition | Nested sequence/parallel/reference, delay, parallel stagger |
| Fire-and-forget replay only | Play/pause/resume/seek/speed/reverse/stop/cancel, finite/infinite iterations, alternate direction |
| Effect support effectively opacity/blur/rotation/translation | Color, backdrop blur, stroke, first authored shadow, retained affine and continuous image-wave controls |
| No native LSML primitive keyframe playback | Primitive keyframes adapt to the same compiled player and replay when their key changes |
| A cold reader could fail on a retained control command | Cold control has a deterministic boundary; explicit seek supplies its playhead |

The legacy `{target,keyframes:{duration_ms,easing,steps}}` asset and
`{animation_id,command_id}` play command remain supported. Translation remains an
offset from the current source/bound coordinate. Scale now uses a visual pivot
(centre by default), preserving layout and glyph/image resources rather than
resizing descendants and fonts. That corrects the old scale fallback semantics.

## Catalogue syntax

```json
{
  "animations": {
    "enter": {
      "target": "sponsor",
      "keyframes": {
        "duration_ms": 900,
        "steps": [
          {"at": 0, "opacity": 0, "scale": 0.8,
           "easing": {"opacity": "ease-out", "scale": {"type": "spring", "stiffness": 170, "damping": 20, "mass": 1}}},
          {"at": 1, "opacity": 1, "scale": 1}
        ]
      }
    },
    "show": {
      "sequence": [
        {"animation": "enter", "delay_ms": 200},
        {"parallel": ["exit-a", "exit-b"], "stagger_ms": 60}
      ]
    }
  }
}
```

References must exist; the example's exit assets must be declared by its author.
Children can be asset IDs, inline leaf animations or nested compositions. A leaf
has one stable target node ID. Sequence duration is the sum of child durations;
parallel duration is their maximum end, including each child's stagger and delay.
Before a clip starts, it contributes no values. Afterwards it retains its last
values. Later authored clips win overlapping properties; disjoint channels combine.
Across separate playbacks, the most recently commanded playback wins each overlap.
There is no implicit additive blend. Stop rewinds that playback; cancel removes it
and source values are restored for properties no remaining playback supplies.

`motion_path: {points: [[x,y],...], orient: true, easing: "ease-in-out"}` defines
cubic travel with `3n+1` control points. Coordinates are translation offsets from
the source position. Optional `pathProgress` keyframes drive travel independently.
Orientation follows the tangent; translation keyframes cannot also own that path.
Multiple curves use equal parameter intervals, not constant arc-length velocity.

## Channels and bounded effects

- `translateX/Y` (aliases `x/y`), `rotation` (alias `rotate`), `scale`, `scaleX/Y`,
  `skewX/Y`, `anchorX/Y`. Anchors are relative to node dimensions, default 0.5.
- `opacity`, `blur`, `backdropBlur`; `filter` supports blur only.
- `fill` on shapes, `background` on frames, `strokeColor/Width` on an authored stroke.
- `shadowColor/Blur/X/Y/Spread` manipulate the first authored `shadow` entry through
  exact retained scalar `shadow.0.*` bindings. Other shadows remain unchanged.
- `waveAmplitude/Phase/Wavelength/Harmonic` deform whole fill/stretch images using
  shared texture vertices. Source crops and arbitrary deformation are unsupported.
- `pathData` morphs explicitly corresponding absolute SVG M/L/C/Q/Z commands on
  single `geometry:"path"` shape nodes. Curves, subpaths and closure must match
  between adjacent keys; correspondence is authored and never guessed. Endpoints
  retain exact strings; intermediate coefficients interpolate with the same curves.
  Relative/arc/implicit commands must be normalized by the author first. Limits:
  32768 characters, 1024 commands, 4096 coordinates per key; 2 MiB of path keys per
  catalogue. `paths` arrays are not this channel's target.
- `trimStart/End` fractions (0/1 defaults) bind `x-vision.trimStart/End` and reveal
  strokes by flattened arc length in Vision. Fill stays complete, reversed/empty
  intervals draw no stroke, and full intervals preserve closed joins. Multiple
  contours share one interval per geometry path; no wrap or dash offset is implied.

The nested canonical `transform: {translate:[x,y],scale:number|[sx,sy],rotate}` and
`filter:{blur}` keyframe shapes normalize to those channels. Hex 3/4/6/8 and numeric
rgb/rgba colors interpolate RGBA in sRGB. Named/HSL/OKLCH colors are not supported
by the timeline parser. Constrained channels clamp spring overshoot to valid render
ranges; position/rotation keep overshoot. These duration-bounded analytical spring
segments finish exactly at their authored endpoint. They do not implement the LSML
value-change spring's velocity-carrying retargeting behavior.

Limits: at most 512 catalogue entries, 16 composition levels, 2048 expanded clips
per plan, 32768 authored keyframe points per catalogue, 64 cubic path segments,
10 minutes per composed plan, speed 0.01–16, at most 10000 finite iterations.
Infinite looping remains bounded in retained state and stops on cancellation or
scene teardown. Scale 0–64, skew ±88°, anchor ±16, blur/stroke 0–256 pixels and
wave limits are validated before play. Invalid command batches preserve existing
playback state; native LSDP source admission remains a separate upstream boundary.

## Commands and host lifecycle

```json
{"animation_id":"show","command_id":"unique-42","action":"play","speed":1,"iterations":2,"direction":"alternate"}
```

Submit as a native mutation of `/defaults/__animation.show`. Action defaults to
`play`. `seek` takes `time_ms` over the total repeated timeline. `speed` takes a
positive multiplier. `reverse` reverses the current traversal without a jump.
Pause keeps pixels; seek while paused submits new pixels and remains paused.
Command identities deduplicate unchanged native defaults. Source/catalogue identity
changes reset playback; ordinary structural mutations retain the current frame.
RAF progress uses elapsed time; no catch-up pile of old frames accumulates.

A newly connected renderer has no historical playhead: a retained play starts
again, pause/stop initialize at the first declared boundary, reverse at the final
boundary, and seek supplies an explicit position. Cross-renderer synchronization,
durable playback snapshots and command/render acknowledgement back to Blue require
an upstream control contract. Existing Blue play envelopes remain compatible;
the demo's controls prove the native LSDP path, not a live Blue program execution.

## Compatibility and remaining work

Other-repository contract audited: Lumencast Protocol LSML-1 specification §6.
Standard primitive keyframes run on mount/key change and require endpoints 0/1.
The experimental document catalogue/compositions, curves and GPU `x-vision.*`
properties extend that contract locally. They are not a claim of complete LSML
animation-profile compatibility. Unsupported timeline channels fail explicitly.

Remaining substantial capabilities: `animate`/`bindAnimate` value-change transitions
with velocity continuity; scoped repeater staggering; animated text colors and
gradient stops; multiple shadow-track selection; arbitrary mask/path topology morphing; mesh topology
and arbitrary shader effects; expressions/constraints/parent linking; additive
layer blending; synchronized clocks and playback snapshots; motion blur/temporal
sampling; a Prism authoring/export bridge and visual curve/timeline editor.
Prism already has its own editor runtime, sequence/parallel trees and authoring
stores. Those remain separate editor authorities; they are not copied into Solar
and their export/live bridge is not qualified by this patch.

Vision's GPU affine extension applies to every retained node and its descendants.
The diagnostic CPU renderer rejects non-default affine motion explicitly, as it
already does for the wave extension. No alternate browser renderer is introduced.
This is a usable composed motion foundation; full After Effects/Jitter feature
parity would require the remaining primitives and authoring/control integrations.

## Validation

Unit tests check composition, overlaps, discontinuities, springs, colors, paths,
binding authority, malformed authoring, rollback, loops and lifetime. Rust tests
check retained parent/child matrices, effects, exact shadow bindings and failed
graph-update rollback. Generated WASM bytes are pinned in Solar.
The composed fixture's actual-canvas capture checks endpoints, identical replay,
one scene load, errors and submitted cadence. A separate controls capture checks
pause/seek/resume/speed/reverse/alternate/stop/cancel against real canvas pixels.
These are local browser measurements, not physical scanout, Pulsar CEF Program,
remote CI or live Blue end-to-end evidence.

The subsequent OpenAI reference reconstruction uses no supplied SVG, font, image
sequence or playback video. ffmpeg extracts the user recording at measured times;
the local vectorizer rebuilds symbol/letter contours and authored LSML describes
line-to-arc-to-brin morphs, reveal, placement and fragment assembly. Manual timing,
prepared path correspondence and a short silhouette handoff remain intentional
limits: this is a reconstruction from reference, not automatic arbitrary video-to-LSML.
The shape adapter also reuses accepted meshes during presentation-only updates.
Open paths now terminate explicitly before tessellation instead of leaving the
builder active. CPU diagnostics reject non-default stroke trim explicitly.
