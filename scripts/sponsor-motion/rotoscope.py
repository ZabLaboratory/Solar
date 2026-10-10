"""Reference-specific vector rotoscope, not semantic animation inference.

Usage: rotoscope.py <source.mp4> <explicit-fixture-directory>
Only contour coordinates and their timestamps enter LSML; source pixels, cursor
and video controls are not playback assets. Keeps measured bounce/rotation poses.
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path
import cv2
import numpy as np
from scipy.optimize import linear_sum_assignment

source, output = Path(sys.argv[1]), Path(sys.argv[2])
output.mkdir(parents=True, exist_ok=True)
width, height, fps = 1280, 720, 30
raw = subprocess.check_output([
    "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(source),
    "-vf", "fps=30,crop=1280:720:4:5", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"
])
frames = np.frombuffer(raw, np.uint8).reshape(-1, height, width)
duration = len(frames) * 1000 / fps
tracks = []
previous = []
for frame_index, pixels in enumerate(frames):
    clean = pixels.copy()
    clean[665:] = 0  # video player chrome lies below the actual artwork
    if frame_index < 70:
        clean[:160, 590:650] = 0  # early recording cursor, before knot arrival
    if 70 <= frame_index < 127:
        cursor_mask = np.zeros_like(clean)
        cv2.fillPoly(cursor_mask, [np.array([[705,354],[733,379],[722,379],[728,394],[719,399],[712,383],[704,390]])], 255)
        clean = cv2.inpaint(clean, cursor_mask, 5, cv2.INPAINT_TELEA)
    enlarged = cv2.resize(clean, None, fx=2, fy=2, interpolation=cv2.INTER_LINEAR)
    mask = np.uint8(enlarged >= 128) * 255
    contours, hierarchy = cv2.findContours(mask, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    current = []
    if hierarchy is not None:
        for index, contour in enumerate(contours):
            area = abs(cv2.contourArea(contour)) / 4
            if area < 1.5:
                continue
            parent, depth = hierarchy[0][index][3], 0
            while parent >= 0:
                depth += 1
                parent = hierarchy[0][parent][3]
            ring = contour.reshape(-1, 2).astype(float) / 2 + .25
            centre = ring.mean(axis=0)
            if frame_index < 16 and area < 110 and centre[0] > 610:
                continue  # moving cursor before it reaches its stationary position
            # Remove cursor islands and small cursor punctures in the knot.
            if area < 110 and 698 < centre[0] < 735 and 350 < centre[1] < 405:
                continue
            current.append({"ring": ring, "area": area, "centre": centre, "hole": depth % 2})
    costs = np.full((len(previous), len(current)), 1e6)
    for a, old in enumerate(previous):
        for b, new in enumerate(current):
            distance = np.linalg.norm(old["centre"] - new["centre"])
            ratio = abs(np.log((new["area"] + 8) / (old["area"] + 8)))
            if old["hole"] == new["hole"] and distance < 180 and ratio < 3.5:
                costs[a, b] = distance + 24 * ratio
    assigned = {}
    if costs.size:
        for a, b in zip(*linear_sum_assignment(costs)):
            if costs[a, b] < 170:
                assigned[b] = previous[a]["track"]
    for index, item in enumerate(current):
        if index not in assigned:
            assigned[index] = len(tracks)
            tracks.append({"hole": item["hole"], "samples": []})
        item["track"] = assigned[index]
        tracks[item["track"]]["samples"].append((frame_index, item["ring"]))
    previous = current

def resample(ring, count):
    ends = np.roll(ring, -1, axis=0)
    lengths = np.linalg.norm(ends - ring, axis=1)
    distances = np.r_[0, np.cumsum(lengths)]
    positions = np.linspace(0, distances[-1], count, endpoint=False)
    indices = np.clip(np.searchsorted(distances, positions, side="right") - 1, 0, len(ring)-1)
    weights = (positions - distances[indices]) / np.maximum(lengths[indices], 1e-9)
    return ring[indices] + (ends[indices] - ring[indices]) * weights[:, None]

def path(points):
    def fmt(value):
        return str(round(float(value), 1)).removesuffix(".0")
    return " ".join(("M" if i == 0 else "L") + fmt(p[0]) + " " + fmt(p[1]) for i, p in enumerate(points)) + " Z"

def simplify_motion(samples, tolerance=.35):
    """Bound worst per-vertex interpolation error; preserve overshoot extrema."""
    keep = {0, len(samples)-1}
    keep.update(i for i,s in enumerate(samples) if 90 <= s[0] <= 112 or 134 <= s[0] <= 177)
    def interval(first, last):
        if last-first < 2:
            return
        a, b = samples[first], samples[last]
        maximum, chosen = 0, None
        for i in range(first+1, last):
            phase = (samples[i][0]-a[0]) / (b[0]-a[0])
            expected = a[1] + (b[1]-a[1])*phase
            error = np.linalg.norm(samples[i][1]-expected, axis=1).max()
            if error > maximum:
                maximum, chosen = error, i
        if maximum > tolerance:
            keep.add(chosen)
            interval(first, chosen)
            interval(chosen, last)
    interval(0, len(samples)-1)
    return [samples[i] for i in sorted(keep)]

authored = []
characters = 0
for index, track in enumerate(tracks):
    samples = track["samples"]
    perimeter = max(np.linalg.norm(np.roll(r, -1, axis=0) - r, axis=1).sum() for _, r in samples)
    count = max(8, min(950, int(np.ceil(perimeter / 2.6))))
    keys = []
    last = None
    aligned = []
    for frame_index, ring in samples:
        points = resample(ring, count)
        if last is not None:
            # Match cyclic contour parameterization, preserving measured movement.
            old = last - last.mean(axis=0)
            new = points - points.mean(axis=0)
            correlations = np.fft.ifft(np.fft.fft(new[:, 0]) * np.conj(np.fft.fft(old[:, 0])) +
                np.fft.fft(new[:, 1]) * np.conj(np.fft.fft(old[:, 1]))).real
            points = np.roll(points, -int(np.argmax(correlations)), axis=0)
        else:
            points = np.roll(points, -int(np.argmin(points.sum(axis=1))), axis=0)
        last = points
        aligned.append((frame_index, points))
    for frame_index, points in simplify_motion(aligned):
        data = path(points)
        # Contour births/merges have no trustworthy inferred correspondence.
        # Reproduce the recording's 30Hz poses there, never tween a filled blob.
        easing = "hold" if 90 <= frame_index <= 112 or 134 <= frame_index <= 177 else "linear"
        key = {"at": frame_index / len(frames), "pathData": data, "opacity": 1, "easing": easing}
        if len(keys) >= 2 and keys[-1]["pathData"] == data and keys[-2]["pathData"] == data:
            keys[-1] = key
        else:
            keys.append(key)
    start, end = samples[0][0], samples[-1][0]
    if start:
        keys.insert(0, {"at": (start-1) / len(frames), "pathData": keys[0]["pathData"], "opacity": 0, "easing": "hold"})
        if start > 1:
            keys.insert(0, {"at": 0, "pathData": keys[0]["pathData"], "opacity": 0, "easing": "hold"})
    if end < len(frames)-1:
        keys[-1]["easing"] = "hold"
        keys.append({"at": (end+1) / len(frames), "opacity": 0, "easing": "hold"})
    keys.append({"at": 1, "opacity": 1 if end == len(frames)-1 else 0})
    characters += sum(len(k.get("pathData", "")) for k in keys)
    authored.append({"id": f"contour-{index}", "hole": track["hole"], "points": count, "steps": keys})

result = {"width": width, "height": height, "duration_ms": duration, "tracks": authored,
    "reference": {"sha256": hashlib.sha256(source.read_bytes()).hexdigest(), "frames": len(frames),
    "fps": fps, "crop": [4, 5, width, height], "artwork_bottom": 665,
    "cursor_exclusions": [[590, 0, 650, 160], [698, 350, 735, 405]],
    "cursor_periods_frames": [[0, 70], [0, 127]],
    "moving_cursor_frames": [0, 16],
    "topology_hold_frames": [[90, 112], [134, 177]],
    "method": "subpixel contours, arc-length correspondence, measured 30fps vector key poses; no semantic rig inference"},
    "path_characters": characters}
output.joinpath("motion-vectors.json").write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")
print(json.dumps({"tracks": len(authored), "frames": len(frames), "path_characters": characters,
    "max_points": max(t["points"] for t in authored), "duration_ms": duration}))
