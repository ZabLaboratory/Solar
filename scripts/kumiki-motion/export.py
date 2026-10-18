"""Export an actual native capture and its authored scene to an explicit destination."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

fixture, evidence, output = map(Path, sys.argv[1:4])
capture_stamp, storyboard_stamp = sys.argv[4:6]
output.mkdir(parents=True, exist_ok=True)
for extension in ("lsml", "lsmlz"):
    shutil.copyfile(fixture / f"sponsor-motion.{extension}", output / f"kumiki-motion.{extension}")
report = json.loads((evidence / f"{capture_stamp}-capture.json").read_text())
shutil.copyfile(evidence / f"{capture_stamp}-capture.json", output / "capture.json")
shutil.copyfile(evidence / f"{storyboard_stamp}-vector-6300.png", output / "preview.png")
shutil.copyfile(evidence / f"{storyboard_stamp}-vector-15000.png", output / "settled.png")
subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i",
    str(evidence / f"{capture_stamp}-kumiki-unweave.webm"), "-c:v", "libx264", "-crf", "18",
    "-pix_fmt", "yuv420p", "-fps_mode", "vfr", "-movflags", "+faststart",
    str(output / "kumiki-motion.mp4")], check=True)
vectors = json.loads((fixture / "vectors.json").read_text())
paths = []
for index, band in enumerate(vectors["bands"]):
    data = "M" + " L".join(f"{x:.3f} {y:.3f}" for x, y in band) + " Z"
    paths.append(f'<path id="band-{index}" d="{data}"/>')
(output / "kumiki-mark.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg" '
    'viewBox="0 0 1254 1254" fill="#08090b">' + "".join(paths) + "</svg>\n")
(output / "README.md").write_text("""# Kumiki — Many systems. One motion.

Original 15-second five-act choreography: contour reveal, unweaving, wave ribbons
and orbital ballet, three-phase contact cascade, elastic reassembly and echo.

The LSML/LSMLZ contains only native vector nodes and animation declarations.
There is no baked video, image sequence, CSS animation or imported motion asset
in the scene. The MP4 is a variable-frame-rate recording of the actual Solar/Vision
canvas, with its real acquisition margins and presentation timing preserved.

Live reader: http://127.0.0.1:4600/?autoplay=1&loop=1
Pause, seek, speed, reverse and replay submit native LSDP commands.

The supplied three-band raster mark was traced into 256 points per band.
Thresholded source-space silhouette IoU is 0.997585; this measures the settled
contour only, not animation fidelity, antialiasing or physical display scanout.
The SVG is a reconstruction from that trace, not a recovered brand master.

Measured recording: 54.427 Vision frame submissions/s; errors: none; scene loads: 1.
Uninstrumented-by-encoder reader: 56.276 submissions/s, p95 23.3ms.
Seven native control checks passed. No real Blue execution is claimed.
""", encoding="utf-8")
manifest = {"scene_version": json.loads((fixture / "sponsor-motion.lsml").read_text())["scene_version"],
    "source_mark_sha256": vectors["source_sha256"], "capture": report["cadence"],
    "files": {p.name: {"bytes": p.stat().st_size, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
              for p in sorted(output.iterdir()) if p.is_file() and p.name != "manifest.json"}}
(output / "manifest.json").write_text(json.dumps(manifest, indent=2))
print(json.dumps({"output": str(output), "files": len(manifest["files"])}))
