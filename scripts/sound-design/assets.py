"""Original deterministic sound assets, not recordings of an external work."""
from pathlib import Path
import sys
import wave

import numpy as np
from scipy.signal import butter, sosfilt

output = Path(sys.argv[1])
output.mkdir(parents=True, exist_ok=True)
rate = 48000
rng = np.random.default_rng(20261010)


def save(name, data):
    if data.ndim == 1:
        data = np.stack([data, data], axis=1)
    data = np.clip(data, -.94, .94)
    with wave.open(str(output / f"{name}.wav"), "wb") as file:
        file.setnchannels(2)
        file.setsampwidth(2)
        file.setframerate(rate)
        file.writeframes((data * 32767).astype("<i2").tobytes())


def time(seconds):
    return np.arange(round(seconds * rate)) / rate


def edge(t, duration, attack=.012, release=.04):
    return np.minimum(1, np.minimum(t / attack, (duration - t) / release)).clip(0)


t = time(15)
music = np.zeros((len(t), 2))
# A restrained minor-ninth pad evolving into an open suspended chord.
for j, frequency in enumerate([130.8128, 155.5635, 195.9977, 246.9417, 293.6648]):
    phase = 2 * np.pi * frequency * t + .14 * np.sin(2 * np.pi * .18 * t + j)
    voice = (.048 * np.sin(phase) + .009 * np.sin(phase * 2.001))
    voice *= (.72 + .28 * np.sin(2 * np.pi * .07 * t + j)) * edge(t, 15, 1.8, 2)
    music[:, 0] += voice * (1 - j * .07)
    music[:, 1] += voice * (.7 + j * .07)
for index, start in enumerate(np.arange(2.8, 11.9, .43)):
    local = t - start
    active = local >= 0
    f = [523.25, 622.25, 783.99, 987.77, 1174.66][index % 5]
    note = .065 * np.sin(2 * np.pi * f * local) * np.exp(-local.clip(0) * 6) * active
    note *= np.minimum(1, local.clip(0) / .004)
    music[:, index % 2] += note
save("music", music)

t = time(1.2)
noise = sosfilt(butter(3, [700, 8500], btype="bandpass", fs=rate, output="sos"), rng.normal(size=len(t)))
envelope = np.sin(np.pi * t / 1.2) ** 2
chirp = np.sin(2 * np.pi * (100 * t + 950 * t ** 2))
save("sweep", np.stack([noise * envelope * .23 + chirp * .045 * envelope,
    np.roll(noise, 380) * envelope * .23 + chirp * .04 * envelope], axis=1))
t = time(.16)
save("tick", (.23 * np.sin(2 * np.pi * 1800 * t) + .08 * rng.normal(size=len(t))) * np.exp(-t * 65) * edge(t, .16, .002, .025))
t = time(.9)
spark = sum(np.sin(2 * np.pi * f * t) * a for f, a in [(780,.12),(1240,.055),(1930,.035),(3100,.02)]) * np.exp(-t * 6) * edge(t,.9,.002,.05)
save("spark", spark)
t = time(2)
impact = (.38 * np.sin(2 * np.pi * (62 * t + 13 * (1 - np.exp(-t * 10)))) * np.exp(-t * 6)
    + .13 * np.sin(2 * np.pi * 392 * t) * np.exp(-t * 3)
    + .09 * np.sin(2 * np.pi * 587.33 * t) * np.exp(-t * 4)) * edge(t,2,.003,.1)
save("lock", impact)
t = time(5)
orbit = sum(.035 * np.sin(2 * np.pi * f * t + .7 * np.sin(2 * np.pi * (.32 + i * .06) * t))
    for i, f in enumerate([261.63,392,523.25,783.99])) * edge(t,5,.5,.7)
save("orbit", np.stack([orbit, np.roll(orbit, 580)], axis=1))
t = time(1.25)
impulse = rng.normal(size=(len(t), 2)) * np.exp(-t[:, None] * 6) * .028
impulse[0, :] = .2
save("room", impulse)
print(f"Wrote seven original stereo PCM16/48kHz assets to {output}")
