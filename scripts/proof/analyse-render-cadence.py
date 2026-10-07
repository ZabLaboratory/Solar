"""Separate accepted transactions, LSML reception, completed frames and video pixels.

Windows start at the producer's recorded epoch, never at a selected best frame.
Camera-only renders do not count. A covering receipt follows the actual Vision
submission and front-canvas copy; it does not measure physical screen scan-out.
"""
import argparse
import json
from pathlib import Path
from statistics import median

parser = argparse.ArgumentParser()
parser.add_argument("--prefix", required=True)
parser.add_argument("--minimum-per-second", type=int, default=120)
args = parser.parse_args()
prefix = Path(args.prefix)
report = json.loads(Path(str(prefix) + "-report.json").read_text(encoding="utf-8-sig"))
browser = json.loads(Path(report["telemetryPath"]).read_text(encoding="utf-8-sig"))["browser"]
producer = report["producer"]
start = producer["startedEpochMs"]
receipts = producer["receipts"]
by_id = {row["id"]: row for row in receipts}
by_hash = {row["stateHash"]: row for row in receipts}
received = [row for row in browser["events"] if row["type"] == "received" and row.get("transactionId") in by_id]
covered = [row for row in browser["events"] if row["type"] == "applied" and row.get("transactionId") in by_id and row.get("presentation")]
completed = {}
for row in covered:
    presentation = row["presentation"]
    state = by_hash[presentation["stateHash"]]
    key = presentation["throughSequence"]
    completed.setdefault(key, {"counter": state["counter"], "stateHash": state["stateHash"],
        "throughSequence": key, "epochMs": row["epochMs"],
        "sentToCompleteMs": row["epochMs"] - state["sentEpochMs"],
        "ackToCompleteMs": row["epochMs"] - state["epochMs"]})
frames = sorted(completed.values(), key=lambda row: row["epochMs"])
patches = [row for row in browser["vision"] if row["type"] == "frame-submitted" and row.get("patch") and row["epochMs"] >= start]
duration = producer.get("pacedDurationMs") or producer["nativeDrainMs"]

def window(offset, width):
    lower, upper = start + offset, start + offset + width
    inside = lambda row: lower <= row["epochMs"] < upper
    return {"offsetMs": offset, "durationMs": width,
        "nativeAppliedACKs": sum(inside(row) for row in receipts),
        "sequentialLSMLReceived": sum(inside(row) for row in received),
        "VisionPatchSubmissions": sum(inside(row) for row in patches),
        "completedDistinctMutationFrames": sum(inside(row) for row in frames),
        "completedCounters": [row["counter"] for row in frames if inside(row)]}

seconds = [window(index * 1000, 1000) for index in range(int(duration // 1000))]
hundreds = [window(index * 100, 100) for index in range(int(duration // 100))]
timings = [row["timing"] for row in patches]
capacity = bool(seconds) and all(row["completedDistinctMutationFrames"] >= args.minimum_per_second for row in seconds)
result = {"schema": "solar.render-cadence-proof.v1", "runtimeResult": report["runtimeResult"],
    "criterion": f"at least {args.minimum_per_second} completed distinct mutation frames in every fixed complete 1000 ms window",
    "capacityResult": "PASS" if report["runtimeResult"] == "PASS" and capacity else "FAIL",
    "boundary": "actual Vision GPU submission followed by complete front-canvas copy and covering receipt; physical scan-out not measured",
    "nativeCore": report["nativeCore"],
    "producer": {key: producer[key] for key in ("mode", "transactionCount", "startedEpochMs", "preparationMs", "enqueueMs", "nativeDrainMs", "pacedDurationMs", "pacing")},
    "totals": {"nativeAppliedACKs": len(receipts), "sequentialLSMLReceived": len(received),
        "coveredTransactions": len(covered), "VisionPatchSubmissions": len(patches),
        "completedDistinctMutationFrames": len(frames)},
    "timingsMedianMs": {"engineApply": median(row["engineApplyCallMs"] for row in timings),
        "engineRender": median(row["gpuSubmitCallMs"] for row in timings),
        "lastStateSentToCompletedFrame": median(row["sentToCompleteMs"] for row in frames)},
    "fixedSeconds": seconds, "fixed100ms": hundreds, "completedFrames": frames,
    "videoBoundary": "encoded pixel states are measured separately; a 60 fps recording cannot prove 120 physical presentations/s"}
Path(str(prefix) + "-cadence.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps({key: result[key] for key in ("capacityResult", "totals", "fixedSeconds", "timingsMedianMs")}, indent=2))
