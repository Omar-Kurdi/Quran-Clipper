"""Quran recitation alignment sidecar.

Places a known Quran text on a recitation (`/align`), working out which
passage it is when no text is given, and re-cuts an alignment's captions
(`/regroup`). The studio owns the Quran corpus and the timeline data model.
"""

from __future__ import annotations

import logging
import os
import sys
import time
from pathlib import Path

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from . import align, corpus, detect, phoneme, phoneme_reading, qul, regroup
from .audio import SAMPLE_RATE, AudioDecodeError, decode_to_pcm, decode_url_window, duration_seconds

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

    log.info("align model: %s", align.align_model_name())

    # Fail loudly here rather than on the first request. The usual cause is the
    # service being started by a Python that is not this project's virtualenv --
    # commonly because bash cached the path to a different `uvicorn` before the
    # venv was activated (`hash -r` clears that) -- and the resulting
    # protobuf/onnx mismatch is impossible to guess from a 400 in the browser.
    ALIGN_STARTUP_ERROR = align.probe_backend_error()
    if ALIGN_STARTUP_ERROR:
        expected = Path(__file__).resolve().parent.parent / ".venv" / "bin" / "python"
        log.error("%s", "=" * 78)
        log.error("THE ALIGN MODEL CANNOT LOAD -- /align will fail on every request.")
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


def _assist_requested(name: str) -> bool:
    return name.strip().lower() == "qul"


def _assist(name: str) -> qul.Assist | None:
    """The detection assist a request asked for, or None for the default path."""
    if not _assist_requested(name):
        return None
    loaded = qul.load()
    if loaded is None:
        # Asked for and not here: say so rather than quietly running the
        # default path, which would make a comparison compare nothing.
        raise HTTPException(
            status_code=400,
            detail={
                "code": "qul_unavailable",
                "message": f"The QUL exports are not in {qul.data_dir()} -- run scripts/qul-import.mjs.",
            },
        )
    return loaded


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "alignModel": align.align_model_name(),
        # Which upload of it, when it is the default model: pinned, so a new
        # upload to the Hub changes nothing until it is chosen.
        "alignModelRevision": align.default_model_revision()
        if align.align_model_name() == align.DEFAULT_NEMO_ALIGN_MODEL else None,
        # Whether the align backend actually loads. False means every /align
        # call will fail, so the app can say so up front instead of letting
        # someone upload a file and wait for the error.
        "alignReady": ALIGN_STARTUP_ERROR is None,
        "alignError": ALIGN_STARTUP_ERROR,
        # Working the passage out from the audio means decoding it, which the
        # align model does whenever it loads.
        "canAutoDetectRange": ALIGN_STARTUP_ERROR is None,
        "sampleRate": SAMPLE_RATE,
        # Whether "Local + QUL" can run: the morphology and mutashabihat
        # exports are on this machine.
        "qulAssist": qul.available(),
    }


def _istiadha_before_basmala(pcm: np.ndarray, first_verse: str, listen_sec: float = 15.0) -> float | None:
    """Where an isti'adha said before 1:1 ends, so the aligner can be kept off it; None when there is none.

    A passage from 1:1 has the basmala as its first ayah, and the isti'adha
    before it shares بِٱللَّهِ with it: the aligner laid بِسْمِ on the
    isti'adha's بِٱللَّهِ, 1:1's caption swallowed the isti'adha, and with no
    audio left before the first word, the openings were listened for in none
    (the studio's own Al-Fatihah sample, Al-Sudais, 0.5-2.6s). Listened for
    over the opening seconds instead of before the first aligned word.
    """
    if first_verse != "1:1":
        return None
    heard = phoneme_reading.find_openings(pcm, min(duration_seconds(pcm), listen_sec), first_verse)
    return next((opening["end"] for opening in heard if opening["kind"] == "istiadha"), None)


def _without_istiadha(pcm: np.ndarray, ends_at: float | None) -> np.ndarray:
    """The recording with everything before `ends_at` silenced, or as it is when there is nothing to silence."""
    if not ends_at:
        return pcm
    quiet = pcm.copy()
    quiet[: int(ends_at * SAMPLE_RATE)] = 0
    return quiet


