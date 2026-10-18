"""Decode persisted real browser captures without launching another GPU host."""
import hashlib
import json
import sys
from pathlib import Path
from PIL import Image

proof_path, output_path = map(Path, sys.argv[1:3])
proof_bytes = proof_path.read_bytes()
assert hashlib.sha256(proof_bytes).hexdigest() in {
    "c6f64c8619d57e0d5772baa9f5345cb28921ef1e617e1629889aa50b2bc1f589",
    "88fedc049b62fd8c0aecc20cfaa3f60230abc4dfb66d377a57ce1c735d1d1b63",
}
proof = json.loads(proof_bytes)
presenter_path = proof_path.with_name(proof["presenterCanvasCapture"]["file"])
raw_path = presenter_path.with_name(presenter_path.name.replace("presenter-mask-canvas", "wasm-frame-mask-canvas"))
with Image.open(raw_path) as source, Image.open(presenter_path) as presented:
    source = source.convert("RGB")
    presented = presented.convert("RGB")
    assert source.size == presented.size == (960, 540)
    assert source.tobytes() == presented.tobytes(), "Presenter and direct WASM canvas pixels differ"
    checks = []
    for name, sample in proof["maskPixelProof"]["samples"].items():
        actual = list(presented.getpixel(tuple(sample["image"])))
        expected = [12, 17, 25] if name in ("nestedFrameClip", "rootFrameClip") else [133, 136, 140]
        assert max(abs(a - b) for a, b in zip(actual, expected)) <= 1
        checks.append({"name": name, "point": sample["image"], "actual": actual, "expected": expected})
    assert len(checks) == 5
output_path.write_text(json.dumps({
    "passed": True,
    "proofSha256": hashlib.sha256(proof_bytes).hexdigest(),
    "rawCanvasSha256": hashlib.sha256(raw_path.read_bytes()).hexdigest(),
    "presenterCanvasSha256": hashlib.sha256(presenter_path.read_bytes()).hexdigest(),
    "exactRgbPixelsCompared": 960 * 540,
    "checks": checks,
    "limits": "Decoded persisted real browser PNGs. No new GPU host, physical output, CEF or installed runtime qualification.",
}, indent=2) + "\n", encoding="utf8")
print(json.dumps({"passed": True, "exactRgbPixelsCompared": 960 * 540, "expectedSamples": len(checks)}))
