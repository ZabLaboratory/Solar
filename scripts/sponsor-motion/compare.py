"""Compare real Solar endpoints to supplied images; never modify source assets."""
import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image

root = Path(__file__).resolve().parents[2]
evidence = root / "evidence/local-20261010-sponsor-motion/eleven"
stamp = sys.argv[1]
output = Path(sys.argv[2]).resolve()
report = {}
for name, source, shot in [("start", "w.png", "before.png"), ("end", "hello-fresh.png", "after.png")]:
    original = Image.open(root / "fixtures/sponsor-motion" / source).convert("RGBA")
    backdrop = Image.new("RGBA", original.size, "black")
    backdrop.alpha_composite(original)
    expected = np.asarray(backdrop.convert("RGB").resize((720, 720), Image.Resampling.BILINEAR), dtype=np.int16)
    actual = np.asarray(Image.open(evidence / f"{stamp}-{shot}").convert("RGB"), dtype=np.int16)
    delta = np.abs(expected - actual)
    report[name] = {"mean_absolute_error": float(delta.mean()), "max": int(delta.max()), "fraction_channels_within_3": float(np.mean(delta <= 3))}
    report[name]["passed"] = report[name]["fraction_channels_within_3"] > .995
report["replay_identical"] = Image.open(evidence / f"{stamp}-after.png").tobytes() == Image.open(evidence / f"{stamp}-replay-after.png").tobytes()
output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps(report))
assert all(report[n]["passed"] for n in ["start", "end"]) and report["replay_identical"]