def _shifted(entry: dict, window_offset: float) -> dict:
    """An entry's times against the whole recording rather than the window read -- see `/align`."""
    if not window_offset:
        return entry
    moved = dict(entry)
    for key in ("start", "end"):
        if isinstance(moved.get(key), (int, float)):
            moved[key] = round(moved[key] + window_offset, 3)
    return moved


def _alignment_warning(
    agreement: float | None,
    coverage: float,
    ref_words: list[tuple[str, int, str]],
    segments: list[align.Segment],
    mean_score: float,
) -> str | None:
    """What the caller should be told about this timeline, or None -- see `/align`.

    Shared with `/regroup`, because a caption left without its ayah is a
    property of the grouping, and a re-cut has to be checked for it too.
    """
    warning = None
    if agreement is not None and agreement < MIN_DECODE_AGREEMENT:
        warning = (
            f"What this recording says and the supplied text only agree {agreement:.0%} of the way. "
            "The ayah range probably does not match the recording."
        )
        log.warning("%s (reference was %d words, mean score %.4f)", warning, len(ref_words), mean_score)
    else:
        # An ayah with captions on both sides of it but none of its own is the
        # failure this must never repeat quietly. On Al-Muddaththir 74:11-30 it
        # took four of them -- 13, 18, 21 and 29 -- and the only sign was a
        # coverage of 0.87, comfortably inside the threshold below, while the
        # video jumped from 12 straight to 14 and the caption before each hole
        # was stretched over its audio.
        #
        # `align._restore_skipped_ayahs` should leave this unreachable. If it
        # fires, that recovery has a case it does not yet cover -- so say which
        # ayahs, because otherwise they are found by watching the video.
        skipped = align.skipped_ayahs(ref_words, segments)
        if skipped:
            warning = (
                f"No caption was produced for {', '.join(skipped)}, "
                f"though {'they were' if len(skipped) > 1 else 'it was'} recited "
                "between ayahs that did get one. The timeline is incomplete."
            )
            log.warning("%s (reference was %d words, coverage %.4f)", warning, len(ref_words), coverage)

    if warning is None and coverage < MIN_REFERENCE_COVERAGE:
        warning = (
            f"Only {coverage:.0%} of the supplied text was given any time in this recording. "
            "The range is probably wider than the audio."
        )
        log.warning("%s (reference was %d words)", warning, len(ref_words))
    return warning


