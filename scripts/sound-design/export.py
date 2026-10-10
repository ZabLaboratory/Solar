"""Deliver actual native A/V and independent offline PCM to an explicit directory."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import wave
import numpy as np

fixture, evidence, output = map(Path, sys.argv[1:4])
stamp = sys.argv[4]
output.mkdir(parents=True, exist_ok=True)
proof = json.loads((evidence / f"{stamp}-proof.json").read_text())
for extension in ("lsml", "lsmlz"):
    shutil.copyfile(fixture / f"sponsor-motion.{extension}", output / f"kumiki-sound-design.{extension}")
shutil.copyfile(evidence / f"{stamp}-kumiki-score.wav", output / "kumiki-score.wav")
shutil.copyfile(evidence / f"{stamp}-proof.json", output / "proof.json")
shutil.copyfile(evidence / f"{stamp}-settled.png", output / "settled.png")
subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i",
    str(evidence / f"{stamp}-kumiki-sound.webm"), "-c:v", "libx264", "-crf", "18",
    "-pix_fmt", "yuv420p", "-fps_mode", "vfr", "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart", str(output / "kumiki-sound-design.mp4")], check=True)
live_path = evidence / f"{stamp}-live-decoded.wav"
subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i",
    str(evidence / f"{stamp}-kumiki-sound.webm"), "-vn", "-c:a", "pcm_s16le",
    str(live_path)], check=True)
with wave.open(str(live_path)) as stream:
    rate, channels = stream.getframerate(), stream.getnchannels()
    samples = np.frombuffer(stream.readframes(stream.getnframes()), dtype="<i2").astype(np.float64) / 32768
live = {"sample_rate": rate, "channels": channels, "seconds": len(samples) / rate / channels,
    "rms": float(np.sqrt(np.mean(samples**2))), "peak": float(np.max(np.abs(samples))),
    "clipped_samples": int(np.count_nonzero(np.abs(samples) >= .999)),
    "nonzero_samples": int(np.count_nonzero(samples))}
if live["rms"] < .005 or live["clipped_samples"]:
    raise RuntimeError(f"Recorded PCM quality gate failed: {live}")
(evidence / f"{stamp}-recorded-pcm.json").write_text(json.dumps(live, indent=2), encoding="utf-8")
(output / "README.md").write_text(f"""# Kumiki — original sound design

Open http://127.0.0.1:4610/ and click play to unlock browser audio.
The 15-second vector choreography ends with the Kumiki wordmark and its two-line
signature. It has 58 composed cues, seven original stereo
assets and five DSP buses: score, noise sweeps, contact clicks, metallic sparks,
resonant lock, orbit bed and a seeded room impulse. Sources are PCM16/48kHz.

The MP4 transcodes the actual native Vision canvas + live Solar audio recording.
It does not substitute the offline WAV. Capture margins and variable frame timing
are preserved. The independent WAV exports the authored forward show at speed 1
plus 1.5 seconds of effects tail. All audio assets are inside LSMLZ; the readable
LSML refers to the supplied assets directory. No external music or sample is used.

Proof: {proof['loads']} retained Vision scene load; {max(s['scheduled'] for s in proof['live'])}
scheduled cues; eight control checks; no runtime errors; normal browser autoplay
policy unlocked by an actual play click. Recorded signal RMS {live['rms']:.6f},
peak {live['peak']:.6f}, {live['clipped_samples']} clipped PCM16 samples. See proof.json.

This is the experimental Solar `x-solar.audio` LSML extension using Web Audio.
Vision Rust remains graphics-only. It does not qualify Pulsar Program audio,
device latency or long-running A/V drift. Speed also changes pitch. No VST/AU,
dynamic detector sidechain or native standalone audio backend is implemented.
Live bus automation and clip sources/envelopes use the audio clock; cues are prequeued.
Pause/seek/reverse clear effect tails; scene admission is not yet cross-media atomic.
Blue may send reserved native animation/mix defaults; no Blue graph is executed here.
""", encoding="utf-8")
shutil.copytree(fixture / "assets", output / "assets", dirs_exist_ok=True)
manifest = {"scene_version": json.loads((fixture / "sponsor-motion.lsml").read_text())["scene_version"],
    "recorded_pcm": live, "offline_pcm": proof["offline"],
    "files": {str(p.relative_to(output)): {"bytes": p.stat().st_size, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
    for p in sorted(output.rglob("*")) if p.is_file() and p.name != "manifest.json"}}
(output / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
print(json.dumps({"output": str(output), "live": live, "files": len(manifest["files"])}))
