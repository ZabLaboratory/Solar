# Authored sound system — experimental v1

Owner: Solar active-scene runtime. The renderer remains Vision Rust/GPU. Solar's
browser host owns sound through Web Audio, sharing MotionPlayback's accepted
play/pause/resume/seek/speed/reverse/stop/cancel commands. No second authored clock
or scene cache is introduced. `sceneAudio: true` opts a mount into playback;
served broadcast/test hosts enable it, control hosts remain silent. Browser policy
can require a user gesture: `handle.audio.resume()` unlocks the context. Embedded
players delegate autoplay and send the trusted `solar-unlock-audio` message.

The LSML extension `x-solar.audio` has `version: 1`, `assets`, `buses`, and `shows`.
Assets declare a safe package-local `assets/*.wav|mp3|ogg|flac|m4a|aac|webm` path
and exact lowercase SHA-256. Browser codecs determine what is decodable; WAV
PCM16/48kHz stereo is the demonstrated path. Decoding rejects missing bytes,
digest mismatch, nonfinite PCM, more than two channels and excessive size/duration.
Budgets: 32 assets; 16MiB per encoded asset / 64MiB total; 120s per asset;
128MiB decoded PCM including the live forward/reverse banks; 16 buses including
master, eight effects per bus, 128 scheduled voices, 2048 composition visits,
12 levels of nesting, 256 keys per automation channel. Offline exports are
limited to 120s plus 1.5s tail. Decode memory checks occur after compressed decode.

Every show names an existing animation. Its `timeline` recursively accepts
`sequence`, `parallel`, `delay_ms`, `stagger_ms`. A cue declares a unique `id`,
`asset`, optional `bus`, `duration_ms`, `offset_ms`, `source_duration_ms`, `rate`,
`loop`, `gain_db`, `pan`, `fade_in_ms`, `fade_out_ms` and `automation`. Cue-local
gain/pan keys are `{at_ms, value}` and interpolate linearly; gain values are dB.
All cues fit inside their motion show. Source regions stop at their trim boundary;
looped regions wrap inside that boundary. Reverse sources use reversed PCM and
the corresponding trim offsets. No independent pitch-preserving time stretch.

Buses have `output` (default master), `gain_db`, `pan`, `effects`, `automation`.
Master goes to the host output. Routing cycles and unknown buses are rejected.
Effects are filters, compressor, feedback delay, convolution reverb and saturation.
Filter kinds: lowpass/highpass/bandpass/notch/peaking/lowshelf/highshelf. Reverb
references a packaged impulse asset. Frequency automation targets the first
filter; wet automation targets the first wet effect and adjusts its dry complement.
These limits are deliberate; arbitrary DSP graphs and external plugins are absent.

The reserved LSDP default `__audio.mix` lets a producer change buses without
reloading graphics: `{music: {gain_db: -12, pan: .2, frequency: 1200}, space:
{wet: .15}, master: {mute: true}}`. Supported mix fields are gain_db, pan, mute,
frequency and wet. It replaces the override map; `{}` restores authored automation.
Overrides require the matching effect. Blue can emit these native LSML mutations;
this study uses the real LSDP producer endpoint and does not execute a Blue graph.

`handle.audio.status()` reports admission/context/transport and sampled signal.
`stream()` exposes the live authored scene mix for host recording/routing.
It excludes remote guest audio, which retains its separate liveAudio policy.
`render(animationId)` returns stereo AudioBuffer PCM from OfflineAudioContext.
Export is forward speed 1 with authored settings, excluding live overrides.

Evidence boundary: the study checks signal, scheduling, silence after pause/mute,
seek/resume, reverse, speed, effect mix, one retained Vision load, and a combined
native canvas/live audio recording. It does not prove broadcast Program capture,
preview monitoring, physical device latency, long-running A/V drift, standalone
Vision native device output, VST/AU hosting, streaming long-form audio, dynamic
sidechain detection, sample-exact live bus automation or DAW editing. Sound decode
currently occurs after visual scene activation, so cross-media scene admission is
not an atomic transaction. This extension needs that boundary and Program routing
qualification before a production release.
