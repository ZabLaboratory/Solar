# Composed retained motion

Owner: Solar scene playback. `timeline.ts` compiles authored catalogue and standard
primitive keyframes into bounded clips/tracks. `curves.ts` validates and compiles
tweens, holds, springs and color interpolation. `vector.ts` compiles authored
absolute SVG M/L/C/Q/Z correspondence for morphs. `player.ts` owns the single clock,
command admission and bounded GPU scheduling. The parent `animations.ts` projects
sampled channels through private bindings into the current Vision scene.

Consumer: `NativeLsdpRuntime` through `animations.ts`; package preparation installs
the bindings without changing source LSML/LSMLZ. Vision remains the sole renderer.
Plans and track searches are compiled/cached from immutable accepted source data.
Defaults changes do not recompile unchanged plans; mutable authoring objects must
be replaced before admission. Current state lives only for the active scene.

Invariants: staged whole command-batch validation; one outstanding submission;
wall-clock progress independent of frame count; per-channel composition instead
of whole-target replacement; deterministic authored/command precedence; cancel
restores source values; clear/dispose retires scheduled work. Completed state
survives ordinary structural edits and disappears on scene change. The GPU affine
extension preserves authored layout, including transformed child nodes.

Tests: `tests/unit/motion.test.ts` checks composition, curves, paths, malformed
plans, command rollback, controls, loops and lifecycle. `tests/unit/animations.test.ts`
checks source/binding projection and legacy play compatibility. Actual Solar
canvas evidence is produced by `scripts/sponsor-motion/capture.mjs` and
`scripts/sponsor-motion/controls.mjs`; unit tests do not prove presentation cadence.

See the [contract and audit](../../../docs/development/motion-system.md) for syntax,
supported effects, compatibility and limitations. This catalogue extension is
experimental and is not a complete implementation of every LSML animate directive.
