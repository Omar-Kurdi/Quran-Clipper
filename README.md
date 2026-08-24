# Quran Clip Maker

A Next.js studio for creating short-form Quran recitation videos. Select ayahs, choose a
reciter or upload your own recitation, sync verse timings, style the canvas, pick an animated
background, and export the result — all in the browser.

Its distinguishing feature is how it times uploaded audio. Instead of asking a model to guess
what was recited and when, it takes the *known* Quran text as a fixed constraint and solves
only for timing. A word cannot go missing, come back garbled, or land in the wrong surah —
those are structural properties of the method, not tuning. See [docs/ALIGNMENT.md](docs/ALIGNMENT.md).

<p align="center">
  <img src="docs/screenshots/studio-nocturne.png" alt="The studio in the Nocturne theme: a three-column layout of source panel, video preview and ayah inspector, with a full-width waveform timeline beneath." width="49%">
  <img src="docs/screenshots/studio-slate.png" alt="The same studio in the Slate & Amber theme, showing the runtime theme switcher." width="49%">
</p>
<p align="center"><sub>Nocturne (default) and Slate &amp; Amber — five themes ship, switchable at runtime from the header.</sub></p>

---

## Contents

- [Features](#features)
- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [Audio matching](#audio-matching)
- [Using the studio](#using-the-studio)
- [Export](#export)
- [API reference](#api-reference)
- [Project structure](#project-structure)
- [Database (optional)](#database-optional)
- [Troubleshooting](#troubleshooting)
- [Limitations](#limitations)

---

## Features

**Quran content**
- All 114 surahs with Arabic/English metadata, Uthmani text, word-level data, transliteration,
  and English translation (Quran.com API, translation `131` — The Clear Quran).
- Six reciters streamed from the mp3quran.net CDN:

  | Reciter | Arabic | Style |
  |---|---|---|
  | Abdul Rahman Al-Sudais | عبد الرحمن السديس | Murattal |
  | Maher Al-Muaiqly | ماهر المعيقلي | Murattal |
  | Yasser Al-Dosari | ياسر الدوسري | Emotional |
  | Saud Al-Shuraim | سعود الشريم | Murattal |
  | Saad Al-Ghamdi | سعد الغامدي | Murattal |
  | Raad Al-Kurdi | رعد محمد الكردي | Emotional |

**Timing your own audio**
- Four interchangeable matching providers behind one endpoint — see [Audio matching](#audio-matching).
- Forced alignment runs locally, on GPU or CPU, and never sends your audio anywhere.
- Repeated phrases are detected acoustically and get their own segments.
- Phrase-level display: each segment carries only the words actually spoken, so a repeated
  half-ayah shows exactly those words rather than the whole verse.
- Full-ayah English translation under the Arabic.
- **Multiple backgrounds, four ways** — one clip, one per ayah, cycling on a timer, or shuffled
  (repeatably, so a re-export matches the preview). Every selected clip is preloaded in its own
  element, so switching never stalls the render — which does mean each one decodes concurrently,
  so a handful is kinder to the export than all of them.
- **A real timeline.** Each ayah is a block whose width is its actual duration, drawn over the
  waveform of the recitation. Drag an edge to retime it, or tap SPACEBAR at each boundary while
  the audio plays. Changes cascade so the timeline stays contiguous.
- **Trim / crop uploaded audio** with a waveform editor — a scrubbable playhead and a time
  ruler show exactly where you are, zoom (up to 16×) resolves the waveform for fine cuts, and
  start/end are entered as timecodes (`3:31.7`). Drag the handles, or park the playhead and
  press *Start here* / *End here*. Works before matching (cut dead air first) or after (cut the
  matched timeline down); the segment times adjust to the new clip automatically either way.
  Runs entirely in the browser, no upload or server round-trip, and is reachable from the top
  toolbar at any step.
- **Upload video as well as audio** (MP4 / MOV / WebM / MKV). The audio track drives the
  timing, and the footage can double as the clip background — kept frame-synced to playback
  rather than looped, so a recorded recitation stays in sync. Trimming the audio offsets the
  background automatically instead of discarding it.

**Styling and export**
- Aspect ratios 9:16, 16:9, 1:1, 4:5.
- 11 Pexels video backgrounds, or paste any video/image URL, or upload a file.
- Configurable fonts, sizes, colours, shadows, card opacity, surah badge, and watermark.
  Arabic defaults to Scheherazade New and auto-shrinks to stay inside the card.
- Browser export via `canvas.captureStream()` + `MediaRecorder` (WebM, 18 Mbps, 30 or 60 FPS).
- Save/load projects with PostgreSQL, or in-memory when no database is configured — see
  [Database](#database-optional) for a five-minute container setup.

---

## Quick start

### Prerequisites

| | Needed for |
|---|---|
| **Node.js 20+** | the web app (required) |
| **Python 3.11 or 3.12** + **ffmpeg** on PATH | local forced alignment (recommended) |
| **PostgreSQL** | durable saved projects (optional) |
| **Gemini API key** | cloud matching providers (optional) |

The app runs with Node alone. Everything else unlocks an optional capability.

### 1. Install and run the web app

```bash
npm install
npm run dev
```

Open <http://localhost:3000/video-creator>. You can already browse surahs, load reciter audio,
style the canvas, manually sync timings, and export.

### 2. Install the alignment sidecar (recommended)

This is what times uploaded audio accurately. It is a separate Python service.

```bash
cd asr-service
python3.12 -m venv .venv
source .venv/bin/activate
```

**No NVIDIA GPU** (including most VPS hosts) — install the CPU-only PyTorch wheel first, which
avoids pulling ~2–3 GB of unused CUDA libraries:

```bash
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
```

**With an NVIDIA GPU:**

```bash
pip install -r requirements.txt
```

### 3. Start the sidecar

```bash
cd asr-service
./run.sh
```

Use `run.sh` rather than a bare `uvicorn`: it calls the virtualenv's Python by absolute path,
which avoids the one failure that reliably breaks this service — bash resolving `uvicorn` to a
different Python, whose mismatched protobuf/onnx makes every match fail. The service detects
that at startup and tells you how to fix it.

The first start downloads model weights (~1.2 GB). Confirm it is up:

```bash
curl http://127.0.0.1:8000/health     # alignReady must be true
```

Then reload the studio page — the **Forced Align** matcher will show "Sidecar online".

> **CPU-only hosts:** everything here runs on CPU — a 68-second clip aligns in about 4 seconds
> on an 8-core machine, because it searches one fixed text rather than every possible sentence.
> Keep the default NeMo backend even without a GPU: it is what reads the audio to work out the
> surah for you. `ASR_ALIGN_BACKEND=wav2vec2` avoids that dependency but **gives up surah
> detection**, so reach for it only if NeMo genuinely won't install.
> See [asr-service/README.md](asr-service/README.md#running-without-a-gpu).

### 4. Configure keys (optional)

Copy `.env.example` to `.env.local` and fill in only what you need:

```bash
cp .env.example .env.local
```

Nothing in it is required to run the app.

---

## Environment variables

All of these go in `.env.local` in the project root. **None are required** — each one enables
an optional capability, and the app degrades cleanly without it.

| Variable | Required for | Default | Notes |
|---|---|---|---|
| `ASR_SERVICE_URL` | forced alignment, local ASR | `http://127.0.0.1:8000` | Where the Python sidecar is listening. |
| `AUDIO_MATCH_PROVIDER` | — | `gemini` | Default provider when the client doesn't pick one. Set to `align` if you run the sidecar. |
| `GEMINI_API_KEY` | `gemini` and `hybrid` providers | — | From [Google AI Studio](https://aistudio.google.com/apikey). `GOOGLE_API_KEY` also works. |
| `GEMINI_MODEL` | — | `gemini-3.6-flash` | Must be a current model that accepts audio. See the note below. |
| `GEMINI_TIMEOUT_MS` | — | `180000` | Ceiling on a single Gemini request. |
| `DATABASE_URL` | durable saved projects | — | Leave it **unset** to use in-memory storage. See [Database](#database-optional). |

> **Do not leave `DATABASE_URL` set to a placeholder.** The app checks whether the variable is
> set, not whether it works — so `postgres://USER:PASSWORD@HOST:PORT/DATABASE` skips the
> in-memory fallback and every save fails with a 500. Either give it a real connection string
> or comment the line out.

> **Gemini model IDs are retired regularly.** `gemini-2.0-flash` and `gemini-2.5-flash` no
> longer exist and return HTTP 404. Check the
> [current model list](https://ai.google.dev/gemini-api/docs/models) and pick a model that
> accepts audio input. Note that `chirp_3` is a Speech-to-Text model, not a Gemini model, and
> will not work here.

Getting a Gemini key: sign in at [Google AI Studio](https://aistudio.google.com/apikey),
create an API key, and paste it as `GEMINI_API_KEY`. The free tier is enough to try the cloud
providers. **Keep `.env.local` out of version control** — it is already in `.gitignore`.

The sidecar has its own settings (backend, device, thresholds), documented in
[asr-service/README.md](asr-service/README.md).

---

## Audio matching

Upload a recitation, pick a matcher, and the studio produces a timeline of segments.
All four providers return the same shape and flow through the same timeline-building code,
so they can be swapped freely and compared on the same clip.

| Provider | Needs | Who picks the ayah range | Timing accuracy |
|---|---|---|---|
| **Forced Align** (`align`) | sidecar | detected from audio, or you | **Exact** — cannot drop or garble a word |
| **Gemini + Align** (`hybrid`) | API key **and** sidecar | Gemini identifies it | **Exact** — same aligner |
| **Gemini** (`gemini`) | API key | you | Approximate |
| **Local ASR** (`asr`) | sidecar | detected from audio | Low |

**Forced Align** is the recommended path. It is *given* the Quran text rather than asked to
guess it: the text becomes a fixed CTC target and the model decides only *when* each word was
spoken. Every reference word therefore gets a timestamp by construction, and there is no
corpus search that could put a phrase in the wrong surah.

**Gemini + Align** asks each model only the question it can actually answer. Gemini listens
and reports *which ayahs were recited, in what order* — no timestamps at all — and those
ranges become the reference text for the same local aligner. Recognition is a genuine LLM
strength; frame-accurate timing is not. This gives you exact timing without having to select
the right range yourself.

**Gemini** does both jobs in one call. Zero local setup, but an LLM has no frame-level time
grounding, so its timestamps are plausible estimates rather than measurements. Prefer `hybrid`
when the sidecar is available.

**Local ASR** freely transcribes the audio and fuzzy-searches the result against the whole
Quran. Kept for the case where no range is known and no API key is available; whatever the
recogniser mishears is simply lost. See [docs/ALIGNMENT.md](docs/ALIGNMENT.md) for why.

### Checking a match before you publish

Forced alignment cannot fail loudly: hand it any text and any audio and it returns a complete,
confident-looking timeline. A **wrong ayah range therefore produces plausible garbage, not an
error.**

The guard against that is `referenceCoverage` — the fraction of the supplied text the aligner
could actually account for. A correct reference gets walked to its end; a wrong one strands
most of itself. The sidecar raises a warning below 75% coverage and the studio surfaces it.

The response also carries `needsReview`, which is set when:

- the coverage warning fired, or
- the provider is `hybrid` (the range came from an LLM, so confirm it), or
- the provider is `gemini` (its timing is always an estimate).

`align` with a range you chose yourself and clean coverage is the only combination that comes
back without a review prompt.

**Do not read `confidence` as "this is the right passage."** For `gemini` it is a
self-assessed score that runs high regardless. For `align`/`hybrid` it is mean per-word
acoustic sharpness, which is useful for spotting a muddy recording but does *not* separate a
correct range from a wrong one — [docs/ALIGNMENT.md](docs/ALIGNMENT.md) has the measurements.

---

## Using the studio

The studio is one screen: **Source** on the left, the **preview** in the middle, the
**inspector** on the right, and the **timeline** running the full width beneath them. Nothing is
hidden behind a step — you can change the text, the timing and the styling in any order, which is
how the work actually goes.

**Source — what you are making**
1. Choose a reciter, surah and ayah range, then **Load ayahs & audio**.
2. Or upload your own recitation — audio **or video**. For a video, its audio drives the timing
   and a checkbox offers the footage as the background, synced to playback.
   - **Most accurate** detects the passage from the audio and times every word locally.
   - **Best for unknown passages** identifies it in the cloud, then times it on your machine.
   - **No setup** works with nothing installed, but the timing is estimated rather than measured.
   - Options that need something you do not have say so, and say what to do about it.
   - **Trim audio** is in the top toolbar and available at any point — before matching, after
     styling, even after a first export. Existing segment times are adjusted for you, so your
     timeline edits survive a re-trim.

**Timeline — when each ayah happens**
3. Each ayah is a block whose width is its real duration, drawn over the waveform of the audio.
4. Press <kbd>SPACE</kbd> to play. Tap <kbd>SPACE</kbd> again at the end of each ayah to set its
   boundary and move to the next one — the recitation keeps playing while you do.
5. Drag either edge of a block to adjust it. Moving an end pushes the following ayahs along so
   the timeline stays contiguous.
6. Click a block to select it. Zoom in when a boundary needs to land between two words.

**Inspector — what each ayah says**
7. **Ayah** holds the text, the translation, the ayah number, and a chip per word — tap a word to
   hide it from the video. Fine timing nudges (±0.2 s) are here too.
8. **Style** holds the aspect ratio, background, typography, card and watermark.

Then save the project and export.

> Built-in reciter timings are estimates. Set boundaries yourself on the timeline, or use AI
> matching, for accuracy. AI matching applies to uploaded audio only.

---

## Export

Exports use browser APIs: `canvas.captureStream()` for frames, a cloned `Audio` element routed
through Web Audio, and `MediaRecorder` with VP9/opus (falling back to VP8/opus, then generic
WebM). **Chrome or Chromium is recommended.** Output is `.webm`.

| Aspect ratio | Resolution |
|---|---|
| 9:16 | 1080×1920 |
| 16:9 | 1920×1080 |
| 1:1 | 1080×1080 |
| 4:5 | 1080×1350 |

---

## API reference

App routes:

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/quran/surahs` | All 114 surahs |
| `GET` | `/api/quran/verses?surah=&start=&end=&reciter=` | Verse data and audio URL |
| `POST` | `/api/audio/match` | Match audio to a timeline (`provider=align\|hybrid\|gemini\|asr`) |
| `GET` | `/api/audio/match` | Which providers are configured and reachable |
| `GET` `POST` | `/api/projects` | List / save projects |
| `GET` `POST` | `/api/exports` | List / save export records |

Sidecar routes (default `http://127.0.0.1:8000`) are documented in
[asr-service/README.md](asr-service/README.md#api).

Aligning a clip without starting the web app:

```bash
curl -s -X POST http://127.0.0.1:8000/align \
  -F "audio=@clip.mp3" \
  -F $'reference=33:21\tلَّقَدْ كَانَ لَكُمْ فِى رَسُولِ ٱللَّهِ' | python3 -m json.tool
```

---

## Project structure

```
src/app/                     Next.js pages and API routes
  api/audio/match/           Matcher endpoint and provider dispatch
  video-creator/             The studio page
src/components/              VideoCanvas, Timeline, Inspector, StyleConfigPanel,
                             GpuExportModal, SavedProjectsDrawer, AudioTrimModal
                             Dialog, Button, Status, OverflowMenu, PaletteSwitcher
src/db/                      Drizzle ORM connection and schema
src/lib/
  quranData.ts               Surahs, reciters, backgrounds, fonts, sample data
  quranCorpus.ts             Quran text fetch with a memoised chapter cache
  arabic.ts                  Arabic normalisation and fuzzy word matching
  matchTypes.ts              Shared segment/result shape for every provider
  matchTimeline.ts           Provider-agnostic segment -> timeline building
                             (also trimTimeline: clips/rebases segments to a trim window)
  forcedAligner.ts           Forced-align provider (recommended)
  hybridMatcher.ts           Gemini identifies, the local aligner times
  geminiMatcher.ts           Gemini provider
  asrAligner.ts              Local ASR provider
  audioTrim.ts               In-browser decode/slice/re-encode for the trim editor
  waveform.ts                Cached peak data for the timeline's waveform track
  verseEdits.ts              Pure timeline edits shared by the timeline and inspector
asr-service/                 Python sidecar
  app/align.py               CTC forced alignment, phrase segmentation, repeat detection
  app/asr.py                 Free-decode backends (wav2vec2 / nemo / whisper)
  app/vad.py                 Silero VAD pause detection
scripts/                     Standalone scripts reproducing the docs/ALIGNMENT.md measurements
docs/ALIGNMENT.md            Why alignment is built this way, with measurements
```

**Tech stack:** Next.js 16 (App Router), React 19, TypeScript (strict), Tailwind CSS v4,
Drizzle ORM + PostgreSQL, Quran.com API v4, FastAPI + PyTorch/torchaudio, Silero VAD.

### Development

```bash
npm run dev          # start the dev server
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run build        # production build
npm run db:push      # apply src/db/schema.ts to DATABASE_URL
npm run db:studio    # browse the database in Drizzle Studio
```

---

## Database (optional)

**You do not need this.** With `DATABASE_URL` unset, saved projects and export records are
kept in memory — everything works, but they disappear when the dev server restarts. Set up
Postgres only if you want saved clips to survive a restart.

Three tables are defined in [`src/db/schema.ts`](src/db/schema.ts): `projects`, `exports`,
and `preset_templates`.

### 1. Start Postgres

Any Postgres 14+ will do — a system install, a managed instance, or a container. With Podman
or Docker:

```bash
podman run -d --name quranclipper-db --restart=unless-stopped -e POSTGRES_USER=quranclipper -e POSTGRES_PASSWORD=quranclipper -e POSTGRES_DB=quranclipper -p 5432:5432 -v quranclipper-pgdata:/var/lib/postgresql/data docker.io/library/postgres:16-alpine
```

The named volume is what makes the data outlive the container. Swap `podman` for `docker` if
that is what you run; the arguments are identical.

Check it is accepting connections:

```bash
podman exec quranclipper-db pg_isready -U quranclipper
```

### 2. Point the app at it

Add the matching connection string to `.env.local`:

```bash
DATABASE_URL=postgres://quranclipper:quranclipper@127.0.0.1:5432/quranclipper
```

Use a real password if this is not a throwaway local database.

### 3. Create the tables

```bash
npm run db:push
```

This reads `DATABASE_URL` from `.env.local` and applies the schema directly — no migration
files, which suits a single-developer setup. Verify:

```bash
podman exec quranclipper-db psql -U quranclipper -d quranclipper -c '\dt'
```

You should see `exports`, `preset_templates`, and `projects`.

### 4. Restart the dev server

Next.js reads the environment at boot, so a running server will not pick up a newly added
`DATABASE_URL`. After restarting, **Save Project** reports `Project Saved!`; if it still says
`Saved (this session)`, the app is still on the in-memory fallback.

### Notes and gotchas

- **A placeholder `DATABASE_URL` is worse than none.** The API checks whether the variable is
  set, not whether it connects, so a leftover `postgres://USER:PASSWORD@HOST:PORT/DATABASE`
  bypasses the in-memory fallback and every save returns HTTP 500.
- **Re-run `npm run db:push` after editing `src/db/schema.ts`.**
- **Exported videos are not stored in the database.** Only metadata is; the video itself is a
  browser blob URL that dies with the tab.
- **If the container is not running, saves fail with a 500** — the same symptom as a bad
  `DATABASE_URL`, because the app cannot tell the difference. `--restart=unless-stopped` brings
  it back after a reboot, but only once the container runtime itself starts; on a desktop that
  usually needs `systemctl --user enable --now podman-restart.service`. Check with
  `podman ps` before assuming the app is at fault.
- Stop and start the database with `podman stop quranclipper-db` / `podman start
  quranclipper-db`. To wipe it completely, `podman rm -f quranclipper-db && podman volume rm
  quranclipper-pgdata`.

---

## Troubleshooting

**`POST /api/projects 500` and saving fails**
`DATABASE_URL` is set to something that cannot be reached — most often the placeholder
`postgres://USER:PASSWORD@HOST:PORT/DATABASE` left uncommented in `.env.local`. The API only
falls back to in-memory storage when the variable is *unset*, so a broken value fails every
save. Either comment the line out or follow [Database](#database-optional).

**"Sidecar unreachable" on the Forced Align / Local ASR buttons**
The sidecar isn't running, or `ASR_SERVICE_URL` is wrong. Start it and check
`curl http://127.0.0.1:8000/health`. The provider selector polls on page load, so reload
afterwards.

**"Backend not loaded" on Forced Align, or `/align` returns a `VersionError` about protobuf/onnx**
The sidecar is running under the wrong Python. Even with the virtualenv activated, bash can
still use a cached path to a different `uvicorn`. Fix it with:

```bash
cd asr-service && hash -r && ./run.sh
```

The sidecar prints which interpreter it is running as at startup when this happens, and
`/health` reports `alignReady: false` with the reason.

**The detected surah doesn't appear on the timeline**
The match failed, so nothing was updated and the studio kept your manual selection. Check the
status banner under the upload panel for the error — most often it is the backend problem
above.

**"Only N% of the supplied text could be matched to this audio"**
The ayah range doesn't match the recording, or the recording covers only part of it. Narrow
or correct the range and match again. This warning is working as intended — it is the main
protection against a confident-looking but wrong timeline.

**A word is smeared across several seconds**
Usually an unmodelled repeat: the reciter said something the reference text contains only
once. Long melodic elongation (*madd*) also legitimately produces multi-second words.

**The first alignment request is slow**
Model weights download on first use and load on first request. Later requests reuse the
cached model.

**Gemini returns 404 for the model**
The model ID in `GEMINI_MODEL` has been retired. Pick a current one from
[Google's model list](https://ai.google.dev/gemini-api/docs/models) and restart the dev server.

**Gemini returns 503 "high demand"**
A transient capacity error on Google's side. The client retries once automatically; if it
still fails, `hybrid` falls back to your selected range and says so in the result notes.

**No audio after "Load Ayahs & Audio Data"**
An error banner names the specific cause. Try a different reciter or upload your own file.

**Dev server freezes**
```bash
rm -rf .next
npx next dev --webpack
```

---

## Limitations

- **Always review an AI-generated timeline before publishing.** Forced alignment cannot report
  that it was handed the wrong text; coverage is a strong guard, not a guarantee.
- Range auto-detection needs the `nemo` align backend (the default), since it has to read the
  audio. Setting `ASR_ALIGN_BACKEND=wav2vec2` turns detection off and makes you supply the
  range; the studio shows a warning when the sidecar is in that state. If NeMo fails to load,
  the service says so with the reason rather than quietly downgrading — most often it means the
  service was started outside its virtualenv.
- Alignment assumes the recitation follows the reference text in order. Repeats are detected
  and inserted; out-of-order recitation is not handled.
- Range detection reports the ayah cluster carrying the most matched words, so a recitation
  that deliberately jumps between distant ayahs of the same surah is narrowed to its main
  span. That trade buys immunity to a single mislocated fragment widening a correct range.
- A multi-block reference (e.g. Al-Fatihah followed by another surah) is fragile: if the first
  block isn't actually in the audio, the phrase search can stall inside it. Low coverage flags
  this, but prefer one tight range when you know it.
- Word-level *timing accuracy* has not been formally measured — only coverage and ordering.
- The aligner holds the whole clip's CTC emissions in memory. Overlapping windows are stitched
  so it degrades gracefully, but this has been verified only at around 70 seconds; test before
  relying on it for long recordings.
- Repeat-detection thresholds in `align.py` were tuned on a single clip. Multi-word repeats
  clear them comfortably; single-word matches on very common words sit near the threshold.
- Gemini inline audio is limited to about 18 MB (roughly 15–20 minutes of MP3). Compress or
  split longer recordings. Trimming re-encodes to uncompressed WAV, which is *larger* than the
  original MP3 even after cutting — trim well past 18 MB and you can cross that limit rather
  than get under it.
- Browser export depends on `MediaRecorder` codec support; Chrome/Chromium recommended.
- In-memory saved projects are not durable — see [Database](#database-optional) for persistence.

---

## Credits

Quran text, translation, and word data from the [Quran.com API](https://api-docs.quran.com/).
Reciter audio from [mp3quran.net](https://mp3quran.net/). Background footage from
[Pexels](https://www.pexels.com/). Acoustic models from the Hugging Face community.

## License

Free for personal, educational, and other non-commercial use — see [LICENSE](LICENSE) for the
full terms. Commercial use requires separate written permission from the copyright holder.
