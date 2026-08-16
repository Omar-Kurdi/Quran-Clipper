# Quran alignment sidecar

A small FastAPI service that answers *when* each word of a recitation was spoken. The main
app talks to it over HTTP; it knows nothing about the app's data model.

It has two endpoints doing very different jobs.

**`POST /align` — forced alignment. This is the one to use.** You supply the audio *and* the
Quran text; it decides only the timing. Because the text is a fixed constraint rather than
something to guess, a word cannot go missing, come back garbled, or land in the wrong surah.
Consumed by the app's `align` and `hybrid` providers.

**`POST /transcribe` — free decode plus pause detection.** Answers "which Arabic words were
spoken, when, and where were the pauses?" with no reference text, for the app's `asr`
provider. Much less reliable: whatever the model mishears is lost, and the app then has to
fuzzy-search the whole Quran to recover.

The difference is stark in practice. On a 68-second test clip a general Arabic wav2vec2 model
free-decoded into unusable text, yet **the same model force-aligned all 53 reference words of
that clip correctly.** See [../docs/ALIGNMENT.md](../docs/ALIGNMENT.md) for the measurements.

---

## Setup

Requires **Python 3.11 or 3.12** and **ffmpeg** on PATH
(`sudo apt install ffmpeg` / `brew install ffmpeg`).

```bash
cd asr-service
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

On a machine **without an NVIDIA GPU**, install the CPU-only torch wheel first — the default
PyPI wheel bundles roughly 2–3 GB of CUDA libraries you will never load:

```bash
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
```

## Run

```bash
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

The first start downloads model weights (~1.2 GB). Check it with `curl http://127.0.0.1:8000/health`.

Then point the app at it, in the project root's `.env.local`:

```
ASR_SERVICE_URL=http://127.0.0.1:8000
AUDIO_MATCH_PROVIDER=align
```

> Always run it from the virtualenv (`source .venv/bin/activate`, or call `.venv/bin/uvicorn`
> directly). Running under a different Python is the usual cause of protobuf/onnx version
> errors on startup.

## Running without a GPU

Forced alignment is the one job here that is genuinely cheap on CPU, because it searches a
single fixed sequence rather than every possible one. Measured on an 8-core desktop CPU, a
68.5-second clip against a 53-word reference aligned in **4.4 seconds** (14 s on the first
request, which includes loading the model).

```bash
ASR_ALIGN_BACKEND=wav2vec2 ASR_WARM_UP=0 \
  uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Both settings matter on a CPU-only host:

- **`ASR_ALIGN_BACKEND=wav2vec2`** — the align backend prefers `nemo`, which needs the heavy
  optional `nemo_toolkit[asr]` install. The character model is ungated, needs nothing beyond
  `transformers`, and its weaker acoustics cost far less here than they would for decoding.

  Setting this is optional but recommended. With the variable **unset**, the service checks
  whether NeMo imports and falls back to `wav2vec2` on its own, logging why — so a host
  without NeMo works out of the box rather than failing every request. Setting it explicitly
  skips that check, and naming `nemo` turns a broken NeMo install into a loud error instead of
  a silent downgrade. `GET /health` always reports the backend actually in use.

- **`ASR_WARM_UP=0`** — warm-up loads the `ASR_BACKEND` model, which is what `/transcribe`
  uses. If you only serve `/align` (the `align` and `hybrid` providers), that is a second
  large model held in memory for nothing.

The trade-off: `wav2vec2` cannot auto-detect the ayah range, because detection requires
decoding the audio. `POST /align` without a `reference` returns HTTP 400 on this backend —
supply the range instead. The app's `hybrid` provider is designed for exactly this case: it
has Gemini identify the passage and the CPU aligner time it, with no local decode at all.

---

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `ASR_ALIGN_BACKEND` | auto | `nemo` or `wav2vec2` for `/align`. Unset = use NeMo if it imports. |
| `ASR_ALIGN_MODEL` | per backend | Override the alignment checkpoint. |
| `ASR_BACKEND` | `wav2vec2` | Decode backend for `/transcribe`: `wav2vec2`, `nemo`, or `whisper`. |
| `ASR_MODEL` | per backend | Override the decode checkpoint. |
| `ASR_DEVICE` | `auto` | Force `cuda` or `cpu`. |
| `ASR_WARM_UP` | `1` | Load the decode model at startup instead of on first request. |
| `ASR_NEMO_DECODER` | `rnnt` | `rnnt` or `ctc` for the hybrid NeMo model. |
| `ALIGN_MIN_REFERENCE_COVERAGE` | `0.75` | Below this fraction of matched text, `/align` sets `warning`. |
| `ALIGN_DIP_PERCENTILE` | `15` | Energy percentile treated as a phrase boundary. |
| `MAX_UPLOAD_MB` | `200` | Upload size limit. |
| `MAX_CHUNK_SECONDS` | `25` | Max decode chunk length for `/transcribe`. |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | CORS allow-list. |
| `LOG_LEVEL` | `INFO` | Python log level. |

---

## Backends

| `ASR_BACKEND` | Model | Notes |
|---|---|---|
| `wav2vec2` (default) | `jonatasgrosman/wav2vec2-large-xlsr-53-arabic` | Ungated, CPU-viable, no extra install. A general Arabic model, so noticeably weaker on recitation — but for *alignment* that matters far less than for decoding. |
| `nemo` | `Muno459/fastconformer-quran` | Best accuracy tested on recitation (trained on `tarteel-ai/everyayah`). Gated, and needs `pip install nemo_toolkit[asr]`. Required for range auto-detection. |
| `whisper` | `tarteel-ai/whisper-base-ar-quran` | Encoder-decoder. Doesn't share NeMo's RNNT quirk, but has Whisper's own known habit of hallucinating repeated text into silence. Shares the `transformers` dependency — no extra install. |

Whisper word timestamps are derived from cross-attention weights, which scale steeply with
model size — `IJyad/whisper-large-v3-Tarteel` exhausted a 16 GB GPU on this task, which is why
`base` is the default. Budget well beyond the weight size if you try a larger checkpoint.

### Enabling the NeMo backend

```bash
# 1. Accept the model terms while logged in at:
#    https://huggingface.co/Muno459/fastconformer-quran
# 2. Create a read token at https://huggingface.co/settings/tokens
pip install -U huggingface_hub
hf auth login          # `huggingface-cli login` on huggingface_hub < 1.0

