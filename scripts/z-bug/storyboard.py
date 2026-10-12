"""Show dense, source-rendered samples of the arrow drawing and assembly."""

import argparse
from pathlib import Path

from PIL import Image, ImageDraw


TIMES_MS = (0, 100, 200, 300, 400, 500, 600, 700,
            800, 1100, 1500, 1900, 2200, 2300, 2500, 2700)
FPS = 60
CROP = (0, 700, 430, 1080)
LABEL_HEIGHT = 26


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("frames", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    tile_w = CROP[2] - CROP[0]
    tile_h = CROP[3] - CROP[1] + LABEL_HEIGHT
    sheet = Image.new("RGB", (tile_w * 4, tile_h * 4), "#111111")
    draw = ImageDraw.Draw(sheet)
    for index, time_ms in enumerate(TIMES_MS):
        frame_number = round(time_ms * FPS / 1000)
        path = args.frames / f"frame-{frame_number:04d}.png"
        with Image.open(path) as frame:
            crop = frame.convert("RGB").crop(CROP)
            x = (index % 4) * tile_w
            y = (index // 4) * tile_h
            sheet.paste(crop, (x, y + LABEL_HEIGHT))
        draw.text((x + 8, y + 6), f"{time_ms:04d} ms", fill="#f0f0f0")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.output)


if __name__ == "__main__":
    main()
