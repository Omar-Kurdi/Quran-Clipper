"""Cuts one recorded scene into the welcome guide's clip and still and the README's GIF.

    python3 scripts/media/encode.py <video> <start> <end> <en|ar> <scene>

The arguments are the line `scenes.mjs` prints; see docs/MEDIA.md.
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FFMPEG = ["ffmpeg", "-v", "error", "-y"]
#: The guide shows the panel and preview of these scenes; the others whole.
PANEL_SCENES = {"passage", "style"}


def main(video: str, start: str, end: str, locale: str, scene: str) -> None:
    begin = max(0.0, float(start) - 0.2)
    length = float(end) - float(start) + 0.4
    cut = ["-ss", str(begin), "-t", str(length), "-i", video]
    # The panel sits on the left in English and on the right in Arabic.
    crop = f"crop=1040:650:{0 if locale == 'en' else 240}:0," if scene in PANEL_SCENES else ""
    guide = f"{ROOT}/src/assets/guide/{locale}-{scene}"
    subprocess.run([*FFMPEG, *cut, "-vf", f"{crop}fps=12,scale=720:-2:flags=lanczos", "-c:v", "libwebp_anim",
                    "-quality", "72", "-compression_level", "6", "-loop", "0", f"{guide}.webp"], check=True)
    subprocess.run([*FFMPEG, "-ss", str(begin + length - 0.5), "-i", video, "-frames:v", "1",
                    "-vf", f"{crop}scale=720:-2:flags=lanczos", "-c:v", "libwebp", "-quality", "80", f"{guide}-still.webp"], check=True)
    gif = f"{ROOT}/docs/screenshots/{'ar/' if locale == 'ar' else ''}QuranClipper_Demo_{scene.capitalize()}.gif"
    palette = f"{os.path.dirname(video)}/palette.png"
    scale = "fps=10,scale=800:-2:flags=lanczos"
    subprocess.run([*FFMPEG, *cut, "-vf", f"{scale},palettegen=stats_mode=diff", palette], check=True)
    subprocess.run([*FFMPEG, *cut, "-i", palette, "-lavfi",
                    f"{scale}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle", gif], check=True)


if __name__ == "__main__":
    main(*sys.argv[1:6])
