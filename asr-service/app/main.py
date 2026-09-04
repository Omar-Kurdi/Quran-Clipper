"""Quran recitation ASR + VAD sidecar.

Deliberately knows nothing about the Quran text. It answers one question:
"which Arabic words were spoken, when, and where were the pauses?"

Mapping those words onto ayahs happens in the Next.js app, which already owns
the Quran corpus and the timeline data model.
"""

from __future__ import annotations

import logging
import os
import sys
import time
from pathlib import Path

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from . import align, asr, corpus, detect
from .audio import SAMPLE_RATE, AudioDecodeError, decode_to_pcm, decode_url_window, duration_seconds
from .vad import VoicedRegion, detect_voiced_regions

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("asr-service")

MAX_UPLOAD_MB = float(os.getenv("MAX_UPLOAD_MB", "200"))

#: Fraction of the reference text an alignment must account for before the
#: result is presented without a warning. See `RecitationResult.reference_coverage`.
#:
#: Set loose deliberately. The separation measured on the reference clip was
#: total (1.00 correct vs 0.04-0.28 wrong), so the exact cut is not load-bearing;
#: what it must avoid is nagging about a correct alignment that stops a couple of
#: words short, which the phrase search can legitimately do at a trailing pause.
MIN_REFERENCE_COVERAGE = float(os.getenv("ALIGN_MIN_REFERENCE_COVERAGE", "0.75"))
#: Below this, what the recogniser heard and what the aligner placed there stop
#: describing the same recitation, which in practice means the text is not what
#: this audio says. See `align.decode_agreement` for the measurements.
MIN_DECODE_AGREEMENT = float(os.getenv("ALIGN_MIN_DECODE_AGREEMENT", "0.40"))
# Long voiced spans are split so a single forward pass never blows up memory.
MAX_CHUNK_SECONDS = float(os.getenv("MAX_CHUNK_SECONDS", "25"))

app = FastAPI(title="Quran ASR Aligner", version="1.0.0")

_allowed_origins = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)


#: Why the align backend cannot load, or None when it is fine. Set once at
#: startup so `/health` can report it and the app can warn *before* someone
#: uploads a file and waits for a 400.
ALIGN_STARTUP_ERROR: str | None = None


@app.on_event("startup")
def _startup() -> None:
    global ALIGN_STARTUP_ERROR

    backend = align.align_backend()
    log.info("align backend: %s (%s)", backend, align.align_model_name())

    # Fail loudly here rather than on the first request. The usual cause is the
    # service being started by a Python that is not this project's virtualenv --
    # commonly because bash cached the path to a different `uvicorn` before the
    # venv was activated (`hash -r` clears that) -- and the resulting
    # protobuf/onnx mismatch is impossible to guess from a 400 in the browser.
    ALIGN_STARTUP_ERROR = align.probe_backend_error()
    if ALIGN_STARTUP_ERROR:
        expected = Path(__file__).resolve().parent.parent / ".venv" / "bin" / "python"
        log.error("%s", "=" * 78)
        log.error("ALIGN BACKEND '%s' CANNOT LOAD -- /align will fail on every request.", backend)
        log.error("  reason:      %s", ALIGN_STARTUP_ERROR)
        log.error("  running as:  %s", sys.executable)
        log.error("  expected:    %s", expected)
        if Path(sys.executable).resolve() != expected.resolve():
            log.error("  ^ These differ. Start the service from its virtualenv:")
            log.error("      cd asr-service && hash -r && ./run.sh")
        log.error("%s", "=" * 78)

    if not ALIGN_STARTUP_ERROR and align.gated_model_needs_login():
        # Not an error: the weights may already be cached from an authenticated
        # run. But if they are not, the first /align request is where someone
        # would otherwise discover the gate, which is far too late.
        log.warning(
            "%s is a gated model and no Hugging Face token was found. If its weights are "
            "not already cached, alignment will fail on the first request. Accept the terms "
            "at https://huggingface.co/%s, create a read token, then run `hf auth login`.",
            align.align_model_name(),
            align.align_model_name(),
        )

    if backend != "nemo":
        # Only reachable by explicitly setting ASR_ALIGN_BACKEND, so this is an
        # informed choice rather than an accident -- but say what it costs, since
        # it is the one setting that disables detecting the surah from audio.
        log.warning(
            "ASR_ALIGN_BACKEND=%s disables range auto-detection: /align will require a "
            "'reference' and the app will fall back to the ayah range selected in the UI.",
            backend,
        )

    # Off by default: warm-up loads the `/transcribe` model, and nothing in the
    # app calls `/transcribe`. Paying ~5s of startup and a model's worth of GPU
    # memory for an endpoint that is never hit is the wrong default; anyone
    # serving `/transcribe` directly can set ASR_WARM_UP=1 and get it back.
    # `/align` has its own model and is unaffected either way.
    if os.getenv("ASR_WARM_UP", "0") == "1":
        asr.warm_up()


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "backend": asr.backend_name(),
        "model": asr.model_name(),
        "nemoDecoder": asr.active_nemo_decoder() if asr.backend_name() == "nemo" else None,
        "alignBackend": align.align_backend(),
        "alignModel": align.align_model_name(),
        # Whether the align backend actually loads. False means every /align
        # call will fail, so the app can say so up front instead of letting
        # someone upload a file and wait for the error.
        "alignReady": ALIGN_STARTUP_ERROR is None,
        "alignError": ALIGN_STARTUP_ERROR,
        # Working the passage out from the audio means decoding it, which only
        # the nemo backend does -- and only if it loads. The app needs this up
        # front: without it, `/align` with no reference is a 400 rather than a
        # capability the caller could have planned around.
        "canAutoDetectRange": align.align_backend() == "nemo" and ALIGN_STARTUP_ERROR is None,
        "sampleRate": SAMPLE_RATE,
    }


