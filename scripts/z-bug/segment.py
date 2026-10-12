"""Trace the two opposed arrow regions of the confirmed landing Z.

The left region contains the (4, 127) arrow tip and the right region contains
the (291, 183) tip. A diagonal partition preserves the original pixels for
the assembled reference; the animation additionally draws each actual arrow
gesture before its source-derived region fills in.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


def traced_path(mask: np.ndarray, scale_x: float = 1, scale_y: float = 1) -> str:
    contours, _ = cv2.findContours(mask, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    paths = []
    for contour in contours:
        if cv2.contourArea(contour) < 4:
            continue
        # This tolerance retains the thresholded source silhouette exactly
        # when rasterized at its original 296x311 resolution.
        points = cv2.approxPolyDP(contour, 0.35, True)[:, 0, :]
        if len(points) < 3:
            continue
        paths.append("M" + " L".join(
            f"{x * scale_x:.3f} {y * scale_y:.3f}" for x, y in points
        ) + " Z")
    return " ".join(paths)


def svg_for(mask: np.ndarray, color: str) -> str:
    height, width = mask.shape
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
        f'width="{width}" height="{height}">\n'
        f'  <path fill="{color}" stroke="{color}" stroke-width="1.4" '
        f'stroke-linejoin="round" fill-rule="evenodd" d="{traced_path(mask)}"/>\n'
        "</svg>\n"
    )


def guide_path(points: list[tuple[int, int]], scale_x: float, scale_y: float) -> str:
    return "M" + " L".join(f"{x * scale_x:.3f} {y * scale_y:.3f}" for x, y in points)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    original = np.array(Image.open(args.source).convert("RGBA"))
    height, width = original.shape[:2]
    assert (width, height) == (296, 311), "Unexpected source crop"
    yy, xx = np.indices((height, width))
    upper = yy < 240 - 0.6 * xx
    layers = []
    vectors = {}
    gestures = {
        "arrow-left": [(246, 58), (205, 20), (24, 127), (76, 174)],
        "arrow-right": [(50, 251), (90, 290), (274, 182), (224, 134)],
    }
    for name, selection in (("arrow-left", upper), ("arrow-right", ~upper)):
        layer = original.copy()
        layer[~selection] = 0
        layers.append(layer)
        Image.fromarray(layer).save(args.output / f"{name}.png")
        opaque = (layer[:, :, 3] > 128).astype(np.uint8)
        count, _, stats, _ = cv2.connectedComponentsWithStats(opaque, 8)
        assert count == 2, f"{name} must be one connected arrow; got {count-1}"
        color_pixels = layer[opaque.astype(bool), :3]
        median = np.median(color_pixels, axis=0).astype(int)
        color = "#" + "".join(f"{v:02x}" for v in median)
        (args.output / f"{name}.svg").write_text(svg_for(opaque * 255, color), encoding="utf-8")
        vectors[name] = {
            "pathData": traced_path(opaque * 255, 180 / width, 189 / height),
            "guidePathData": guide_path(gestures[name], 180 / width, 189 / height),
            "fill": color,
        }
        (args.output / f"{name}-guide.svg").write_text(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 189">\n'
            f'<path d="{vectors[name]["guidePathData"]}" fill="none" stroke="#ffffff" '
            'stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>\n</svg>\n',
            encoding="utf-8",
        )
    # The hard partition keeps every original alpha and RGB pixel. On assembly,
    # no color transfer, blend, or hidden logo swap is necessary.
    reassembled = layers[0] + layers[1]
    assert np.array_equal(reassembled, original)
    Image.fromarray(reassembled).save(args.output / "reassembled.png")
    (args.output / "vectors.json").write_text(json.dumps(vectors), encoding="utf-8")
    vector_layers = []
    for name in ("arrow-left", "arrow-right"):
        layer = cv2.imread(str(args.output / f"{name}.png"), cv2.IMREAD_UNCHANGED)
        opaque = (layer[:, :, 3] > 128).astype(np.uint8)
        vector_layers.append(
            f'  <path fill="{vectors[name]["fill"]}" stroke="{vectors[name]["fill"]}" '
            f'stroke-width="1.4" stroke-linejoin="round" fill-rule="evenodd" '
            f'd="{traced_path(opaque * 255)}"/>\n'
        )
    (args.output / "z-assembled.svg").write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}">' +
        "\n" + "".join(vector_layers) + "</svg>\n",
        encoding="utf-8",
    )
    report = {
        "source": str(args.source.resolve()),
        "size": [width, height],
        "arrow_tips": {"left": [4, 127], "right": [291, 183]},
        "partition": "y < 240 - 0.6*x; source-pixel reference only",
        "component_pixels": [int(np.count_nonzero(layer[:, :, 3] > 128)) for layer in layers],
        "pixel_exact_reassembly": True,
        "note": "Solar animates two source-derived fill paths and two arrow gesture paths. The PNGs preserve source-pixel reconstruction for comparison.",
    }
    (args.output / "segmentation.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
