# Authored scene sound

Owner: Solar active-scene playback and browser audio. The native LSDP consumer
owns admission and lifecycle; `mount().audio` is the host boundary. This module
renders the explicit experimental `x-solar.audio` LSML extension. Vision Rust
still owns graphics only. Browser/Web Audio support is required.

`catalogue.ts` validates nested sequence/parallel/stagger cues, buses and bounded
automation. `assets.ts` verifies packaged bytes before browser decoding and owns
reverse PCM. `graph.ts` owns routing and DSP; `automation.ts` schedules future bus keys. `voice.ts` schedules clip offsets,
gain/pan envelopes and reverse sources on the audio sample clock. `controller.ts`
uses the exact accepted `MotionPlayback` transport, clears voices/tails when a
command changes, and admits only active-scene assets. `offline.ts` renders the
same graph to stereo 48kHz PCM without relying on GPU frame cadence.

The live scheduler wakes every 25ms, but prequeues up to 30 seconds of a finite
single play with at most 128 cues. Larger/looping shows have a 3-second horizon
subject to the voice budget. Audio sources, envelopes and bus automation use
AudioContext time; bus ramps are refreshed at most once per second (faster for
short loops), rather than posting constant targets every tick. Heavy starvation
can still exhaust the bounded horizon of larger/looping shows. Bus automation uses
the newest active show's phase when multiple shows share a bus. Offline export
uses one forward show at speed 1, authored bus settings and 1.5s of effect tail;
live mix overrides are excluded. Speed couples duration and pitch. Reverse is
waveform reversal, not a change in cue order only. Codec availability is browser
dependent. Compressed decode budgets are checked after decoding, not a native
decoder sandbox. Control hosts are silent unless explicitly enabled.

See [sound contract](../../../docs/development/sound-system.md),
[original study](../../../scripts/sound-design/README.md) and
`tests/unit/sound.test.ts`. The retained native/browser proof records actual PCM
and canvas capture. It does not qualify Pulsar Program routing or clock drift.
