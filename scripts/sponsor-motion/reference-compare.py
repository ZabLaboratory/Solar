"""Compare aligned actual Vision screenshots to the recording, never a mock renderer.
Usage: reference-compare.py <source.mp4> <capture-directory> <explicit-report.json>
"""
import json
import subprocess
import sys
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

source, captures, report_path = map(Path, sys.argv[1:4])
metadata = json.loads(captures.joinpath("captures.json").read_text(encoding="utf-8"))
raw = subprocess.check_output(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(source),
    "-vf", "fps=30,crop=1280:720:4:5", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"])
reference = np.frombuffer(raw, np.uint8).reshape(-1, 720, 1280)
rows = []
panels = []
selected = [0, 18, 24, 45, 51, 68, 82, 90, 96, 101, 105, 111, 117, 123, 128, 132, 138, 148, 158, 170, 190, 225]
encoder = None
label_font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 22)
if "--video" in sys.argv[4:]:
    encoder = subprocess.Popen(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "2560x752", "-r", "30", "-i", "pipe:0",
        "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", str(report_path.with_suffix(".mp4"))], stdin=subprocess.PIPE)
for entry in metadata["positions"]:
    index = entry["index"]
    actual = cv2.imread(str(captures / f"frame-{index:03d}.png"), cv2.IMREAD_GRAYSCALE)
    if actual.shape != (720, 1280):
        raise RuntimeError(f"Unexpected native dimensions: {actual.shape}")
    expected = reference[index]
    if encoder:
        video_frame = Image.new("RGB", (2560, 752), "black")
        for col,(pixels,label) in enumerate([(expected,"REFERENCE VIDEO"),(actual,"VISION / LSML - CAPTURE PAR SEEK")]):
            visible = pixels.copy()
            visible[665:] = 0
            video_frame.paste(Image.fromarray(visible).convert("RGB"),(col*1280,32))
            ImageDraw.Draw(video_frame).text((col*1280+20,3),label,fill="white",font=label_font)
        encoder.stdin.write(video_frame.tobytes())
    valid = np.ones((720, 1280), bool)
    valid[665:] = False
    if index < 70:
        valid[:160, 590:650] = False
    if index < 16:
        # Cursor relocation is outside the opening marker/bar. Exclude only
        # its tiny measured connected component, not the entire bounding region.
        contours, _ = cv2.findContours(np.uint8(expected >= 128)*255, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            x,y,w,h=cv2.boundingRect(contour)
            if cv2.contourArea(contour)<110 and x>610 and y<420:
                valid[max(0,y-2):y+h+2,max(0,x-2):x+w+2]=False
    if index < 127:
        valid[350:405, 698:735] = False
    a, b = (actual >= 128) & valid, (expected >= 128) & valid
    intersection, union = np.sum(a & b), np.sum(a | b)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5,5))
    near_a = cv2.dilate(np.uint8(a), kernel) != 0
    near_b = cv2.dilate(np.uint8(b), kernel) != 0
    recall = float(np.sum(b & near_a) / max(np.sum(b),1))
    precision = float(np.sum(a & near_b) / max(np.sum(a),1))
    rows.append({"index":index,"time_ms":entry["time_ms"],"iou":float(intersection/max(union,1)),
        "within_2px_precision":precision,"within_2px_recall":recall,
        "foreground_absolute_error":float(np.abs(actual.astype(float)-expected)[(a|b)].mean())})
    if index in selected:
        diff = np.zeros((720,1280,3),np.uint8)
        diff[a & b] = [255,255,255]
        diff[b & ~a] = [255,80,80]
        diff[a & ~b] = [80,170,255]
        strips = [Image.fromarray(expected).convert("RGB"),Image.fromarray(actual).convert("RGB"),Image.fromarray(diff)]
        panel = Image.new("RGB",(960,205),"#141414")
        draw = ImageDraw.Draw(panel)
        for col,(im,label) in enumerate(zip(strips,["Reference","Vision","Difference"])):
            panel.paste(im.resize((320,180)),(col*320,25))
            draw.text((col*320+8,5),f'{label} {index/30:.3f}s · IoU {rows[-1]["iou"]:.3f}',fill="white")
        panels.append(panel)
groups = {"lines_bounces":(0,90),"knot_formation":(90,118),"logo_bounces_rotation":(118,134),
          "glyph_assembly":(134,180),"final":(180,232)}
midpoint_rows=[]
for entry in metadata.get("midpoints",[]):
    index=entry["index"]
    actual=cv2.imread(str(captures/f"midpoint-{index}.png"),cv2.IMREAD_GRAYSCALE)>=128
    expected=reference[index]>=128
    actual[665:]=False
    expected[665:]=False
    if index<127:
        actual[350:405,698:735]=False
        expected[350:405,698:735]=False
    midpoint_rows.append({**entry,"iou":float(np.sum(actual & expected)/max(np.sum(actual | expected),1))})
result = {"captures":str(captures),"frames":len(rows),"midpoints":midpoint_rows,"errors":metadata["errors"],
    "method":"same 30Hz timestamps, actual 1280x720 native canvas, no time warping or spatial registration",
    "excluded":"video controls y>=665; cursor relocation components frame0..15; early top cursor box before frame70; stationary centre cursor box frame0..126; inpainted area is not a fidelity claim",
    "summary":{name:{"mean_iou":float(np.mean([r["iou"] for r in rows[first:last]])),
                     "minimum_iou":float(min(r["iou"] for r in rows[first:last])),
                     "minimum_2px_recall":float(min(r["within_2px_recall"] for r in rows[first:last])),
                     "minimum_2px_precision":float(min(r["within_2px_precision"] for r in rows[first:last]))}
               for name,(first,last) in groups.items()},"samples":rows}
report_path.parent.mkdir(parents=True,exist_ok=True)
report_path.write_text(json.dumps(result,indent=2),encoding="utf-8")
if encoder:
    encoder.stdin.close()
    if encoder.wait() != 0:
        raise RuntimeError("Comparison video encoding failed")
sheet = Image.new("RGB",(1920,205*((len(panels)+1)//2)),"#141414")
for i,panel in enumerate(panels):
    sheet.paste(panel,((i%2)*960,(i//2)*205))
sheet.save(report_path.with_suffix(".png"))
print(json.dumps({"frames":len(rows),"summary":result["summary"],"report":str(report_path)}))
