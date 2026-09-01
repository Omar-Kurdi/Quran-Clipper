# Quran Clipper - Studio

<p align="center">
  <img src="docs/screenshots/Banner.png" alt="Banner.">
</p>
A Next.js studio for creating short-form Quran recitation videos. Select ayahs, choose a
reciter or upload your own recitation, sync verse timings, style the canvas, pick an animated
background, and export the result — all in the browser.

Its distinguishing feature is how it times uploaded audio. Instead of asking a model to guess
what was recited and when, it takes the *known* Quran text as a fixed constraint and solves
only for timing. A word cannot go missing, come back garbled, or land in the wrong surah —
those are structural properties of the method, not tuning. See [docs/ALIGNMENT.md](docs/ALIGNMENT.md).

<p align="center">
  <img src="docs/screenshots/QuranClipper_Studio.png" alt="The same studio in the Slate & Amber theme, showing the runtime theme switcher.">
</p>
<p align="center"><sub>Five themes ship, switchable at runtime from the header.</sub></p>

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
- All 114 surahs with Arabic/English metadata, Uthmani text, word-level data and English
  translation (Quran.com API, translation `131` — The Clear Quran).
- Six reciters. The three marked **timed** carry per-ayah boundaries measured from the
  recording, published by Quran.com; loading them gives a real timeline, and the recording is
  streamed through `/api/audio/proxy`. The rest stream from mp3quran.net with boundaries
  estimated from text length, which have to be corrected on the timeline by hand.

  | Reciter | Arabic | Style | Timings |
  |---|---|---|---|
  | Abdul Rahman Al-Sudais | عبد الرحمن السديس | Murattal | timed |
  | Maher Al-Muaiqly | ماهر المعيقلي | Murattal | estimated |
  | Yasser Al-Dosari | ياسر الدوسري | Emotional | timed |
  | Saud Al-Shuraim | سعود الشريم | Murattal | timed |
  | Saad Al-Ghamdi | سعد الغامدي | Murattal | estimated |
  | Raad Al-Kurdi | رعد محمد الكردي | Emotional | estimated |