# 3. Install the heavy dependency
pip install nemo_toolkit[asr]

# 4. Run with it
ASR_BACKEND=nemo uvicorn app.main:app --host 127.0.0.1 --port 8000
```

`nemo_toolkit[asr]` pulls in `pytorch-lightning`, `hydra-core`, `sentencepiece` and more. On
Python 3.13+ some of these lack prebuilt wheels and will try to build from source — use a 3.11
or 3.12 virtualenv for this service.

`ASR_MODEL` doesn't need setting; `Muno459/fastconformer-quran` is already the NeMo default.
That repo's root contains loose browsing copies that NeMo's generic `from_pretrained()` cannot
load, so the loader fetches the packaged `nemo/fastconformer-quran.nemo` checkpoint directly.

### RNNT vs CTC decoding (NeMo only)

`Muno459/fastconformer-quran` is a hybrid model with two jointly-trained decoder heads;
`ASR_NEMO_DECODER` selects which produces output.

- **`rnnt`** (default) advances through the audio one token at a time. Its known failure mode
  is occasionally skipping a stretch right after a pause — observed on real recitation with
  the whole clip as a single region, so not a chunking artifact.
- **`ctc`** computes one output per fixed frame, which structurally cannot skip ahead that way.

The comparison is mixed rather than a clean win. CTC recovered content RNNT consistently
missed, but also produced malformed tokens with invalid diacritics (`يُؤْمُِونَ`, `وَْلًِا`) that
correspond to nothing recited — and those dragged whole phrases to unrelated surahs during
matching. A missing word is safer than a confidently wrong segment, so `rnnt` remains the
default. Treat `ctc` as a per-recording experiment.

Hybrid-model CTC timestamp decoding has had compatibility issues on some NeMo versions
([NVIDIA-NeMo/Speech#12799](https://github.com/NVIDIA-NeMo/Speech/issues/12799)). If switching
fails the service logs a traceback and stays on RNNT rather than refusing to start.

### Tuning pause segmentation (`/transcribe`)

`min_silence_ms` (default `900`) decides what counts as a meaningful breath:

- **Lower (~200–400 ms)** gives more, shorter segments, but each decode sees less context.
  On real recitation this measurably *loses content* — whole clauses, not just tighter
  boundaries.
- **Higher (~900 ms+)** gives fewer, longer segments and recovers that content. A ~70 s clip
  showed no quality loss even at 4000 ms; longer recordings are untested at that extreme,
  which is why 900 ms ships as the default.

`vad_threshold` (default `0.3`) and `speech_pad_ms` (default `200`) work the same way: a lower
threshold catches quieter passages, and more padding keeps region boundaries off word onsets.
All three can be passed per request:

```bash
curl -s http://127.0.0.1:8000/transcribe \
  -F "audio=@clip.mp3" -F "min_silence_ms=1200" -F "vad_threshold=0.25" | python3 -m json.tool