@app.post("/align")
async def align_endpoint(
    audio: UploadFile | None = File(None),
    reference: str = Form(""),
    audio_url: str = Form(""),
    window_start: float = Form(0.0),
    window_end: float = Form(0.0),
    assist: str = Form(""),
    breaks: str = Form(""),
    retime: str = Form(""),  # the phoneme model to re-time the words with (`phoneme.chosen`); `none` for fastconformer's
    lab: str = Form(""),  # the dev-only phoneme lab's other stages, `reading=v31;timing=old`; see `phoneme.lab_stages`
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

    ``assist=qul`` has range detection consult QUL's morphology and
    mutashabihat (see `qul`). It is the studio's "Local + QUL" option, kept
    separate so the two can be compared; it only matters when no reference is
    sent, because a known range has nothing left to detect.

    ``breaks`` is the studio's "fewer / more screen breaks" setting: ``fewer``,
    ``more``, or empty for ``normal``. See `align.BREAK_SCALES`.
    """
    started = time.perf_counter()
    breaks = breaks or "normal"
    if breaks not in align.BREAK_SCALES:
        raise HTTPException(status_code=400, detail=f"breaks must be one of {', '.join(align.BREAK_SCALES)}; got {breaks!r}.")
    # Resolved before any decoding, so a missing export fails in milliseconds.
    detect_assist = _assist(assist)

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

    ref_words = align.reference_words(reference)
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
        try:
            boundaries = align.detect_boundaries(pcm)
            decoded_phrases = align.decode_phrases(pcm, boundaries)
            detected = detect.detect_range(decoded_phrases, detect_assist)
        except align.AlignError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        if detected is None:
            # Coded so a caller can tell this apart from an aligner that
            # cannot read audio at all. They are different answers and only
            # one of them is about this recording.
            #
            # Deliberately *not* retried with the range selected in the studio.
            # That range is a default nobody has to touch -- surah 1, ayahs 1
            # to 7 -- so a caller retrying with it would force-align
            # Al-Fatihah onto whatever was actually recited and return a
            # complete, confident, entirely wrong timeline. An error that says
            # what happened is worth more than that.
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "passage_not_detected",
                    "message": (
                        "Could not identify any Quran passage in this audio. "
                        "Supply 'reference' to align a known range."
                    ),
                },
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

    # An isti'adha before 1:1 is silenced for the aligner, which otherwise lays
    # the basmala on it (see `_istiadha_before_basmala`); the openings are still
    # heard from the recording itself.
    aligner_pcm = _without_istiadha(pcm, _istiadha_before_basmala(pcm, ref_words[0][0]))
    try:
        result = align.align_recitation(aligner_pcm, ref_words, boundaries, decoded_phrases, breaks, **phoneme.lab_stages(lab))
    except align.AlignError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    aligned, segments = result.words, result.segments
    retimed = phoneme.retime(retime, aligner_pcm, aligned, segments)
    mean_score = result.mean_score
    coverage = result.reference_coverage
    agreement = result.decode_agreement

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
    warning = _alignment_warning(agreement, coverage, ref_words, segments, mean_score)
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
    response = {
        "success": True,
        "model": align.align_model_name(),
        "detectedRange": detected.to_dict() if detected else None,
        "assist": "qul" if detected is not None and detect_assist is not None else None,
        "retimed": retimed,
        "openings": phoneme_reading.find_openings(pcm, segments[0].start if segments else 0.0, ref_words[0][0], window_offset),
        "audioDuration": round(total_duration, 3),
        # Where in the recording this alignment sits, so the caller can tell a
        # window apart from a clip that happens to start at zero.
        "windowStart": round(window_offset, 3) if window_offset else 0,
        "processingSeconds": round(elapsed, 2),
        "words": [_shifted(word.to_dict(), window_offset) for word in aligned],
        "segments": [_shifted(segment.to_dict(), window_offset) for segment in segments],
        "meanScore": round(mean_score, 4),
        "referenceCoverage": coverage,
        "decodeAgreement": agreement,
        "warning": warning,
    }
    # Held so Fewer / More can re-cut this match without reading the audio
    # again -- see `regroup`. Only an id goes back; the studio asks with it.
    if result.grouping is not None:
        response["regroupId"] = regroup.keep(regroup.Kept(result.grouping, dict(response), window_offset))
    return response


@app.get("/regroup")
async def regroup_endpoint(regroup_id: str = Query(..., alias="id"), breaks: str = "") -> dict:
    """Cut a match `/align` returned into captions again, at another screen-break setting.

    Answers exactly as `/align` did, with only the segments and the warning
    that depends on them recomputed: the words, their times and the passage
    are the same alignment. A GET, because it changes nothing: the same id and
    setting always give the same captions. Asynchronous like `/align`, so the two take turns
    on the model rather than running over each other (a phrase recited twice
    at its own end is read from the audio again).
    """
    breaks = breaks or "normal"
    if breaks not in align.BREAK_SCALES:
        raise HTTPException(status_code=400, detail=f"breaks must be one of {', '.join(align.BREAK_SCALES)}; got {breaks!r}.")
    kept = regroup.find(regroup_id)
    if kept is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "regroup_expired", "message": "This match is no longer held -- match the recording again."},
        )
    segments = align.group_recitation(kept.grouping, breaks)
    response = dict(kept.response)
    response["segments"] = [_shifted(segment.to_dict(), kept.window_offset) for segment in segments]
    response["warning"] = _alignment_warning(
        response["decodeAgreement"],
        response["referenceCoverage"],
        kept.grouping.ref_words,
        segments,
        response["meanScore"],
    )
    response["regroupId"] = regroup_id
    log.info("regrouped %s at %s screen breaks into %d segment(s)", regroup_id[:6], breaks, len(segments))
    return response
