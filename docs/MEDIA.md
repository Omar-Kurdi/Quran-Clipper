# Demo clips and GIFs

The READMEs' demo GIFs (`docs/screenshots/QuranClipper_Demo_*.gif`, Arabic
under `docs/screenshots/ar/`) are recorded from the studio itself, so they can
be made again whenever the interface changes.

1. Build and start a production studio in public mode on 45709. The dev build
   draws its render statistics over the preview.

   ```bash
   npm run build && STUDIO_MODE=public npx next start -p 45709
   ```

2. Install Playwright for the run only; it is not a dependency of the app.

   ```bash
   npm i --no-save playwright && npx playwright install chromium
   ```

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
