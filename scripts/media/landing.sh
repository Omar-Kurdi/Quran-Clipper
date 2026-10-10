#!/usr/bin/env bash
#
# The front page's step clips, cut from the READMEs' demo GIFs: MP4s a tenth
# of the size, with a poster frame each. Run after re-recording the GIFs
# (docs/MEDIA.md) so the front page shows the same.
#
# Usage: scripts/media/landing.sh
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/../.."
for locale in en ar; do
  src=docs/screenshots; [[ $locale == ar ]] && src=docs/screenshots/ar
  mkdir -p "public/landing/$locale"
  for scene in Passage Captions Style Export; do
    out="public/landing/$locale/${scene,,}"
    ffmpeg -loglevel error -y -i "$src/QuranClipper_Demo_$scene.gif" -movflags +faststart -pix_fmt yuv420p \
      -c:v libx264 -crf 24 -preset slow -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -an "$out.mp4"
    ffmpeg -loglevel error -y -ss 1 -i "$out.mp4" -frames:v 1 -q:v 4 "$out.jpg"
  done
done
du -ch public/landing/*/* | tail -1
