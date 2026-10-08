"""Cuts one recorded scene into the README's GIF.

    python3 scripts/media/encode.py <video> <start> <end> <en|ar> <scene>

The arguments are the line `scenes.mjs` prints; see docs/MEDIA.md.
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FFMPEG = ["ffmpeg", "-v", "error", "-y"]


def main(video: str, start: str, end: str, locale: str, scene: str) -> None:
    begin = max(0.0, float(start) - 0.2)
    length = float(end) - float(start) + 0.4
    cut = ["-ss", str(begin), "-t", str(length), "-i", video]
    gif = f"{ROOT}/docs/screenshots/{'ar/' if locale == 'ar' else ''}QuranClipper_Demo_{scene.capitalize()}.gif"
    palette = f"{os.path.dirname(video)}/palette.png"
    scale = "fps=10,scale=800:-2:flags=lanczos"
    subprocess.run([*FFMPEG, *cut, "-vf", f"{scale},palettegen=stats_mode=diff", palette], check=True)
    subprocess.run([*FFMPEG, *cut, "-i", palette, "-lavfi",
                    f"{scale}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle", gif], check=True)


if __name__ == "__main__":
    main(*sys.argv[1:6])
