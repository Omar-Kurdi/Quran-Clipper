# Quran alignment sidecar

A small FastAPI service that answers *when* each word of a recitation was spoken. The main
app talks to it over HTTP; it knows nothing about the app's data model.

It has two endpoints doing very different jobs.

**`POST /align` — forced alignment. This is the one to use.** You supply the audio *and* the
Quran text; it decides only the timing. Because the text is a fixed constraint rather than
something to guess, a word cannot go missing, come back garbled, or land in the wrong surah.
Consumed by the app's `align` provider -- "Local" in the studio.

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
(`sudo apt install ffmpeg` / `brew install ffmpeg`). Not 3.13+: several dependencies have no
wheels for it and fall back to building from source.

The default align model is **gated**, so do this first, once:

1. Accept its terms while logged in at <https://huggingface.co/Muno459/fastconformer-quran>.
2. Create a read token at <https://huggingface.co/settings/tokens>.

Then:

```bash
cd asr-service
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
hf auth login                 # paste the read token
```

On a machine **without an NVIDIA GPU**, install the CPU-only torch wheel first — the default
PyPI wheel bundles roughly 2–3 GB of CUDA libraries you will never load:

```bash
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
```

`requirements.txt` includes `nemo_toolkit[asr]`, which is a large install. It is required
rather than optional: `ASR_ALIGN_BACKEND` defaults to `nemo`, and NeMo is the only backend that
can work the surah out from the audio. If it will not install on your platform, comment it out
and set `ASR_ALIGN_BACKEND=wav2vec2` -- see [Giving up range detection](#giving-up-range-detection).

## Run

```bash
./run.sh                      # or: ./run.sh --host 0.0.0.0 --port 8000
```

`run.sh` calls this project's `.venv/bin/python` by absolute path, which is the only reliable
way to start it — see [Don't start it with a bare `uvicorn`](#dont-start-it-with-a-bare-uvicorn).

The first start downloads model weights (~1.2 GB). Check it with `curl http://127.0.0.1:8000/health`
— `alignReady` must be `true`.

Then point the app at it, in the project root's `.env.local`:

```
ASR_SERVICE_URL=http://127.0.0.1:8000
AUDIO_MATCH_PROVIDER=align
```

### Don't start it with a bare `uvicorn`

Typing `uvicorn app.main:app` can silently run the service under a **different Python** than
the virtualenv, even with the venv activated. Bash caches the path of every command it
resolves, so a shell that ran `uvicorn` before activation keeps using the old one — `hash -r`
clears that cache.

The symptom is unmistakable once you know it: NeMo fails to import against the wrong
interpreter's protobuf/onnx, and every `/align` returns HTTP 400 with a `VersionError`. The
service now checks for this at startup and prints which interpreter it is running as, which
one it expected, and the command to fix it. `GET /health` reports the same via `alignReady`
and `alignError`, and the studio shows it on the **Local** button before you upload
anything.

If you prefer not to use `run.sh`, call the binary directly — `.venv/bin/uvicorn app.main:app`
— rather than relying on `PATH`.

## Running without a GPU

Forced alignment is the one job here that is genuinely cheap on CPU, because it searches a
single fixed sequence rather than every possible one. Measured on an 8-core desktop CPU, a
68.5-second clip against a 53-word reference aligned in **4.4 seconds** (14 s on the first
request, which includes loading the model).

**Keep the default `nemo` align backend even on CPU.** It is what decodes the audio to work
out which surah is being recited, and that is the feature most of the app is built around.
NeMo is a heavy install but it is not GPU-only; `ASR_DEVICE` handles the rest.

```bash
ASR_WARM_UP=0 uvicorn app.main:app --host 127.0.0.1 --port 8000
```

`ASR_WARM_UP=0` skips loading the `ASR_BACKEND` model at startup, which is what `/transcribe`
uses. If you only serve `/align` that is a second large model held in memory for nothing.

### Giving up range detection

`ASR_ALIGN_BACKEND=wav2vec2` swaps in an ungated character model that needs nothing beyond
`transformers`. Its weaker acoustics matter far less for alignment than they would for
decoding — but it **cannot detect the ayah range**, because detection requires decoding the
audio. `POST /align` without a `reference` then returns HTTP 400, and the app falls back to
whatever range is selected in its UI (and says so).

Choose it only when NeMo genuinely will not install. It is never selected automatically: an
earlier version probed whether NeMo imported and switched silently, which turned a fixable
environment problem — typically the service started outside its virtualenv — into what looked
like a permanent limitation, and cost every user range detection without telling them. Now a
broken NeMo raises an error naming the cause. `GET /health` reports the backend in use and a
`canAutoDetectRange` flag.

---

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `ASR_ALIGN_BACKEND` | `nemo` | Backend for `/align`. `wav2vec2` disables ayah-range detection. |
| `ASR_ALIGN_MODEL` | per backend | Override the alignment checkpoint. |
| `ASR_BACKEND` | `wav2vec2` | Decode backend for `/transcribe`: `wav2vec2`, `nemo`, or `whisper`. |
| `ASR_MODEL` | per backend | Override the decode checkpoint. |
| `ASR_DEVICE` | `auto` | Force `cuda` or `cpu`. |
| `ASR_WARM_UP` | `1` | Load the decode model at startup instead of on first request. |
| `ASR_NEMO_DECODER` | `rnnt` | `rnnt` or `ctc` for the hybrid NeMo model. |
| `ALIGN_MIN_REPEAT_MATCH` | `0.75` | How much of a repeated phrase's spelling must be heard in the gap it explains. |
| `ALIGN_MAX_REPEAT_WORDS` | `4` | How far back a reciter is assumed to go when resuming. |
| `ALIGN_QUIET_PERCENTILE` | `16` | Rank of frame energy treated as "not making sound", for segment breaks. |
| `ALIGN_MIN_UNMARKED_PAUSE_SEC` | `0.30` | Silence needed to end a line with no waqf mark licensing it — a reciter may stop anywhere. Raise it if lines break mid-phrase. |
| `ALIGN_MIN_RESTART_GAP_SEC` | `0.30` | Least time between two utterances of a word for it to count as repeated. |
| `ALIGN_MIN_WAQF_PAUSE_SEC` | `0.30` | Pause needed on a stop mark for it to end a line. |
| `ALIGN_MIN_DECODE_AGREEMENT` | `0.40` | Below this agreement between decode and alignment, `/align` sets `warning`. This is the wrong-passage guard. |
| `ALIGN_MIN_REFERENCE_COVERAGE` | `0.75` | Below this fraction of the supplied text being recited at all, `/align` sets `warning`. |
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
| `nemo` | `Muno459/fastconformer-quran` | Best accuracy tested on recitation (trained on `tarteel-ai/everyayah`). Gated -- needs a Hugging Face login. Installed by `requirements.txt`. Required for range auto-detection. |
| `whisper` | `tarteel-ai/whisper-base-ar-quran` | Encoder-decoder. Doesn't share NeMo's RNNT quirk, but has Whisper's own known habit of hallucinating repeated text into silence. Shares the `transformers` dependency — no extra install. |

Whisper word timestamps are derived from cross-attention weights, which scale steeply with
model size — `IJyad/whisper-large-v3-Tarteel` exhausted a 16 GB GPU on this task, which is why
`base` is the default. Budget well beyond the weight size if you try a larger checkpoint.

### Enabling the NeMo backend

Nothing to install -- `requirements.txt` already carries `nemo_toolkit[asr]`, and `nemo` is the
default backend for `/align`. What it does need is access to its gated model:

```bash
# 1. Accept the model terms while logged in at:
#    https://huggingface.co/Muno459/fastconformer-quran
# 2. Create a read token at https://huggingface.co/settings/tokens
# 3. Log in from this service's virtualenv
hf auth login          # `huggingface-cli login` on huggingface_hub < 1.0
```

Without that the weights download returns 401 and `/align` fails on every request. The service
looks for a stored token at startup and warns when it finds none, so this lands in the log
rather than as a mystery 502 in the studio.

To use NeMo for free decoding (`/transcribe`) as well, set `ASR_BACKEND=nemo`; `/align` already
uses it.

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

The `audio` part may be a **video** container (MP4 / MOV / WebM / MKV) as well as bare audio —
ffmpeg selects the audio stream, so callers need not strip it first.

**Supply `reference`** to align a known range — one ayah per line, formatted
`surah:ayah<TAB>word word word`.

**Omit it to auto-detect the passage.** The service decodes the audio, locates each phrase in
the full Quran (downloaded once and cached under `~/.cache/quran-clip-creator/`), and aligns
against exactly the ayahs it found, returning them as `detectedRange`. This requires the
`nemo` align backend (the default).

Each phrase is located independently and the results pooled, so a repeat is harmless — it just
lands on the same place twice. The reported span is the *cluster* of ayahs carrying the most
matched words, not the outer envelope of every match: a short fragment truncated at a phrase
boundary can genuinely match elsewhere in the same surah (`ٱللَّهُ وَرَسُولُهُۥ` occurs in both 33:12
and 33:22), and one such match must not be able to widen a correct range. Strays are dropped
with a log line naming them.

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
  "meanScore": 0.6960,
  "referenceCoverage": 1.0,
  "decodeAgreement": 0.888,
  "warning": null
}
```

Segments are groupings of consecutive aligned words, so a segment never spans audio its own
words do not cover. A line ends at an ayah boundary, where the reciter went back on themselves,
at a mushaf stop mark they actually paused on, or at a silence long enough that nothing else
explains it. The mark does most of the work: pause length alone cannot tell a phrase ending from
an ordinary breath, so breaking without one needs far stronger evidence
(`ALIGN_MIN_UNMARKED_PAUSE_SEC`). See [../docs/ALIGNMENT.md](../docs/ALIGNMENT.md).
**Consecutive segments may overlap in word range** — that is a reciter restarting an earlier
phrase and carrying further (`is_restart`), not a bug.

### Reading the confidence fields

Forced alignment cannot fail loudly: hand it any text and any audio and it returns a complete,
monotonic, confident-looking timeline. A wrong ayah range produces plausible garbage, not an
error.

**`decodeAgreement` is the field that detects this**, not `meanScore` and no longer
`referenceCoverage`. It compares two independent readings of the same seconds: what the
recogniser freely heard there, against what the aligner placed there. Measured across two clips:

| Clip | Reference | `decodeAgreement` | `meanScore` | `referenceCoverage` |
|---|---|---|---|---|
| test.mp3 | **33:21–23 (correct)** | **0.888** | 0.696 | 1.000 |
| test.mp3 | 2:1–5 | 0.020 | 0.947 | 0.028 |
| test.mp3 | 33:1–3 (same surah) | 0.121 | 0.348 | 0.097 |
| test.mp3 | 36:1–8 | 0.035 | 0.001 | 1.000 |
| test.mp3 | 18:10–12 | 0.020 | 0.947 | 0.031 |
| test.mp3 | 33:21–22 (real subset) | 0.479 | 0.651 | 1.000 |
| test3.mp3 | **2:121–125 (correct)** | **0.873** | 0.684 | 0.824 |
| test3.mp3 | 7:40–45 | 0.010 | 0.000 | 1.000 |

Two wrong ranges score **0.947** on `meanScore` against 0.696 for a correct one — a confident
path over the wrong words is still a confident path. And `referenceCoverage` reads 1.000 on
three wrong ranges: one global forced alignment gives every reference word a timestamp whether
the text belongs to the audio or not, so coverage is now a completeness check on the sidecar
rather than evidence about the passage. A reference covering only *part* of its audio lands
between the two (0.479), which is the right shape — it is narrow, not wrong.

`warning` is set below `ALIGN_MIN_DECODE_AGREEMENT` (0.40), and separately when coverage shows
supplied text that was never recited.

**This check only runs on the `nemo` align backend.** The threshold is calibrated against a
Quran-tuned decode; the general Arabic model used by `ASR_ALIGN_BACKEND=wav2vec2` free-decodes
into unreadable text, so it would disagree just as much with a *correct* alignment. On that
backend `decodeAgreement` comes back `null` and the guard sits out — which also means a wrong
ayah range goes undetected there.

Treat `meanScore` as a diagnostic of alignment *sharpness*, not of whether the passage is right.

Two caveats:

- **The separation is measured on two clips, not many.** If agreement warnings appear on
  recitations you know are correct, raise `ALIGN_MIN_DECODE_AGREEMENT` before concluding the
  alignment is wrong — and note that a heavily reverberant or very fast recording lowers the
  decode side without the alignment being wrong.
- **Multi-block references are the fragile case.** A reference built from more than one block
  (auto-detection) is concatenated and walked with a forward
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

Reports the decode backend, the align backend in use, whether that backend actually loaded,
and whether range auto-detection is available:

```jsonc
{
  "status": "ok",
  "backend": "wav2vec2",
  "model": "jonatasgrosman/wav2vec2-large-xlsr-53-arabic",
  "alignBackend": "nemo",
  "alignModel": "Muno459/fastconformer-quran",
  "alignReady": true,          // false => every /align call will fail
  "alignError": null,          // why, when alignReady is false
  "canAutoDetectRange": true,
  "sampleRate": 16000
}
```

`status` is `"ok"` whenever the process is up, so **check `alignReady`, not `status`**, before
concluding the service is usable. The two differ exactly in the case worth catching: a service
that answers requests but cannot align anything.
