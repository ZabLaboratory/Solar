"""Independently decode the already captured WASM canvas; starts no GPU host."""
import hashlib
import json
import sys
from pathlib import Path
from PIL import Image

report_path, image_path, output_path = map(Path, sys.argv[1:4])
report_bytes = report_path.read_bytes()
image_bytes = image_path.read_bytes()
assert hashlib.sha256(report_bytes).hexdigest() == "976bdb6c91c0ebf1b327667571478663ec517893cfbd192499694f4b0a8d818c"
assert hashlib.sha256(image_bytes).hexdigest() == "d53c711d79416e971c714cde8e39d92e8e46e6ee5cb7ad16c9d2873756d74977"
report = json.loads(report_bytes)
proof = report["maskPixelProof"]
checks = []
with Image.open(image_path) as image:
    rgb = image.convert("RGB")
    assert list(rgb.size) == proof["canvasScreenshotSize"]
    for name, sample in proof["samples"].items():
        actual = list(rgb.getpixel(tuple(sample["image"])))
        expected = [12, 17, 25] if name in ("nestedFrameClip", "rootFrameClip") else [133, 136, 140]
        assert actual == sample["rgb"], (name, actual, sample)
        error = max(abs(a - b) for a, b in zip(actual, expected))
        assert error <= 1, (name, actual, expected)
        checks.append({"name": name, "point": sample["image"], "decoded": actual, "expected": expected, "maxChannelError": error})
assert len(checks) == 5
output_path.write_text(json.dumps({"passed": True, "checks": checks, "limits": "Independent PNG verification of five actual browser canvas pixels; no physical presentation or CEF/LSDP chain proof."}, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"passed": True, "pixels": len(checks)}))
