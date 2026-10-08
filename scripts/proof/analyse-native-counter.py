"""Count actual CEF counter pixels; align PTS using the recorded live HUD clock.

No counter or frame is generated. The 1-second export selects 60 consecutive
source frames; the complete recording and OCR rows remain available as evidence.
"""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

import cv2
import numpy as np
import pytesseract

parser = argparse.ArgumentParser()
parser.add_argument("--prefix", required=True)
parser.add_argument("--final-deadline-ms", type=float, default=1000,
                    help="Explicit final-state deadline; the default preserves the 1-second burst criterion.")
parser.add_argument("--video-window-offset-ms", type=float, default=0,
                    help="Predetermined producer-relative 1-second export window; all original frames and first 100ms remain measured.")
parser.add_argument("--minimum-distinct-values", type=int, default=0,
                    help="Required actual encoded counter states in the 60-frame export; zero keeps the earlier scene-completeness criterion.")
args = parser.parse_args()
prefix = Path(args.prefix)
report_path = Path(str(prefix) + "-report.json")
report = json.loads(report_path.read_text(encoding="utf-8-sig"))
pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
video = report["video"]["path"]
cap = cv2.VideoCapture(video)
fps = cap.get(cv2.CAP_PROP_FPS)
assert abs(fps - 60) < .001, fps
rows, samples = [], []
last_mask, counter = None, None
calls = 0
reference = cv2.imread(str(prefix) + "-counter-zero.png")
assert reference is not None
panel_reference = reference[25:660, 475:1595]
panel_color = reference[620, 500].astype(np.int16)
assert np.min(panel_color) > 20 and np.max(panel_color) < 64, "Reference gray panel is missing"
panel_mask = np.max(np.abs(panel_reference.astype(np.int16) - panel_color), axis=2) <= 2
# Only flat surface interiors: screenshot/JPEG and video/YUV resample asset edges.
# Erosion removes those boundaries while still checking more than half a million
# unchanged background pixels; a missing panel remains a large contiguous failure.
panel_mask = cv2.erode(panel_mask.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
assert np.count_nonzero(panel_mask) > 100000, "Reference panel coverage is insufficient"
static_rows = []
while True:
    ok, frame = cap.read()
    if not ok:
        break
    index = len(rows)
    crop = frame[690:775, 470:1300]
    mask = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) > 190
    if last_mask is None or np.count_nonzero(mask != last_mask) > 20:
        text = pytesseract.image_to_string(crop, config="--psm 7 -c tessedit_char_whitelist=0123456789/").strip()
        found = re.fullmatch(r"(\d{1,4})/0512", text)
        counter = int(found[1]) if found and int(found[1]) <= 512 else None
        last_mask = mask
        calls += 1
    rows.append({"frame": index, "ptsSeconds": index / fps, "counter": counter})
    panel = frame[25:660, 475:1595].astype(np.int16)
    missing = np.max(np.abs(panel - panel_color), axis=2) > 12
    static_rows.append({"frame": index, "stableGrayFraction": float(1 - np.count_nonzero(missing & panel_mask) / np.count_nonzero(panel_mask))})
    # The live CEF HUD and scene counter share the same encoded composition.
    # Fit after the burst, when RAF is regular; zero is clamped before the start.
    if index % 15 == 0 and counter == 512:
        hud = frame[50:300, 1625:1898]
        text = pytesseract.image_to_string(hud, config="--psm 6")
        found = re.search(r"T\s*\+\s*(\d+)\s*ms", text)
        if found:
            elapsed = int(found[1])
            if elapsed > 1200:
                relative = elapsed + report["HUDStartEpochMs"] - report["producer"]["startedEpochMs"]
                samples.append({"frame": index, "elapsedMs": elapsed, "burstPTSSeconds": index / fps - relative / 1000})
    if index % 120 == 0:
        print("DECODED", index, "counter OCR", calls, flush=True)
cap.release()
assert len(samples) >= 5, "Recorded HUD clock could not establish an alignment"
offsets = np.array([value["burstPTSSeconds"] for value in samples])
start = float(np.median(offsets))
spread = float(np.max(np.abs(offsets - start)) * 1000)
uncertainty = 1000 / fps + spread + .5
for row in rows:
    row["relativeToBurstMs"] = (row["ptsSeconds"] - start) * 1000
window = [row for row in rows if 0 <= row["relativeToBurstMs"] < 100]
visible = sorted({row["counter"] for row in rows if row["counter"]})
timeline = []
for row in rows:
    if not timeline or timeline[-1]["counter"] != row["counter"]:
        timeline.append(row)
