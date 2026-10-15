"""Trace the supplied canonical mark, preserving its three separated ribbons."""
import hashlib
import json
from pathlib import Path
import sys

import cv2
import numpy as np

source, output = map(Path, sys.argv[1:3])
image = cv2.imread(str(source))
mask = (cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) < 128).astype(np.uint8)
contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
contours = sorted((c for c in contours if cv2.contourArea(c) > 10000),
                  key=lambda c: cv2.boundingRect(c)[1])
if len(contours) != 3:
    raise ValueError("Canonical mark must contain three separated bands")
result = []
reconstructed = np.zeros_like(mask)
for contour in contours:
    points = contour[:, 0, :].astype(float)
    closed = np.vstack([points, points[0]])
    lengths = np.r_[0, np.cumsum(np.linalg.norm(np.diff(closed, axis=0), axis=1))]
    samples = np.arange(256) * lengths[-1] / 256
    polygon = np.stack([np.interp(samples, lengths, closed[:, i]) for i in range(2)], axis=1)
    cv2.fillPoly(reconstructed, [np.round(polygon).astype(np.int32)], 1)
    result.append(polygon.round(3).tolist())
intersection = np.count_nonzero(mask & reconstructed)
union = np.count_nonzero(mask | reconstructed)
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps({"source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
    "source_size": [image.shape[1], image.shape[0]], "threshold": 128,
    "points_per_band": 256, "silhouette_iou": intersection / union, "bands": result}))
print(json.dumps({"bands": len(result), "silhouette_iou": intersection / union}))
