# Demo clips, GIFs and screenshots

The READMEs' demo GIFs (`docs/screenshots/QuranClipper_Demo_*.gif`) and still
screenshots (`docs/screenshots/QuranClipper_*.png`), Arabic under
`docs/screenshots/ar/`, are taken from the studio itself, so they can be made
again whenever the interface changes.

1. Build and start a production studio in public mode on 45709. The dev build
   draws its render statistics over the preview.

   ```bash
   export NEXT_PUBLIC_QURAN_TRANSLATION_ID=20 QURAN_TRANSLATION_ID=20
   npm run build && STUDIO_MODE=public npx next start -p 45709
   ```

   The two translation settings give the captions Saheeh International, which
   is what a public studio serves. A machine whose `.env.local` names another
   default would otherwise build that one into the page, and the chip under
   Translations would show a bare id.

2. Install Playwright for the run only; it is not a dependency of the app.

   ```bash
   npm i --no-save playwright
   export CHROMIUM=/path/to/google-chrome
   ```

   Point `CHROMIUM` at Google Chrome rather than Playwright's own Chromium: the
   stock backgrounds are MP4 (H.264), which the open-source build cannot play,
   so its recordings show the preview with no background.

3. Record each scene in each language, and cut its GIF.

   ```bash
   export STUDIO_URL=http://localhost:45709 DEMO_RECORDING=/path/to/Al-Falaq.wav
   for locale in en ar; do for scene in passage captions style export; do
     python3 scripts/media/encode.py $(node scripts/media/scenes.mjs $locale /tmp/qc-media $scene)
   done; done
   ```

The scenes use a built-in reciter (Al-Mulk 67:1-2, Abdul Rahman Al-Sudais).
The passage scene also uploads `DEMO_RECORDING`, a recitation of Al-Falaq
113:1-5 that may be published, under a plain file name, and matches it, so it
needs the sidecar running; the other scenes do not. `encode.py` needs `ffmpeg`.

4. Take the stills, in each language. They use the same recording, matched,
   so they also need the sidecar.

   ```bash
   for locale in en ar; do node scripts/media/shots.mjs $locale; done
   ```

5. Cut the front page's step clips from the new GIFs (`public/landing/`, MP4s
   with a poster frame each, a tenth of the GIFs' size):

   ```bash
   scripts/media/landing.sh
   ```