# Overlap between consecutive decode chunks. Without it a chunk boundary lands
# mid-word and destroys the words either side of the cut; each chunk needs to
# see a little of its neighbour's audio to decode its own edges correctly.
CHUNK_OVERLAP_SECONDS = float(os.getenv("CHUNK_OVERLAP_SECONDS", "2.0"))


def _split_region(region: VoicedRegion) -> list[tuple[float, float]]:
    """Chunk an over-long voiced region into overlapping ASR-sized pieces."""
    if region.duration <= MAX_CHUNK_SECONDS:
        return [(region.start, region.end)]

    overlap = min(CHUNK_OVERLAP_SECONDS, MAX_CHUNK_SECONDS / 2)
    hop = MAX_CHUNK_SECONDS - overlap

    pieces: list[tuple[float, float]] = []
    cursor = region.start
    while cursor < region.end:
        end = min(cursor + MAX_CHUNK_SECONDS, region.end)
        pieces.append((cursor, end))
        if end >= region.end:
            break
        cursor += hop
    return pieces


def _dedupe_overlapping_words(words: list[asr.TimedWord]) -> list[asr.TimedWord]:
    """Drop words decoded twice because they fell in a chunk overlap.

    Consecutive words with the same text whose spans overlap in time can only
    be the same utterance seen by two adjacent chunks -- a genuine immediate
    repetition would be separated in time, not overlapping.
    """
    deduped: list[asr.TimedWord] = []
    for word in sorted(words, key=lambda w: w.start):
        if deduped and deduped[-1].text == word.text and word.start < deduped[-1].end:
            continue
        deduped.append(word)
    return deduped


def _merge_overlapping_regions(regions: list[VoicedRegion]) -> list[VoicedRegion]:
    """Merge voiced regions that overlap after `speech_pad_ms` padding.

    Silero pads each region on both sides, so two regions separated by less
    than 2*speech_pad_ms come back overlapping. Left alone they get transcribed
    twice and confuse any word-to-region assignment downstream.
    """
    if not regions:
        return regions

    merged = [regions[0]]
    for region in regions[1:]:
        last = merged[-1]
        if region.start <= last.end:
            merged[-1] = VoicedRegion(last.start, max(last.end, region.end))
        else:
            merged.append(region)

    if len(merged) != len(regions):
        log.info("merged %d overlapping voiced region(s)", len(regions) - len(merged))
    return merged