**Timing your own audio**
- Two interchangeable matching providers behind one endpoint — see [Audio matching](#audio-matching).
- Forced alignment runs locally, on GPU or CPU, and never sends your audio anywhere.
- Repeated phrases are detected acoustically and get their own segments.
- Phrase-level display: each segment carries only the words actually spoken, so a repeated
  half-ayah shows exactly those words rather than the whole verse.
- Full-ayah English translation under the Arabic.
- **Multiple backgrounds, four ways** — one clip, one per ayah, cycling on a timer, or shuffled
  (repeatably, so a re-export matches the preview). Video and stills mix freely in one sequence.
  Every selected background is preloaded in its own element, so switching never stalls the
  render — which does mean each one decodes concurrently, so a handful is kinder to the export
  than all of them.
- **Your own backgrounds, kept between sessions.** Uploading a file or pasting a link adds it
  to the list beside the presets, and to whichever mode is selected — the sequence in the multi
  modes, the lane in a hand-cut one. Uploaded files are stored in the browser's IndexedDB, so
  they are still there after a restart; links are stored as links. An entry whose file can no
  longer be found — cleared browser storage, a link that stopped working — is kept as a
  placeholder rather than silently dropped, so you can add it again or remove it deliberately.
  Deleting asks for confirmation and takes the background out of the sequence and the lane
  with it.

  Saved *projects* still reference backgrounds by URL, so a project that used an uploaded file
  will not find it again in a later session — the background list will have it, but the project
  will not re-select it.
<p align="center">
  <img src="docs/screenshots/QuranClipper_BackgroundPicker.png" alt="The studio view showing the background picker section.">
</p>
- **A real timeline.** Each ayah is a block whose width is its actual duration, drawn over the
  waveform of the recitation. Drag an edge to retime it, or tap **B** at each boundary while
  the audio plays (SPACE plays and pauses). Changes cascade so the timeline stays contiguous.
- **Trim / crop uploaded audio** with a waveform editor — a scrubbable playhead and a time
  ruler show exactly where you are, zoom (up to 16×) resolves the waveform for fine cuts, and
  start/end are entered as timecodes (`3:31.7`). Drag the handles, or park the playhead and
  press *Start here* / *End here*. Works before matching (cut dead air first) or after (cut the
  matched timeline down); the segment times adjust to the new clip automatically either way.
  Preview plays the decoded buffer the cut is taken from, not the original container, so what
  you hear is sample-for-sample what you get. Runs entirely in the browser, no upload or server
  round-trip, and is reachable from the top toolbar at any step.
- **Trim from the timeline too.** With an uploaded file loaded, a clip lane sits above the
  ruler; drag either handle and the playhead follows it, so the preview shows the frame and
  the sound at the cut while you place it. **Keep 0:09.0** applies it — the same edit the
  dialog makes, without covering the thing being trimmed.
<p align="center">
  <img src="docs/screenshots/QuranClipper_Trimmer.png" alt="The studio view showing the trimmer section.">
</p>
- **Upload video as well as audio** (MP4 / MOV / WebM / MKV). The audio track drives the
  timing, and the footage can double as the clip background — kept frame-synced to playback
  rather than looped, so a recorded recitation stays in sync. Trimming the audio offsets the
  background automatically instead of discarding it.

**Styling and export**
- Aspect ratios 9:16, 16:9, 1:1, 4:5.
- 11 Pexels video backgrounds, plus any video or image you paste a link to or upload — stills
  render exactly like footage.
- Configurable fonts, sizes, colours, shadows, card opacity, surah badge, and watermark.
  Arabic defaults to Scheherazade New and auto-shrinks to stay inside the card. Each colour
  offers eleven swatches, hue/saturation/lightness sliders, a hex field, and the system colour
  picker in the last cell of the grid.
<p align="center">
 <img src="docs/screenshots/QuranClipper_Layout.png" alt="The studio view showing the trimmer section.">
 <img src="docs/screenshots/QuranClipper_Card_Branding.png" alt="The studio view showing the trimmer section.">
</p>
- Browser export via `canvas.captureStream()` + `MediaRecorder` (WebM, 18 Mbps, 30 or 60 FPS).
  The save dialog offers `[Surah]_[surah]:[first]-[last]_[timestamp].webm` — for example
  `Al-Fatihah_1:1-7_1764503112000.webm` — so several renders of the same passage can sit in one
  folder without colliding. The range is read off the timeline rather than the ayahs you asked
  for, so a clip trimmed down to ayahs 2–3 is named `1:2-3` and not `1:1-7`. Windows has no
  colon in filenames and the browser substitutes one character when saving there.
- Save, reopen and delete projects with PostgreSQL, or in-memory when no database is
  configured — see [Database](#database-optional) for a five-minute container setup. Deleting
  asks for confirmation and only drops the row from the drawer once the server confirms it is
  gone.

---

## Quick start

### Prerequisites

| | Needed for |
|---|---|
| **Node.js 20+** | the web app (required) |
| **Python 3.11 or 3.12** + **ffmpeg** on PATH | local forced alignment (recommended) |
| **Hugging Face account** (free) | local forced alignment — its model is gated |
| **PostgreSQL** | durable saved projects (optional) |
| **Gemini API key** | the cloud matching provider (optional) |

The app runs with Node alone. Everything else unlocks an optional capability.

### 1. Install and run the web app

```bash
npm install
npm run dev
```

Open <http://localhost:3000/video-creator>. You can already browse surahs, load reciter audio,
style the canvas, manually sync timings, and export.

### 2. Get access to the alignment model

The alignment model is a **gated** Hugging Face repo, so an anonymous download returns 401.
Three one-off steps, before installing anything:

1. Accept its terms while logged in at
   <https://huggingface.co/Muno459/fastconformer-quran>.
2. Create a **read** token at <https://huggingface.co/settings/tokens>.
3. Keep it to hand — you log in with it at the end of the next step.

### 3. Install the alignment sidecar (recommended)

This is what times uploaded audio accurately. It is a separate Python service.

**Python 3.11 or 3.12 specifically.** Several of its dependencies have no wheels for 3.13+ and
will try to build from source.

```bash
cd asr-service
python3.12 -m venv .venv
source .venv/bin/activate
```

**No NVIDIA GPU** (including most VPS hosts) — install the CPU-only PyTorch wheel first, which
avoids pulling ~2–3 GB of unused CUDA libraries:

```bash
pip install torch --index-url https://download.pytorch.org/whl/cpu
```

Then, on any machine:

```bash
pip install -r requirements.txt
hf auth login          # paste the read token from step 2
```

That pulls the full alignment stack, NeMo included — a few GB, and several minutes on a slow
connection. It is not optional: NeMo is the only backend that can work the surah out from the
audio for you.

### 4. Start the sidecar

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

Then reload the studio page — the **Local** matcher will show "Ready".

> **CPU-only hosts:** everything here runs on CPU — a 68-second clip aligns in about 4 seconds
> on an 8-core machine, because it searches one fixed text rather than every possible sentence.
> Keep the default NeMo backend even without a GPU: it is what reads the audio to work out the
> surah for you. `ASR_ALIGN_BACKEND=wav2vec2` avoids that dependency but **gives up surah
> detection**, so reach for it only if NeMo genuinely won't install.
> See [asr-service/README.md](asr-service/README.md#running-without-a-gpu).

### 5. Configure keys (optional)

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
| `ASR_SERVICE_URL` | forced alignment | `http://127.0.0.1:8000` | Where the Python sidecar is listening. |
| `AUDIO_MATCH_PROVIDER` | — | `gemini` | Fallback for API calls that name no provider. The studio always names one and defaults to `align`, so this only affects direct `/api/audio/match` requests. |
| `GEMINI_API_KEY` | the `gemini` provider | — | From [Google AI Studio](https://aistudio.google.com/apikey). `GOOGLE_API_KEY` also works. |
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
Both providers return the same shape and flow through the same timeline-building code, so
they can be swapped freely and compared on the same clip.

| Provider | Needs | Who picks the ayah range | Timing accuracy |
|---|---|---|---|
| **Local** (`align`) | sidecar | detected from audio, or you | **Exact** — cannot drop or garble a word |
| **Online** (`gemini`) | API key | you | Approximate |

**Local** is the recommended path. It is *given* the Quran text rather than asked to
guess it: the text becomes a fixed CTC target and the model decides only *when* each word was
spoken. Every reference word therefore gets a timestamp by construction, and there is no
corpus search that could put a phrase in the wrong surah.

**Online** does both jobs in one call. Zero local setup, but an LLM has no frame-level time
grounding, so its timestamps are plausible estimates rather than measurements — expect to
correct the boundaries by hand. Prefer `align` whenever the sidecar is available.

### Checking a match before you publish

Forced alignment cannot fail loudly: hand it any text and any audio and it returns a complete,
confident-looking timeline. A **wrong ayah range therefore produces plausible garbage, not an
error.**

The guard against that is `decodeAgreement` — how far what the recogniser *heard* in each
second agrees with what the aligner *placed* there. Two independent readings of the same audio
describe the same recitation when the text is right, and stop agreeing when it is not: measured
across two clips, 0.89 and 0.87 for the correct range against 0.01–0.12 for six wrong ones. The
sidecar raises a warning below 0.40 and the studio surfaces it.

`referenceCoverage` used to be this guard and no longer can be. Timing now comes from one
global forced alignment, which gives every reference word a timestamp by construction, so
coverage reads 1.00 for a wrong range as readily as for the right one. It is still reported as
a completeness check — how much of the text you supplied was actually recited.

The response also carries `needsReview`, which is set when:

- the sidecar warning fired, or
- the provider is `gemini` (its timing is always an estimate).

`align` with a range you chose yourself and no warning is the only combination that comes
back without a review prompt.

**Do not read `confidence` as "this is the right passage."** For `gemini` it is a
self-assessed score that runs high regardless. For `align` it is mean per-word
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
   - **Local** detects the passage from the audio and times every word locally.
   - **Online** works with nothing installed, but the timing is estimated rather than measured.
   - Options that need something you do not have say so, and say what to do about it.
   - **Trim audio** is in the top toolbar and available at any point — before matching, after
     styling, even after a first export. Existing segment times are adjusted for you, so your
     timeline edits survive a re-trim.

**Timeline — when each ayah happens**
3. Each ayah is a block whose width is its real duration, drawn over the waveform of the audio.
4. Press <kbd>SPACE</kbd> to play or pause. Tap <kbd>B</kbd> at the end of each ayah to set its
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
| `POST` | `/api/audio/match` | Match audio to a timeline (`provider=align\|gemini`) |
| `GET` | `/api/audio/match` | Which providers are configured and reachable |
| `GET` `POST` | `/api/projects` | List / save projects |
| `DELETE` | `/api/projects?id=` | Delete one saved project (`404` if it is already gone) |
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
  arabic.ts                  Arabic normalisation
  matchTypes.ts              Shared segment/result shape for every provider
  matchTimeline.ts           Provider-agnostic segment -> timeline building
                             (also trimTimeline: clips/rebases segments to a trim window)
  forcedAligner.ts           Local forced-align provider (recommended)
  geminiMatcher.ts           Online Gemini provider
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
- **If the container is not running, saves fail with a 500.** The response says which failure
  it was — `connect ECONNREFUSED 127.0.0.1:5432 — the database named by DATABASE_URL is not
  reachable…` — and the reason is on the **Save project** button as a tooltip. Start the
  container and try again. `--restart=unless-stopped` brings it back after a reboot, but only
  once the container runtime itself starts; on a desktop that usually needs
  `systemctl --user enable --now podman-restart.service`. Check with `podman ps` before
  assuming the app is at fault.
- Stop and start the database with `podman stop quranclipper-db` / `podman start
  quranclipper-db`. To wipe it completely, `podman rm -f quranclipper-db && podman volume rm
  quranclipper-pgdata`.

---

## Troubleshooting

**`POST /api/projects 500` and saving fails**
Read the `error` in the response — it names the cause and, for the two common ones, the fix.
Hovering **Save project** in the studio shows the same line. `connect ECONNREFUSED` means the
database is not running (`podman start quranclipper-db`); `column … does not exist` means the
schema is behind (`npm run db:push`). The other frequent cause is a `DATABASE_URL` that is set
but unreachable — most often the placeholder `postgres://USER:PASSWORD@HOST:PORT/DATABASE`
left uncommented in `.env.local`. The API only falls back to in-memory storage when the
variable is *unset*, so a broken value fails every save. Either comment the line out or follow
[Database](#database-optional).

**`pip install -r requirements.txt` fails on `nemo_toolkit`**
Almost always Python 3.13+, which has no wheels for several of its dependencies and falls back
to building from source. Rebuild the virtualenv with `python3.12 -m venv .venv`. If NeMo will
not install on your platform at all, comment it out of `asr-service/requirements.txt` and set
`ASR_ALIGN_BACKEND=wav2vec2` — everything else keeps working, but the sidecar can no longer
work the surah out from the audio, so `/align` uses the range selected in the studio.

**`/align` fails with a 401 or `GatedRepoError`**
`Muno459/fastconformer-quran` is a gated repo and the machine has no Hugging Face credential.
Accept its terms at <https://huggingface.co/Muno459/fastconformer-quran>, create a read token,
then run `hf auth login` inside `asr-service/.venv`. The sidecar warns about this at startup
when it finds no stored token.

**"Helper not running" on the Local button**
The sidecar isn't running, or `ASR_SERVICE_URL` is wrong. Start it and check
`curl http://127.0.0.1:8000/health`. The provider selector polls on page load, so reload
afterwards.

**"Backend not loaded" on Local, or `/align` returns a `VersionError` about protobuf/onnx**
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
still fails, switch to the **Local** matcher or try again in a minute.

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
  that it was handed the wrong text; decode agreement is a strong guard, not a guarantee.
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
  block isn't actually in the audio, the phrase search can stall inside it. Low decode
  agreement flags this, but prefer one tight range when you know it.
- Word-level *timing accuracy* has been measured on one 220-second recitation against per-ayah
  ground truth: all 177 words placed, mean ayah-start error 0.48s. Segment-level accuracy is
  tracked by `scripts/eval_segments.py`, currently 8 of 11 on the reference clip.
- The aligner holds the whole clip's CTC emissions in memory. Overlapping windows are stitched
  so it degrades gracefully; verified at 220 seconds, so test before relying on it for
  substantially longer recordings.
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