```

---

## API

### `POST /align`

Multipart with `audio`, and optionally `reference`.

**Supply `reference`** to align a known range — one ayah per line, formatted
`surah:ayah<TAB>word word word`.

**Omit it to auto-detect the passage.** The service decodes the audio, locates each phrase in
the full Quran (downloaded once and cached under `~/.cache/quran-clip-creator/`), and aligns
against exactly the ayahs it found, returning them as `detectedRange`. This requires the
`nemo` align backend.

```jsonc
{
  "success": true,
  "audioDuration": 68.497,
  "words": [
    { "text": "لَّقَدْ", "verse_key": "33:21", "word_index": 0,
      "start": 0.18, "end": 0.48, "score": 0.51, "is_repeat": false }
  ],
  "segments": [
    { "verse_key": "33:21", "start_word": 0, "end_word": 6,
      "start": 0.24, "end": 4.78, "score": 1.0, "is_restart": false }
  ],
  "detectedRange": { "surah": 33, "start_ayah": 21, "end_ayah": 23,
                     "confidence": 0.9, "matched_phrases": 10, "total_phrases": 11 },
  "meanScore": 0.2923,
  "referenceCoverage": 1.0,
  "warning": null
}
```

Segments are phrase-level: boundaries come from the audio's own energy dips and each phrase's
word range from decoding it. **Consecutive segments may overlap in word range** — that is a
reciter restarting an earlier phrase and carrying further (`is_restart`), not a bug.

### Reading the confidence fields

Forced alignment cannot fail loudly: hand it any text and any audio and it returns a complete,
monotonic, confident-looking timeline. A wrong ayah range produces plausible garbage, not an
error.

**`referenceCoverage` is the field that detects this**, not `meanScore`. It is the fraction of
the supplied text the phrase assignment actually consumed — a correct reference gets walked to
its end, a wrong one strands most of itself. Measured on the reference clip against six wrong
ranges and one too-wide range:

| Reference | `meanScore` | `referenceCoverage` |
|---|---|---|
| **33:21–23 (correct)** | 0.2923 | **1.00** |
| 1:1–7 | 0.1475 | 0.28 |
| 2:1–10 | 0.2077 | 0.26 |
| 36:1–12 | 0.2263 | 0.07 |
| 112:1–4 | **0.2550** | 0.60 |
| 33:1–5 | 0.2057 | 0.07 |
| 18:60–82 | 0.2086 | 0.04 |
| 33:21–30 (too wide) | 0.2923 | 0.33 |

An unrelated 15-word surah reaches 87% of the correct `meanScore`, so no threshold on that
column works. Coverage separates every case. `warning` is set below
`ALIGN_MIN_REFERENCE_COVERAGE` (0.75) — the exact cut is not load-bearing given that
separation.

Treat `meanScore` as a diagnostic of alignment *sharpness*, not of whether the passage is right.

Two caveats:

- **Validated on one 68-second clip.** On long audio the phrase beam search may legitimately
  fail to walk a several-hundred-word reference to its end. If coverage warnings appear on
  recitations you know are correct, raise `ALIGN_MIN_REFERENCE_COVERAGE` before concluding the
  alignment is wrong.
- **Multi-block references are the fragile case.** A reference built from more than one block
  (auto-detection, or the app's `hybrid` provider) is concatenated and walked with a forward
  cursor from word 0. If the first block isn't in the audio, the search may never escape it:
  a reference of `1:1-7` + `33:21-23` against audio containing only 33:21–23 emitted segments
  for 1:1–1:2 and never reached Al-Ahzab. Coverage caught it (0.10), but the timeline was
  unusable rather than merely padded. Prefer one tight range when you know it.

### `POST /transcribe`

Free decode, no reference text. Multipart with `audio`, plus optional `vad_threshold`,
`min_silence_ms`, `min_speech_ms`, `speech_pad_ms`.

```jsonc
{
  "success": true,
  "audioDuration": 84.32,
  "transcript": "...",
  "words": [{ "text": "بسم", "start": 0.62, "end": 1.05, "score": 0.91 }],
  "voicedRegions": [{ "start": 0.6, "end": 8.4, "wordCount": 12, "text": "..." }]
}
```

### `GET /health`

Reports the decode backend, the align backend actually in use, and whether range
auto-detection is available:

```jsonc
{
  "status": "ok",
  "backend": "wav2vec2",
  "model": "jonatasgrosman/wav2vec2-large-xlsr-53-arabic",
  "alignBackend": "wav2vec2",
  "alignModel": "jonatasgrosman/wav2vec2-large-xlsr-53-arabic",
  "canAutoDetectRange": false,
  "sampleRate": 16000
}
```