@app.post("/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    vad_threshold: float = Form(0.3),
    min_silence_ms: int = Form(900),
    min_speech_ms: int = Form(250),
    speech_pad_ms: int = Form(200),
) -> dict:
    started = time.perf_counter()

    raw = await audio.read()
    size_mb = len(raw) / 1024 / 1024
    if size_mb > MAX_UPLOAD_MB:
        raise HTTPException(
            status_code=413,
            detail=f"Audio is {size_mb:.1f} MB, above the {MAX_UPLOAD_MB:.0f} MB limit.",
        )
    if not raw:
        raise HTTPException(status_code=400, detail="Empty audio upload.")

    try:
        pcm = decode_to_pcm(raw)
    except AudioDecodeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    total_duration = duration_seconds(pcm)

    regions = detect_voiced_regions(
        pcm,
        threshold=vad_threshold,
        min_silence_ms=min_silence_ms,
        min_speech_ms=min_speech_ms,
        speech_pad_ms=speech_pad_ms,
    )
    if not regions:
        regions = [VoicedRegion(0.0, total_duration)]
    regions = _merge_overlapping_regions(regions)

    words: list[dict] = []
    region_payload: list[dict] = []

    for region in regions:
        region_words: list[asr.TimedWord] = []
        for start, end in _split_region(region):
            chunk = pcm[int(start * SAMPLE_RATE) : int(end * SAMPLE_RATE)]
            try:
                region_words.extend(asr.transcribe_words(chunk, offset=start))
            except asr.AsrError as exc:
                raise HTTPException(status_code=500, detail=str(exc)) from exc
        region_words = _dedupe_overlapping_words(region_words)

        region_payload.append(
            {
                "start": round(region.start, 3),
                "end": round(region.end, 3),
                "wordCount": len(region_words),
                "text": " ".join(word.text for word in region_words),
            }
        )
        words.extend(word.to_dict() for word in region_words)

    elapsed = time.perf_counter() - started
    log.info(
        "transcribed %.1fs of audio into %d words across %d regions in %.1fs",
        total_duration,
        len(words),
        len(regions),
        elapsed,
    )

    return {
        "success": True,
        "backend": asr.backend_name(),
        "model": asr.model_name(),
        "audioDuration": round(total_duration, 3),
        "processingSeconds": round(elapsed, 2),
        "transcript": " ".join(word["text"] for word in words),
        "words": words,
        "voicedRegions": region_payload,
    }


