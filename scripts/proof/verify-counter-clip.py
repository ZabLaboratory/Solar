"""Read every pixel counter in the exported 1-second CEF video independently.

The full recording analyzer checks the scene and extracts consecutive frames.
This second check decodes the actual exported media, OCRs all 60 frames without
reusing previous readings, and compares them with the original recording.
"""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

import cv2
import pytesseract

parser = argparse.ArgumentParser()
parser.add_argument("--prefix", required=True)
args = parser.parse_args()
prefix = Path(args.prefix)
source = json.loads(Path(str(prefix) + "-video-counter.json").read_text(encoding="utf-8"))
clip = Path(source["oneSecond"]["path"])
pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
probe = json.loads(subprocess.check_output([
    "ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0",
    "-show_entries", "stream=nb_read_frames,r_frame_rate,duration", "-of", "json", str(clip),
]))
cap = cv2.VideoCapture(str(clip))
values = []
while True:
    ok, frame = cap.read()
    if not ok:
        break
    text = pytesseract.image_to_string(
        frame[690:775, 470:1300],
        config="--psm 7 -c tessedit_char_whitelist=0123456789/",
    ).strip()
    match = re.fullmatch(r"(\d{1,4})/0512", text)
    value = int(match[1]) if match and int(match[1]) <= 512 else None
    values.append(value)
cap.release()
checks = {
    "oneSecond60FPS": probe["streams"][0]["r_frame_rate"] == "60/1"
        and abs(float(probe["streams"][0]["duration"]) - 1) < .001,
    "exactly60Frames": len(values) == 60 and probe["streams"][0]["nb_read_frames"] == "60",
    "allReadable": all(value is not None for value in values),
    "sixtyDistinctStates": len({value for value in values if value is not None}) == 60,
    "strictlyIncreasing": all(a is not None and b is not None and a < b
        for a, b in zip(values, values[1:])),
    "matchesConsecutiveSourceFrames": values == source["oneSecond"]["counterValues"],
}
report = {
    "schema": "solar.counter-clip-verification.v1",
    "result": "PASS" if all(checks.values()) else "FAIL",
    "method": "independent OCR of every exported frame; no reading reuse",
    "path": str(clip), "sha256": hashlib.sha256(clip.read_bytes()).hexdigest(),
    "probe": probe, "checks": checks, "counterValues": values,
    "distinctMutationStates": len({value for value in values if value is not None}),
    "unreadableFrames": sum(value is None for value in values),
}
Path(str(prefix) + "-clip-verification.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps(report))
raise SystemExit(0 if report["result"] == "PASS" else 1)
