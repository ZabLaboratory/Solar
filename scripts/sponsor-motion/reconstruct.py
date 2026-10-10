"""Trace the supplied recording into vector assets; no external logo/font dependency.
Usage: python reconstruct.py <recording.mp4> <explicit-fixture-output-directory>
The reference is evidence/input, never a playback asset. Nested islands are
excluded from the symbol contour to remove the recording's mouse cursor.
"""
import hashlib
import json
import sys
import subprocess
from pathlib import Path
import cv2
import numpy as np

source, output = Path(sys.argv[1]), Path(sys.argv[2])
output.mkdir(parents=True, exist_ok=True)

def frame(seconds):
    encoded = subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-ss",str(seconds),
        "-i",str(source),"-frames:v","1","-f","image2pipe","-vcodec","png","pipe:1"],
        check=True,stdout=subprocess.PIPE).stdout
    pixels = cv2.imdecode(np.frombuffer(encoded,dtype=np.uint8),cv2.IMREAD_COLOR)
    if pixels is None:
        raise RuntimeError(f"Cannot read reference at {seconds}")
    return cv2.cvtColor(pixels, cv2.COLOR_BGR2GRAY)

def trace(mask, symbol=False, tolerance=1.1):
    contours, hierarchy = cv2.findContours(mask, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    paths = []
    for contour_index, contour in enumerate(contours):
        if symbol:
            parent = hierarchy[0][contour_index][3]
            if parent >= 0 and hierarchy[0][parent][3] >= 0:
                continue
        if abs(cv2.contourArea(contour)) < (100 if symbol else 5):
            continue
        vertices = cv2.approxPolyDP(contour, tolerance, True).reshape(-1, 2).astype(float)
        if len(vertices) < 3:
            continue
        tangents = []
        for i, p in enumerate(vertices):
            before, after = vertices[(i-1) % len(vertices)], vertices[(i+1) % len(vertices)]
            u, v = p-before, after-p
            cosine = np.dot(u,v) / max(np.linalg.norm(u)*np.linalg.norm(v), 1e-9)
            tangents.append((after-before)/6 if cosine > .86 else np.array([0.,0.]))
        fmt = lambda p: f"{p[0]:.3f} {p[1]:.3f}"
        pieces = ["M" + fmt(vertices[0])]
        for i, p in enumerate(vertices):
            j = (i+1) % len(vertices)
            pieces.append("C" + " ".join(map(fmt, [p+tangents[i],vertices[j]-tangents[j],vertices[j]])))
        paths.append(" ".join(pieces) + " Z")
    return " ".join(paths)

def svg(path, width, height):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}"><path fill="white" fill-rule="evenodd" d="{path}"/></svg>\n'

large = frame(3.9)[140:590, 415:875]
_, binary = cv2.threshold(large, 145, 255, cv2.THRESH_BINARY)
centre = (229, 225)
logo_path = trace(binary, symbol=True)
output.joinpath("symbol.svg").write_text(svg(logo_path, 460, 450), encoding="utf-8")

lockup = frame(6.5)
_, final_mask = cv2.threshold(lockup[250:480,215:440],145,255,cv2.THRESH_BINARY)
final_symbol = {"path":trace(final_mask,symbol=True,tolerance=.65),"width":225,"height":230,"x":211,"y":245}
output.joinpath("symbol-final.svg").write_text(svg(final_symbol["path"],225,230),encoding="utf-8")
glyphs = []
for index, (left, right) in enumerate([(450,572),(580,670),(677,764),(772,861),(862,979),(983,1067)]):
    pixels = lockup[303:465, left:right]
    _, mask = cv2.threshold(pixels, 145, 255, cv2.THRESH_BINARY)
    path = trace(mask)
    name = "OpenAI"[index]
    output.joinpath(f"letter-{index}-{name}.svg").write_text(svg(path, right-left, 162), encoding="utf-8")
    glyphs.append({"character":name,"x":left,"y":303,"width":right-left,"height":162,"path":path})
data = {"symbol":{"path":logo_path,"width":460,"height":450,"centre":centre},"symbolFinal":final_symbol,"glyphs":glyphs,
        "reference":{"sha256":hashlib.sha256(source.read_bytes()).hexdigest(),
                     "symbol_time_s":3.9,"wordmark_time_s":6.5,"method":"threshold contours, 1.1px simplification (0.65px final symbol) and cubic tangents; nested cursor islands excluded"}}
output.joinpath("vectors.json").write_text(json.dumps(data, indent=2), encoding="utf-8")
print(json.dumps({"output":str(output),"symbol_path_characters":len(logo_path),"glyphs":len(glyphs),"reference":data["reference"]}))
