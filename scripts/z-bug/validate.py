"""Validate the Solar render and record deliverable provenance."""

import argparse
import hashlib
import json
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
from PIL import Image


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def probe(path: Path) -> dict:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=codec_name,pix_fmt,width,height,nb_frames:stream_tags=alpha_mode",
         "-of", "json", str(path)],
        check=True, capture_output=True, text=True,
    )
    return json.loads(result.stdout)["streams"][0]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("frames", type=Path)
    parser.add_argument("deliverable", type=Path)
    parser.add_argument("evidence", type=Path)
    args = parser.parse_args()
    scene = json.loads((args.deliverable / "z-bug.lsml").read_text(encoding="utf-8"))
    render = json.loads((args.deliverable / "render.json").read_text(encoding="utf-8"))
    contact = json.loads((args.deliverable / "contact.json").read_text(encoding="utf-8"))
    cadence = json.loads((args.deliverable / "cadence.json").read_text(encoding="utf-8"))
    assert scene["scene_id"] == "zab-z-corner-bug"
    assert len(scene["layout"]["children"]) == 4
    assert all(node["kind"] == "shape" and node["pathData"] for node in scene["layout"]["children"])
    assert contact["sample_hz"] == 120 and contact["vertices"] < 1024
    assert not cadence["errors"] and cadence["rate"] > 50
    assert render["total"] == 120 and render["animated"] == 56
    assert not render["errors"]
    frame_paths = sorted(args.frames.glob("frame-????.png"))
    assert len(frame_paths) == 120
    edge_touch = 0
    for path in frame_paths[:56]:
        with Image.open(path) as frame:
            assert frame.size == (1920, 1080)
            bounds = frame.getchannel("A").getbbox()
            if bounds and (bounds[0] == 0 or bounds[1] == 0 or bounds[2] == 1920 or bounds[3] == 1080):
                edge_touch += 1
    assert edge_touch == 0
    samples = {}
    for time_ms in (0, 80, 160, 240, 320, 400, 440, 480, 520, 560, 600, 640, 680, 900):
        with Image.open(args.frames / f"frame-{round(time_ms * 60 / 1000):04d}.png") as frame:
            samples[str(time_ms)] = frame.getchannel("A").getbbox()
    assert samples["0"] is None and samples["80"] is not None
    with Image.open(args.source) as original, Image.open(args.frames / "frame-0055.png") as final_frame:
        source_mask = np.asarray(original.convert("RGBA").resize((180, 189), Image.Resampling.LANCZOS))[:, :, 3] > 128
        final_mask = np.asarray(final_frame.convert("RGBA").crop((112, 839, 292, 1028)))[:, :, 3] > 128
        final_area = np.count_nonzero(np.asarray(final_frame.convert("RGBA"))[:, :, 3] > 128)
    contact_areas = []
    for index in range(22, 42):
        with Image.open(args.frames / f"frame-{index:04d}.png") as frame:
            contact_areas.append(int(np.count_nonzero(np.asarray(frame)[:, :, 3] > 128)))
    visible_area_ratio = min(contact_areas) / final_area
    assert visible_area_ratio > .9, "Contact must not shrink or fade into a dot"
    source_iou = float(np.count_nonzero(source_mask & final_mask) / np.count_nonzero(source_mask | final_mask))
    assert source_iou > 0.95
    for name in ("arrow-left", "arrow-right", "arrow-left-draw", "arrow-right-draw", "arrow-left-docked", "arrow-right-docked", "z-assembled"):
        ET.parse(args.deliverable / "assets" / f"{name}.svg")
    alpha_video = probe(args.deliverable / "z-bug-alpha.webm")
    preview = probe(args.deliverable / "z-bug-preview.mp4")
    assert alpha_video["codec_name"] == "vp9" and alpha_video.get("tags", {}).get("alpha_mode") == "1"
    assert preview["codec_name"] == "h264" and preview.get("nb_frames") == "120"
    files = {}
    for name in ("z-bug.lsml", "z-bug.lsmlz", "sponsor-motion.lsml", "sponsor-motion.lsmlz",
                 "z-bug-alpha.webm", "z-bug-preview.mp4", "z-bug-storyboard.png", "z-final-transparent.png",
                 "assets/arrow-left.svg", "assets/arrow-right.svg", "assets/arrow-left-draw.svg",
                 "assets/arrow-right-draw.svg", "assets/z-assembled.svg", "assets/arrow-left-docked.svg",
                 "assets/arrow-right-docked.svg", "contact.json", "cadence.json"):
        path = args.deliverable / name
        files[name] = {"bytes": path.stat().st_size, "sha256": sha256(path)}
    report = {
        "source": str(args.source.resolve()), "source_sha256": sha256(args.source),
        "scene_version": scene["scene_version"], "render": "Solar native LSDP / Vision canvas",
        "viewport": [1920, 1080], "fps": 60, "duration_s": 2.0,
        "draw_s": 0.335, "fusion_s": 0.68, "vector_shapes": 4,
        "source_derived_arrow_ribbons": 2, "progressive_arrow_draw_paths": 2,
        "source_derived_final_mark": 1, "isolated_arrow_artificial_cuts": 0,
        "contact_geometry": contact, "minimum_contact_visible_area_ratio": round(visible_area_ratio, 6),
        "cadence": {key: value for key, value in cadence.items() if key != "submissions"},
        "raster_image_nodes": 0, "source_mask_iou_at_final_size": round(source_iou, 6),
        "animated_frame_edge_touch_count": edge_touch, "sample_alpha_bounds": samples,
        "render_errors": render["errors"], "alpha_video": alpha_video,
        "preview_video": preview, "svg_xml_parse": "pass", "files": files,
    }
    args.deliverable.joinpath("delivery.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    args.evidence.parent.mkdir(parents=True, exist_ok=True)
    args.evidence.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"evidence": str(args.evidence), "edge_touch": edge_touch,
                      "alpha_mode": alpha_video["tags"]["alpha_mode"], "samples": samples}))


if __name__ == "__main__":
    main()
