# Sound design demonstration

Owner: Solar sound qualification. Retained development example for the scene
sound extension. Reuses the accepted Kumiki choreography without changing its
visual source. Review retention when a shared motion/sound authoring catalogue exists.

`assets.py <fixture-directory>/assets` creates seven original deterministic stereo
48kHz PCM16 assets: score, sweep, click, spark, lock, resonance bed and room impulse.
`generate.mjs <fixture-directory>` embeds those exact hashed files into LSMLZ and
declares five buses, nested cue composition, envelopes, pan, filters, delay,
convolution, saturation, compression and cue-authored music ducking.

Use `fixtures/sound-design`, then `npm run build`. Set `SPONSOR_MOTION_PORT=4610`
and the verified `SPONSOR_LSDP_BIN`, and reuse
`node scripts/sponsor-motion/serve.mjs fixtures/sound-design`.
The native sound handle supports unlocking, metering, MediaStream capture and
PCM export. Browser autoplay policy may require the reader's play gesture.
This demonstrates scene sound in Solar's web host, not native Rust audio-device
output, VST plugins, dynamic detector sidechain or qualified Pulsar Program audio.

`prove.mjs <evidence-directory>` uses Playwright from `SPONSOR_PLAYWRIGHT_ROOT`
against this already-running owned host. Run it alone: it drives shared producer
state. It records the actual native front canvas with the live audio MediaStream,
exports a separate offline WAV, measures PCM and tests pause/seek/resume/speed/
reverse/mute/effect mix/stop without a Vision scene reload. No permissive autoplay
flag is used: the reader's actual play click unlocks sound. Evidence paths and the
browser session are owned; the script closes only its browser.

`export.py <fixture-directory> <evidence-directory> <artifact-directory> <stamp>`
transcodes the captured live video/audio to VFR MP4/AAC, measures decoded recorded
PCM, delivers the independent offline WAV and scene/package/assets, and hashes
the output. It never substitutes offline sound into the live video recording.
