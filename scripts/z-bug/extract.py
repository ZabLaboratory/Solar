"""Extract the two *complete* nested arrows from the landing Z's negative space.

Each of the two large holes defines one arrow. A mitered outward offset of that
hole produces a closed red ribbon with a real arrow tip and no partition seam.
Docked contours share the source's central material. Corresponding vertices
let the complete ribbons reshape only during contact, without disappearing.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw
from shapely.geometry import Polygon


def contour_path(points: np.ndarray, sx: float = 1, sy: float = 1) -> str:
    return "M" + " L".join(f"{x * sx:.3f} {y * sy:.3f}" for x, y in points) + " Z"


def polygon_path(polygon: Polygon, sx: float = 1, sy: float = 1) -> str:
    outlines = [polygon.exterior, *polygon.interiors]
    return " ".join(contour_path(np.asarray(ring.coords), sx, sy) for ring in outlines)


def ring_parameters(points: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    points = np.asarray(points, dtype=float)
    if np.allclose(points[0], points[-1]):
        points = points[:-1]
    closed = np.vstack((points, points[0]))
    lengths = np.linalg.norm(np.diff(closed, axis=0), axis=1)
    times = np.cumsum(np.r_[0.0, lengths])
    return closed, times / times[-1]


def sample_ring(points: np.ndarray, times: np.ndarray) -> np.ndarray:
    closed, knots = ring_parameters(points)
    return np.column_stack([np.interp(times, knots, closed[:, axis]) for axis in (0, 1)])


def corresponding_rings(source: np.ndarray, destination: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    # Same single-loop topology, unlike morphing an arrow into the entire Z.
    source = ring_parameters(source)[0][:-1]
    destination = ring_parameters(destination)[0][:-1]
    samples = np.linspace(0, 1, 96, endpoint=False)
    reference = sample_ring(source, samples)
    candidates = (np.roll(direction, shift, axis=0)
                  for direction in (destination, destination[::-1])
                  for shift in range(len(destination)))
    destination = min(candidates, key=lambda ring: np.square(sample_ring(ring, samples) - reference).sum())
    # Keep every original corner at both endpoints, with common path commands.
    times = np.unique(np.round(np.r_[ring_parameters(source)[1][:-1],
                                    ring_parameters(destination)[1][:-1], samples[::3]], 7))
    return sample_ring(source, times), sample_ring(destination, times)


def docking_regions(mask: np.ndarray, holes: list[np.ndarray]) -> list[np.ndarray]:
    distances = []
    for contour in holes:
        interior = np.zeros(mask.shape, dtype=np.uint8)
        cv2.fillPoly(interior, [contour], 1)
        distances.append(cv2.distanceTransform(1 - interior, cv2.DIST_L2, cv2.DIST_MASK_PRECISE))
    regions = [mask & (distances[0] <= distances[1]), mask & (distances[0] > distances[1])]
    return [cv2.approxPolyDP(max(cv2.findContours(region.astype(np.uint8), cv2.RETR_EXTERNAL,
              cv2.CHAIN_APPROX_SIMPLE)[0], key=cv2.contourArea), .65, True)[:, 0, :]
            for region in regions]


def raster_preview(polygon: Polygon, color: str, size: tuple[int, int]) -> Image.Image:
    scale = 4
    canvas = Image.new("RGBA", (size[0] * scale, size[1] * scale))
    draw = ImageDraw.Draw(canvas)
    for ring, fill in ((polygon.exterior, color), *((ring, "#00000000") for ring in polygon.interiors)):
        draw.polygon([(round(x * scale), round(y * scale)) for x, y in ring.coords], fill=fill)
    return canvas.resize(size, Image.Resampling.LANCZOS)


def source_path(mask: np.ndarray, sx: float = 1, sy: float = 1) -> str:
    contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    return " ".join(
        contour_path(cv2.approxPolyDP(contour, .35, True)[:, 0, :], sx, sy)
        for contour in contours if cv2.contourArea(contour) > 4
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    original = np.asarray(Image.open(args.source).convert("RGBA"))
    h, w = original.shape[:2]
    assert (w, h) == (296, 311), "Unexpected confirmed Z crop"
    mask = original[:, :, 3] > 128
    contours, hierarchy = cv2.findContours(mask.astype(np.uint8), cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    holes = [contour for index, contour in enumerate(contours)
             if hierarchy[0, index, 3] == 0 and cv2.contourArea(contour) > 1000]
    assert len(holes) == 2, "The mark must contain exactly two arrow voids"
    holes.sort(key=lambda contour: cv2.boundingRect(contour)[1])
    median = np.median(original[mask, :3], axis=0).astype(int)
    color = "#" + "".join(f"{v:02x}" for v in median)
    sx, sy = 180 / w, 189 / h
    vectors: dict[str, dict[str, object]] = {}
    docked = docking_regions(mask, holes)
    for name, contour, dock_outline in zip(("arrow-left", "arrow-right"), holes, docked, strict=True):
        # The two arrow channels are real source geometry. Buffering their
        # simplified outlines forms a full, closed red ribbon, never a cut of Z.
        simplified = cv2.approxPolyDP(contour, 1.35, True)[:, 0, :]
        hole = Polygon(simplified).buffer(0)
        assert isinstance(hole, Polygon) and hole.is_valid
        arrow = hole.buffer(19.5, join_style="mitre", mitre_limit=2).difference(hole)
        assert isinstance(arrow, Polygon) and arrow.is_valid and len(arrow.interiors) == 1
        # A stroke on this medial contour paints the ribbon itself progressively.
        # It follows the extracted arrow rather than an ornamental guide.
        draw_contour = hole.buffer(9.75, join_style="mitre", mitre_limit=2).exterior
        path = polygon_path(arrow)
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}">\n'
               f'<path fill="{color}" fill-rule="evenodd" d="{path}"/>\n</svg>\n')
        (args.output / f"{name}.svg").write_text(svg, encoding="utf-8")
        (args.output / f"{name}-draw.svg").write_text(
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}">\n'
            f'<path fill="none" stroke="{color}" stroke-width="19.5" '
            f'stroke-linejoin="miter" stroke-linecap="butt" '
            f'd="{contour_path(np.asarray(draw_contour.coords))}"/>\n</svg>\n',
            encoding="utf-8",
        )
        raster_preview(arrow, color, (w, h)).save(args.output / f"{name}.png")
        start_outline, final_outline = corresponding_rings(np.asarray(arrow.exterior.coords), dock_outline)
        inner_path = contour_path(np.asarray(hole.exterior.coords), sx, sy)
        morph_start = contour_path(start_outline, sx, sy) + " " + inner_path
        morph_end = contour_path(final_outline, sx, sy) + " " + inner_path
        docked_polygon = Polygon(final_outline, [np.asarray(hole.exterior.coords)])
        assert docked_polygon.is_valid and len(docked_polygon.interiors) == 1
        (args.output / f"{name}-docked.svg").write_text(
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 189">\n'
            f'<path fill="{color}" fill-rule="evenodd" d="{morph_end}"/>\n</svg>\n', encoding="utf-8")
        vectors[name] = {"pathData": polygon_path(arrow, sx, sy), "fill": color,
                         "morphStart": morph_start, "morphDocked": morph_end,
                         "drawPathData": contour_path(np.asarray(draw_contour.coords), sx, sy),
                         "drawStrokeWidth": 19.5 * sx,
                         "sourceHoleVertices": len(simplified), "ringWidthPx": 19.5}

    master = source_path(mask)
    (args.output / "z-assembled.svg").write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}">\n'
        f'<path fill="{color}" fill-rule="evenodd" d="{master}"/>\n</svg>\n',
        encoding="utf-8",
    )
    vectors["master"] = {"pathData": source_path(mask, sx, sy), "fill": color}
    (args.output / "vectors.json").write_text(json.dumps(vectors), encoding="utf-8")
    report = {
        "source": str(args.source.resolve()), "size": [w, h],
        "method": "Two closed mitered ribbons offset from the two arrow-shaped source voids",
        "ribbon_width_px": 19.5,
        "drawing": "Progressive centerline stroke of each source-derived arrow ribbon",
        "source_master": "Full original silhouette traced independently; final merged red area is not artificially partitioned",
        "docking": "Complete one-hole ribbons morph into matching source regions at contact; holes remain stationary in local coordinates",
        "artificial_cuts": 0,
    }
    (args.output / "extraction.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