assert all(a <= b for a, b in zip(visible, visible[1:]))
readable = [row for row in rows if row["counter"] is not None]
assert all(a["counter"] <= b["counter"] for a, b in zip(readable, readable[1:])), "Counter went backwards in encoded video"
first_frame = max(0, int(np.floor((start + args.video_window_offset_ms / 1000) * fps)))
selected = rows[first_frame:first_frame + 60]
assert len(selected) == 60
target = Path(video).with_name(Path(video).stem + "-1s-60fps.mp4")
subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", video,
    "-vf", f"select=between(n\\,{first_frame}\\,{first_frame+59}),setpts=N/(60*TB)",
    "-frames:v", "60", "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "18",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(target)], check=True)
probe = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames,r_frame_rate,duration", "-of", "json", str(target)]))
assert probe["streams"][0]["nb_read_frames"] == "60"
assert abs(float(probe["streams"][0]["duration"]) - 1) < .001
result = {"video": video, "fps": fps, "decodedFrames": len(rows), "counterOCRCalls": calls,
    "staticScene": {"method": "flat reference gray interiors, 4-pixel edge margin and 12-level codec tolerance", "referenceBGR": panel_color.tolist(), "referencePixels": int(np.count_nonzero(panel_mask)),
        "minimumStableGrayFraction": min(row["stableGrayFraction"] for row in static_rows),
        "incompleteFrames": [row for row in static_rows if row["stableGrayFraction"] < .995]},
    "clockAlignment": {"method": "live HUD timestamp in the same recorded CEF frame", "samples": samples,
        "burstPTSSeconds": start, "maxFitSpreadMs": spread, "uncertaintyMs": uncertainty},
    "window100ms": {"encodedFrames": len(window), "values": [row["counter"] for row in window],
        "distinctMutationStates": len({row["counter"] for row in window if row["counter"]}),
        "unreadableFrames": sum(row["counter"] is None for row in window)},
    "firstNonzeroVisibleMs": next((row["relativeToBurstMs"] for row in rows if row["counter"]), None),
    "final512VisibleMs": next((row["relativeToBurstMs"] for row in rows if row["counter"] == 512), None),
    "distinctCountersWholeRecording": len(visible), "timeline": timeline,
    "oneSecond": {"path": str(target), "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
        "producerRelativeWindowOffsetMs": args.video_window_offset_ms,
        "probe": probe, "sourceFirstFrame": first_frame, "sourceLastFrame": first_frame + 59,
        "counterValues": [row["counter"] for row in selected],
        "distinctMutationStates": len({row["counter"] for row in selected if row["counter"]}),
        "unreadableFrames": sum(row["counter"] is None for row in selected)}, "frames": rows}
Path(str(prefix) + "-video-counter.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
report["videoCounterAnalysis"] = {key: value for key, value in result.items() if key != "frames"}
report["visualCriterion"] = {"finalDeadlineMs": args.final_deadline_ms,
                             "minimumDistinctValues": args.minimum_distinct_values,
                             "oneSecond": "60 consecutive source frames, no interpolation",
                             "staticSceneMinimum": .995}
final_in_time = result["final512VisibleMs"] is not None and result["final512VisibleMs"] <= args.final_deadline_ms
enough_distinct_values = result["oneSecond"]["distinctMutationStates"] >= args.minimum_distinct_values
report["visualResult"] = "PASS" if not result["staticScene"]["incompleteFrames"] and result["oneSecond"]["unreadableFrames"] == 0 and final_in_time and enough_distinct_values else "FAIL"
report["result"] = "PASS" if report["runtimeResult"] == "PASS" and report["visualResult"] == "PASS" else "FAIL"
report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
cap = cv2.VideoCapture(video)
for label, index in [("first-counter", next(row["frame"] for row in rows if row["counter"])),
                     ("100ms", max(row["frame"] for row in window)),
                     ("512", next(row["frame"] for row in rows if row["counter"] == 512))]:
    cap.set(cv2.CAP_PROP_POS_FRAMES, index)
    ok, frame = cap.read()
    if ok: cv2.imwrite(str(prefix) + "-encoded-" + label + ".png", frame)
cap.release()
print("PIXEL_PROOF", json.dumps({"visualResult": report["visualResult"], "fps": fps, "oneSecond": result["oneSecond"], "firstVisibleMs": result["firstNonzeroVisibleMs"], "final512VisibleMs": result["final512VisibleMs"], "staticMinimum": result["staticScene"]["minimumStableGrayFraction"], "incompleteFrames": len(result["staticScene"]["incompleteFrames"])}), flush=True)