@app.post("/align")
async def align_endpoint(
    audio: UploadFile | None = File(None),
    reference: str = Form(""),
    audio_url: str = Form(""),
    window_start: float = Form(0.0),
    window_end: float = Form(0.0),
) -> dict:
    """Force-align known Quran text against the audio.

    ``reference`` is newline-delimited, one ayah per line, each formatted
    ``surah:ayah<TAB>word word word``. Every reference word comes back with a
    timestamp -- that is a structural property of forced alignment, not a
    quality claim about the acoustics.

    Audio arrives either as an upload or, for the built-in reciters, as
    ``audio_url`` plus the window to read from it. A reciter's file is the
    whole chapter -- Al-Baqarah is 87 MB and about two hours -- so uploading it
    to align three ayahs would move the entire recording twice across the
    network to use thirty seconds of it. ffmpeg range-seeks instead. Times in
    the response are still absolute against the whole recording, because the
    seek is exact and the caller is playing the whole file.
    """
    started = time.perf_counter()

    if audio_url:
        if not (window_end > window_start >= 0):
            raise HTTPException(
                status_code=400,
                detail=f"audio_url needs a window; got {window_start}-{window_end}s.",
            )
        try:
            pcm_or_none = decode_url_window(audio_url, window_start, window_end)
        except AudioDecodeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        raw = b""
        window_offset = window_start
    else:
        pcm_or_none = None
        window_offset = 0.0
        if audio is None:
            raise HTTPException(status_code=400, detail="Send either an audio file or an audio_url with a window.")
        raw = await audio.read()
        size_mb = len(raw) / 1024 / 1024
        if size_mb > MAX_UPLOAD_MB:
            raise HTTPException(status_code=413, detail=f"Audio is {size_mb:.1f} MB, above the {MAX_UPLOAD_MB:.0f} MB limit.")
        if not raw:
            raise HTTPException(status_code=400, detail="Empty audio upload.")

    ref_words: list[tuple[str, int, str]] = []
    for line in reference.splitlines():
        line = line.strip()
        if not line or "\t" not in line:
            continue
        verse_key, text = line.split("\t", 1)
        verse_key = verse_key.strip()
        index = 0
        for token in text.split():
            # Uthmani orthography puts waqf/sajda marks in their own token, and
            # some words carry one after an internal space. They aren't recited
            # words and normalize to nothing, so they can't be aligned -- glue
            # them onto the previous word's display text instead of letting
            # them become reference words that no frame can ever match.
            if not align.normalize_for_vocab(token):
                if ref_words and ref_words[-1][0] == verse_key:
                    key, position, previous = ref_words[-1]
                    ref_words[-1] = (key, position, f"{previous} {token}")
                continue
            ref_words.append((verse_key, index, token))
            index += 1
    if pcm_or_none is not None:
        pcm = pcm_or_none
    else:
        try:
            pcm = decode_to_pcm(raw)
        except AudioDecodeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    total_duration = duration_seconds(pcm)

    # No reference supplied -> work out the passage from the audio itself. The
    # phrase decodes this needs are the same ones the aligner needs, so they're
    # computed once here and handed on rather than repeated.
    detected = None
    boundaries: list[float] | None = None
    decoded_phrases: list[str] | None = None

    if not ref_words:
        if align.align_backend() != "nemo":
            # Structured so the caller can tell "this backend can't auto-detect,
            # send me a reference instead" (worth retrying with one) apart from
            # "the backend is broken" (retrying anything fails the same way).
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "auto_detect_unsupported",
                    "message": (
                        "Range auto-detection needs the nemo align backend (it reads the audio to "
                        f"find the passage), but ASR_ALIGN_BACKEND is set to '{align.align_backend()}'. "
                        "Unset it to restore detection, or supply 'reference' to align a known range."
                    ),
                },
            )
        try:
            boundaries = align.detect_boundaries(pcm)
            decoded_phrases = align.decode_phrases(pcm, boundaries)
            detected = detect.detect_range(decoded_phrases)
        except align.AlignError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        if detected is None:
            raise HTTPException(
                status_code=422,
                detail="Could not identify any Quran passage in this audio. Supply 'reference' to align a known range.",
            )
        # Every detected passage goes into the reference, not just the largest.
        # A recitation that opens with Al-Fatihah before the main surah needs
        # both, or the Fatihah phrases get force-matched into the other surah.
        ref_words = []
        for detected_range in detected.ranges:
            ref_words.extend(
                corpus.words_for_range(detected_range.surah, detected_range.start_ayah, detected_range.end_ayah)
            )
        if not ref_words:
            summary = ", ".join(f"{r.surah}:{r.start_ayah}-{r.end_ayah}" for r in detected.ranges)
            raise HTTPException(status_code=422, detail=f"Detected {summary} but found no text for it.")

    try:
        result = align.align_recitation(pcm, ref_words, boundaries, decoded_phrases)
    except align.AlignError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    aligned = result.words
    segments = result.segments
    mean_score = result.mean_score
    coverage = result.reference_coverage
    agreement = result.decode_agreement
    warning = None

    # Detection reads the passage from phrase matches, so it can reach one ayah
    # past what was actually recited -- on one clip it reported 2:121-125 for a
    # recording that opens at 2:122. Alignment settles it: an ayah at the edge
    # of the range that received no words at all was not in the audio. Narrow
    # the answer to what was really there rather than reporting a range the
    # caller would have to check by ear.
    if detected is not None and aligned:
        recited = {word.verse_key for word in aligned}
        kept: list[detect.SurahRange] = []
        for found in detected.ranges:
            numbers = sorted(
                ayah
                for ayah in range(found.start_ayah, found.end_ayah + 1)
                if f"{found.surah}:{ayah}" in recited
            )
            if not numbers:
                continue
            if numbers[0] != found.start_ayah or numbers[-1] != found.end_ayah:
                log.info(
                    "narrowing detected %d:%d-%d to %d:%d-%d -- the rest was never recited",
                    found.surah, found.start_ayah, found.end_ayah,
                    found.surah, numbers[0], numbers[-1],
                )
            kept.append(detect.SurahRange(found.surah, numbers[0], numbers[-1], found.phrases))
        if kept:
            detected = detect.DetectedRange(
                ranges=kept,
                confidence=detected.confidence,
                matched_phrases=detected.matched_phrases,
                total_phrases=detected.total_phrases,
            )
            # Coverage has to be re-read against the narrowed text, or it still
            # reports the ayah that was dropped as missing.
            narrowed = [
                word
                for word in ref_words
                if any(
                    word[0].startswith(f"{r.surah}:")
                    and r.start_ayah <= int(word[0].split(":")[1]) <= r.end_ayah
                    for r in kept
                )
            ]
            if narrowed:
                given = {(word.verse_key, word.word_index) for word in aligned}
                coverage = round(len(given & {(w[0], w[1]) for w in narrowed}) / len(narrowed), 4)

    # Alignment cannot fail loudly -- it fits whatever text it is given -- so
    # this is the only place a wrong ayah range gets caught.
    #
    # Neither figure this used to test can do the job now, and one of them
    # never could. Mean score does not separate the cases at all: over six
    # wrong ranges it ran *higher* than the correct one (0.947 against 0.696),
    # because a confident path over the wrong words is still a confident path.
    # Coverage did separate them while phrase assignment decided the timeline,
    # but one global forced alignment places every reference word by
    # construction, so it now reads 1.00 for right and wrong alike -- it is a
    # completeness check on this pipeline, not evidence about the passage.
    #
    # Decode agreement replaces it because it is an independent reading rather
    # than a property of the thing being checked: what the recogniser heard in
    # each second, against what the aligner put there. Measured across two
    # clips, 0.888 and 0.873 for the correct range against 0.010-0.121 for six
    # wrong ones, and 0.479 for a reference covering only part of its audio.
    if agreement is not None and agreement < MIN_DECODE_AGREEMENT:
        warning = (
            f"What this recording says and the supplied text only agree {agreement:.0%} of the way. "
            "The ayah range probably does not match the recording."
        )
        log.warning("%s (reference was %d words, mean score %.4f)", warning, len(ref_words), mean_score)
    elif coverage < MIN_REFERENCE_COVERAGE:
        warning = (
            f"Only {coverage:.0%} of the supplied text was given any time in this recording. "
            "The range is probably wider than the audio."
        )
        log.warning("%s (reference was %d words)", warning, len(ref_words))
    elapsed = time.perf_counter() - started
    log.info(
        "aligned %d reference word(s) into %d segment(s) (%d restart(s)) over %.1fs of audio in %.1fs, "
        "mean score %.3f, coverage %.2f, decode agreement %s",
        len(ref_words),
        len(segments),
        sum(1 for segment in segments if segment.is_restart),
        total_duration,
        elapsed,
        mean_score,
        coverage,
        "n/a" if agreement is None else "%.2f" % agreement,
    )

    # Times measured inside the window are reported against the whole
    # recording, because that is the file the caller is playing. Safe to do by
    # addition: the seek was measured as sample-exact, so there is no drift to
    # accumulate. Zero for an upload, which is its own whole recording.
    def shifted(entry: dict) -> dict:
        if not window_offset:
            return entry
        moved = dict(entry)
        for key in ("start", "end"):
            if isinstance(moved.get(key), (int, float)):
                moved[key] = round(moved[key] + window_offset, 3)
        return moved

    return {
        "success": True,
        "backend": align.align_backend(),
        "model": align.align_model_name(),
        "detectedRange": detected.to_dict() if detected else None,
        "audioDuration": round(total_duration, 3),
        # Where in the recording this alignment sits, so the caller can tell a
        # window apart from a clip that happens to start at zero.
        "windowStart": round(window_offset, 3) if window_offset else 0,
        "processingSeconds": round(elapsed, 2),
        "words": [shifted(word.to_dict()) for word in aligned],
        "segments": [shifted(segment.to_dict()) for segment in segments],
        "meanScore": round(mean_score, 4),
        "referenceCoverage": coverage,
        "decodeAgreement": agreement,
        "warning": warning,
    }
