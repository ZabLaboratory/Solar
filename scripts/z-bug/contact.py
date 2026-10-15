"""Author the two ribbons' contact with their negative spaces preserved.

Input is the generator's explicit vector poses on stdin. Output remains SVG
path data; no pixels, raster masks or alternate playback engine are produced.
The 120 Hz held samples avoid inventing correspondence when contours join.
"""

import json
import re
import sys

import numpy as np
from shapely import affinity
from shapely.geometry import Polygon
from shapely.ops import unary_union


def rings(path):
    return [np.array([float(x) for x in re.findall(r"[-+]?\d*\.?\d+", ring)]).reshape(-1, 2)
            for ring in path.split("Z") if ring.strip()]


def transform(polygon, pose):
    scaled = affinity.scale(polygon, pose["scale"], pose["scale"], origin=(90, 94.5))
    rotated = affinity.rotate(scaled, pose["rotation"], origin=(90, 94.5))
    return affinity.translate(rotated, pose["translateX"], pose["translateY"])


def outlines(shape):
    polygons = list(shape.geoms) if shape.geom_type == "MultiPolygon" else [shape]
    result = []
    for polygon in sorted(polygons, key=lambda p: -p.area):
        if polygon.area < .2:
            continue
        result.append(np.array(polygon.exterior.coords)[:-1])
        result.extend(np.array(hole.coords)[:-1] for hole in polygon.interiors
                      if Polygon(hole).area >= .2)
    return result


def main():
    data = json.load(sys.stdin)
    source = [(rings(item["start"]), rings(item["docked"])) for item in data["arrows"]]
    frames = []
    for frame in data["poses"]:
        positive, negative = [], []
        for (start, docked), pose in zip(source, frame["arrows"], strict=True):
            interpolated = [a + (b - a) * frame["morph"] for a, b in zip(start, docked, strict=True)]
            positive.append(transform(Polygon(interpolated[0]).buffer(.35, join_style="mitre"), pose))
            negative.extend(transform(Polygon(hole), pose) for hole in interpolated[1:])
        # Both arrow voids stay empty through contact. A raw union of two
        # complete ribbons would briefly paint red across the other arrow's void.
        outer = unary_union(positive).buffer(.2, join_style="mitre").buffer(-.2, join_style="mitre")
        pieces = list(outer.geoms) if outer.geom_type == "MultiPolygon" else [outer]
        # Remove only subpixel seams; keep the larger open regions through
        # which the complete ribbons are still sliding.
        solid = unary_union([Polygon(piece.exterior, [hole for hole in piece.interiors
                            if Polygon(hole).area >= 12]) for piece in pieces])
        shape = solid.difference(unary_union(negative)).buffer(0).simplify(.035, preserve_topology=True)
        assert shape.is_valid and not shape.is_empty
        frames.append({"time": frame["time"], "rings": outlines(shape)})
    count = max(len(frame["rings"]) for frame in frames)
    budgets = [max(len(frame["rings"][i]) if i < len(frame["rings"]) else 1 for frame in frames)
               for i in range(count)]
    assert sum(budgets) + count <= 1024
    for frame in frames:
        paths = []
        for i, budget in enumerate(budgets):
            ring = frame["rings"][i] if i < len(frame["rings"]) else np.array([[90., 94.5]])
            points = np.vstack((ring, np.repeat(ring[-1:], budget - len(ring), axis=0)))
            paths.append("M" + " L".join(f"{x:.3f} {y:.3f}" for x, y in points) + " Z")
        frame["pathData"] = " ".join(paths)
        del frame["rings"]
    json.dump({"frames": frames, "contours": count, "vertices": sum(budgets),
               "sample_hz": 120, "method": "union of transformed outer contours minus both arrow voids"}, sys.stdout)


if __name__ == "__main__":
    main()
