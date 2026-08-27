"""CTC forced alignment of *known* Quran text against recitation audio.

The difference from `asr.py` is the whole point of this module: nothing here
decodes. The caller supplies the Uthmani text, that text becomes a fixed CTC
target sequence, and the model only chooses *when* each character was spoken.

Three failure modes of the free-decode pipeline are therefore structurally
impossible rather than merely mitigated:

* a word cannot be dropped -- every reference word is in the target sequence,
  so the Viterbi path must assign it frames;
* a word cannot be garbled -- the output tokens *are* the Quran text, so the
  malformed-token artifact seen with NeMo's CTC branch (`يُؤْمُِونَ`) has no way
  to occur;
* a phrase cannot land in the wrong surah -- there is no search over the
  corpus at all.

Because the search space is one fixed sequence rather than every possible
sequence, acoustic model quality matters far less here than for free decoding.
A model whose free decode of a clip was unreadable still placed all 53 words of
that clip correctly under forced alignment -- see docs/ALIGNMENT.md.

Repeats (`detect_repeats`) are handled separately, because a straight-line
reference cannot represent a phrase said twice.
"""

from __future__ import annotations

import difflib
import logging
import os
import re
from dataclasses import asdict, dataclass
from functools import lru_cache

import numpy as np

from .audio import SAMPLE_RATE

log = logging.getLogger(__name__)

# Character-vocabulary CTC model. A char vocab is what makes this simple: the
# Uthmani text maps straight onto target tokens with no tokenizer to match.
# (NeMo's Quran checkpoint is stronger acoustically but uses SentencePiece BPE
# and a different blank convention -- see docs/ALIGNMENT.md before switching.)
DEFAULT_ALIGN_MODEL = "jonatasgrosman/wav2vec2-large-xlsr-53-arabic"

# Long audio cannot be chunked the way a decode can: the Viterbi path is global
# over the whole sequence. So emissions are computed in overlapping windows and
# stitched at the *emission* level, then aligned in one pass.
EMISSION_WINDOW_SEC = 30.0
EMISSION_OVERLAP_SEC = 4.0


#: Forced alignment always succeeds -- given any text and any audio it returns
#: a complete, monotonic, confident-*looking* timeline. That is the flip side
#: of its main strength, and it means a user who picks the wrong ayah range
#: gets plausible-looking garbage rather than an error.
#:
#: **This threshold is a backstop, not a wrong-passage detector.** Mean score
#: cannot do that job: phrase-wise assignment averages only over the words it
#: actually placed, so a wrong reference gets *short* word ranges whose few
#: words still score plausibly. Measured against six wrong ranges, the correct
#: one scored 0.2923 and the wrong ones 0.1475-0.2550 -- an unrelated 15-word
#: surah reached 0.2550, and this threshold fired for none of them.
#:
#: `RecitationResult.reference_coverage` is the field that detects a wrong
#: passage; it separated the same cases completely. This threshold only catches
#: degenerate emissions.
MIN_PLAUSIBLE_MEAN_SCORE = 0.03


class AlignError(RuntimeError):
    pass


@dataclass
class AlignedWord:
    """One reference word, with the time span the aligner assigned it."""

    text: str
    verse_key: str
    word_index: int
    start: float
    end: float
    score: float
    #: True when this word is a second (or later) utterance inserted by repeat
    #: detection rather than part of the linear reference.
    is_repeat: bool = False

    def to_dict(self) -> dict:
        return asdict(self)


#: Quran-specific FastConformer. Its CTC head gives much sharper emissions on
#: recitation than a general Arabic model, which matters enormously for
#: *choosing between* competing word ranges during segmentation (far more than
#: it does for merely placing known text in order).
DEFAULT_NEMO_ALIGN_MODEL = "Muno459/fastconformer-quran"


def align_backend() -> str:
    """``nemo`` (the default) or ``wav2vec2``.

    **Never probe-and-downgrade here.** Working the surah out from the audio is
    a core feature, not a bonus, and it needs nemo because it has to decode.
    An earlier version checked whether nemo imported and quietly switched to
    wav2vec2 when it didn't -- which turned a *fixable environment problem*
    (service started outside its virtualenv, so nemo's dependencies mismatched)
    into what looked like a permanent capability limit, and silently cost every
    user range detection.

    So the default is nemo, unconditionally. If nemo cannot load,
    `_load_nemo_aligner` raises with a message naming the actual cause, which
    the caller can act on. wav2vec2 is available only by explicitly asking for
    it -- an informed opt-out, never an automatic one.
    """
    value = (os.getenv("ASR_ALIGN_BACKEND") or "nemo").strip().lower()
    return value if value in ("nemo", "wav2vec2") else "nemo"


def probe_backend_error() -> str | None:
    """Import-check the configured backend, returning the failure reason or None.

    **Diagnostic only -- this never changes which backend is used.** That
    distinction is the whole point: an earlier version used a check like this to
    silently switch to wav2vec2, which hid a broken environment and cost users
    range detection without telling them. Here the answer is only ever reported,
    never acted on, so a broken install surfaces at startup (and in `/health`)
    instead of as a 400 the first time someone uploads a file.

    Only the import is exercised, not the model weights -- the failure this
    catches (a protobuf/onnx mismatch from running under the wrong interpreter)
    happens at import time, and loading weights here would cost a download.
    """
    if align_backend() != "nemo":
        return None
    try:
        import nemo.collections.asr  # noqa: F401
    except Exception as exc:
        return f"{type(exc).__name__}: {exc}"
    return None


def align_model_name() -> str:
    explicit = (os.getenv("ASR_ALIGN_MODEL") or "").strip()
    if explicit:
        return explicit
    return DEFAULT_NEMO_ALIGN_MODEL if align_backend() == "nemo" else DEFAULT_ALIGN_MODEL


def _device() -> str:
    import torch

    configured = (os.getenv("ASR_DEVICE") or "auto").strip().lower()
    if configured != "auto":
        return configured
    return "cuda" if torch.cuda.is_available() else "cpu"


# ---------------------------------------------------------------------------
# Uthmani -> model vocabulary
# ---------------------------------------------------------------------------

# Harakat, tanwin, superscript alef, Quranic annotation marks (waqf signs,
# sajda marks, the small high rounded zero over silent letters) and tatweel.
# The acoustic model was trained on undiacritised Arabic, so the reference has
# to be reduced to the same skeleton before it can be a target sequence.
_DIACRITICS = re.compile(r"[ً-ْٓ-ٰٕۖ-ۭـ]")


def normalize_for_vocab(word: str) -> str:
    """Reduce one Uthmani word to bare consonants in the model's vocabulary."""
    text = _DIACRITICS.sub("", word)
    text = re.sub(r"[آأإٱ]", "ا", text)  # آ أ إ ٱ -> ا
    text = text.replace("ى", "ي")  # ى -> ي
    return re.sub(r"[^ء-ي]", "", text)


@lru_cache(maxsize=1)
def _load_aligner():
    import torch
    from transformers import AutoModelForCTC, AutoProcessor

    name = align_model_name()
    device = _device()
    log.info("loading forced-alignment model=%s device=%s", name, device)

    processor = AutoProcessor.from_pretrained(name)
    model = AutoModelForCTC.from_pretrained(name).to(device).eval()
    torch.set_grad_enabled(False)

    vocab = processor.tokenizer.get_vocab()
    blank_id = processor.tokenizer.pad_token_id
    if blank_id is None:
        raise AlignError(f"{name} has no pad/blank token; cannot force-align with it.")
    # torchaudio's forced_align is called with blank=blank_id below, but a model
    # whose blank is not 0 also tends to differ in other conventions -- surface
    # it loudly rather than silently producing a plausible-looking bad path.
    if blank_id != 0:
        log.warning("model blank id is %d, not 0 -- verify alignment output carefully", blank_id)

    separator_id = vocab.get("|")
    return processor, model, device, vocab, blank_id, separator_id


#: Uthmani orthography the NeMo tokenizer has no piece for. Its SentencePiece
#: vocab was built on ordinary Arabic: alef wasla comes back as <unk>, which
#: would align to noise. Plain text round-trips through it exactly.
_QURANIC_MARKS = re.compile(r"[ۖ-ۭ]")


def normalize_for_nemo(word: str) -> str:
    """Convert one Uthmani word to the diacritized Arabic the NeMo tokenizer expects.

    **Harakat are kept.** This checkpoint was trained on fully vocalised
    recitation text and its greedy decode emits diacritics, so stripping them
    -- correct for the undiacritized character model -- builds a target the
    model never wants to emit. Forced alignment still returns a monotonic path
    in that case, so the word times look plausible while every confidence
    collapses to ~0; the alignment is being forced through tokens with almost
    no posterior mass.

    What does have to go is Uthmani-only orthography with no SentencePiece
    piece behind it: alef wasla (which decodes to <unk>), tatweel, superscript
    alef, and the waqf/sajda annotation marks.
    """
    text = word.replace("ٱ", "ا")  # alef wasla -> plain alef
    text = _QURANIC_MARKS.sub("", text)  # waqf/sajda marks, small high letters
    # Tatweel, superscript alef, and maddah-above. The maddah matters: Uthmani
    # puts it on words like اقْتُلُوٓا۟ and فِىٓ, and leaving it in makes the
    # whole word unmappable, which drops it from the alignment target.
    text = text.replace("ـ", "").replace("ٰ", "").replace("ٓ", "")
    # Uthmani writes the long a of e.g. ٱلْـَٔاخِرَ as hamza-above + alef; the
    # tokenizer only knows the composed form.
    text = text.replace("ٔا", "آ").replace("ٔ", "")
    return re.sub(r"\s+", "", text)


@lru_cache(maxsize=1)
def _load_nemo_aligner():
    try:
        import nemo.collections.asr as nemo_asr
    # Deliberately not just ImportError. NeMo drags in onnx, protobuf, hydra and
    # pytorch-lightning, and a mismatched pair among those raises whatever that
    # library felt like -- a protobuf gencode/runtime skew raises
    # `google.protobuf.runtime_version.VersionError`, a plain Exception, which
    # escaped a narrower clause and surfaced as a 500 with a raw traceback
    # instead of the actionable message right here.
    except Exception as exc:  # pragma: no cover - optional heavy dep
        raise AlignError(
            f"The nemo align backend could not be loaded ({type(exc).__name__}: {exc}). "
            "By far the most common cause is starting this service outside its virtualenv, which "
            "picks up a system Python whose onnx/protobuf versions disagree -- run "
            "`cd asr-service && source .venv/bin/activate` first, or call `.venv/bin/uvicorn` "
            "directly. If nemo genuinely isn't installed, `pip install nemo_toolkit[asr]`. "
            "Setting ASR_ALIGN_BACKEND=wav2vec2 avoids this dependency but gives up detecting "
            "the surah from the audio, so fix the environment in preference to switching."
        ) from exc

    from huggingface_hub import hf_hub_download

    name = align_model_name()
    log.info("loading nemo forced-alignment model=%s device=%s", name, _device())

    if name == DEFAULT_NEMO_ALIGN_MODEL:
        path = hf_hub_download(repo_id=name, filename="nemo/fastconformer-quran.nemo")
        model = nemo_asr.models.ASRModel.restore_from(restore_path=path, map_location=_device())
    else:
        model = nemo_asr.models.ASRModel.from_pretrained(model_name=name, map_location=_device())

    model.eval()
    if not hasattr(model, "ctc_decoder"):
        raise AlignError(
            f"{name} has no CTC head. Forced alignment needs frame-synchronous CTC emissions; "
            "an RNNT-only checkpoint cannot be used here."
        )
    # Hybrid RNNT/CTC BPE models put blank last: num_classes_with_blank - 1,
    # which equals vocab_size. This is NOT 0 the way a character CTC model's is.
    blank_id = model.ctc_decoder.num_classes_with_blank - 1
    log.info("nemo aligner ready: vocab=%d blank=%d", model.tokenizer.vocab_size, blank_id)
    return model, blank_id


def _blank_id() -> int:
    if align_backend() == "nemo":
        return _load_nemo_aligner()[1]
    return _load_aligner()[4]


def _build_targets_nemo(ref_words: list[tuple[str, int, str]]) -> tuple[list[int], list[int], set[str]]:
    """Tokenize each reference word separately so every target token keeps a word index.

    Word-at-a-time rather than whole-string keeps the map exact; SentencePiece
    marks a word start with U+2581 anyway, so the boundary information a
    separator token would carry is already in the pieces.
    """
    model, _ = _load_nemo_aligner()
    tokenizer = model.tokenizer

    target_ids: list[int] = []
    target_to_word: list[int] = []
    missing: set[str] = set()

    for word_idx, (_, _, uthmani) in enumerate(ref_words):
        normalized = normalize_for_nemo(uthmani)
        if not normalized:
            continue
        ids = tokenizer.text_to_ids(normalized)
        if not ids or any(i == 0 for i in ids):  # 0 is <unk> in this vocab
            missing.add(normalized)
            ids = [i for i in ids if i != 0]
        for token_id in ids:
            target_ids.append(token_id)
            target_to_word.append(word_idx)

    return target_ids, target_to_word, missing


def build_targets(ref_words: list[tuple[str, int, str]]) -> tuple[list[int], list[int], set[str]]:
    """Turn reference words into a CTC target sequence.

    Returns ``(target_ids, target_to_word, missing_chars)`` where
    ``target_to_word[i]`` is the index into ``ref_words`` that target token
    ``i`` belongs to (``-1`` for the word separator). That map is what lets
    frame times be attributed back to display words.
    """
    if align_backend() == "nemo":
        return _build_targets_nemo(ref_words)

    _, _, _, vocab, _, separator_id = _load_aligner()

    target_ids: list[int] = []
    target_to_word: list[int] = []
    missing: set[str] = set()

    for word_idx, (_, _, uthmani) in enumerate(ref_words):
        normalized = normalize_for_vocab(uthmani)
        if not normalized:
            continue
        if target_ids and separator_id is not None:
            target_ids.append(separator_id)
            target_to_word.append(-1)
        for char in normalized:
            token = vocab.get(char)
            if token is None:
                # An unmapped char would become <unk> and align to noise.
                missing.add(char)
                continue
            target_ids.append(token)
            target_to_word.append(word_idx)

    return target_ids, target_to_word, missing


# ---------------------------------------------------------------------------
# Emissions
# ---------------------------------------------------------------------------


def compute_emission(pcm: np.ndarray):
    """Log-probs over the whole clip, stitching overlapping windows if needed."""
    import torch

    if align_backend() == "nemo":
        model, _ = _load_nemo_aligner()
        device = _device()

        def emit(chunk: np.ndarray):
            wav = torch.from_numpy(np.ascontiguousarray(chunk)).float().unsqueeze(0).to(device)
            length = torch.tensor([wav.shape[1]], device=device)
            with torch.inference_mode():
                processed, processed_len = model.preprocessor(input_signal=wav, length=length)
                encoded, _ = model.encoder(audio_signal=processed, length=processed_len)
                # The CTC head, not the RNNT branch: forced alignment needs one
                # output per fixed time frame, which is what CTC gives.
                log_probs = model.ctc_decoder(encoder_output=encoded)
            return log_probs.float()
    else:
        processor, model, device, _, _, _ = _load_aligner()

        def emit(chunk: np.ndarray):
            inputs = processor(chunk, sampling_rate=SAMPLE_RATE, return_tensors="pt")
            values = inputs.input_values.to(device)
            with torch.inference_mode():
                logits = model(values).logits
            return torch.log_softmax(logits.float(), dim=-1)

    window = int(EMISSION_WINDOW_SEC * SAMPLE_RATE)
    if len(pcm) <= window:
        return emit(pcm)

    overlap = int(EMISSION_OVERLAP_SEC * SAMPLE_RATE)
    hop = window - overlap
    pieces = []

    for start in range(0, len(pcm), hop):
        end = min(start + window, len(pcm))
        chunk = pcm[start:end]
        if len(chunk) < SAMPLE_RATE // 2:  # trailing sliver, already covered
            break

        emission = emit(chunk)
        frames = emission.shape[1]
        ratio = frames / len(chunk)

        # Drop half the overlap from each inner edge so every audio sample is
        # represented exactly once, by whichever window saw it with the most
        # surrounding context.
        keep_start = 0 if start == 0 else int((overlap / 2) * ratio)
        keep_end = frames if end >= len(pcm) else frames - int((overlap / 2) * ratio)
        pieces.append(emission[:, keep_start:keep_end, :])

        if end >= len(pcm):
            break

    stitched = torch.cat(pieces, dim=1)
    log.info("stitched %d emission window(s) into %d frames", len(pieces), stitched.shape[1])
    return stitched


# ---------------------------------------------------------------------------
# Forced alignment
# ---------------------------------------------------------------------------


def required_frames(target_ids: list[int]) -> int:
    """Minimum CTC frames a target sequence can possibly occupy.

    One frame per token, plus one for each pair of identical adjacent tokens --
    CTC has to emit a blank between them or they collapse into one. Arabic hits
    this constantly (the doubled lam of ٱللَّه), so the naive `len(targets)`
    bound is not enough.
    """
    doubles = sum(1 for i in range(1, len(target_ids)) if target_ids[i] == target_ids[i - 1])
    return len(target_ids) + doubles


def _align_path(emission, target_ids: list[int]):
    """Run Viterbi forced alignment. Returns (per-frame token ids, per-frame log-probs, total)."""
    import torch
    import torchaudio.functional as AF

    blank_id = _blank_id()
    if not target_ids:
        raise AlignError("Empty target sequence -- no reference text to align.")
    needed = required_frames(target_ids)
    if needed > emission.shape[1]:
        raise AlignError(
            f"Reference text needs at least {needed} CTC frames but the audio only has "
            f"{emission.shape[1]} ({emission.shape[1] * 0.02:.1f}s). Too much text for this audio."
        )

    targets = torch.tensor([target_ids], dtype=torch.int32, device=emission.device)
    path, scores = AF.forced_align(emission, targets, blank=blank_id)
    return path[0].cpu().numpy(), scores[0].float().cpu().numpy(), float(scores[0].float().sum())


def _token_spans(path: np.ndarray, scores: np.ndarray) -> dict[int, tuple[int, int, list[float]]]:
    """Collapse the frame path into one frame span per target position.

    A run of identical frames is one position; CTC forces a blank between two
    identical adjacent targets, so resetting on blank keeps doubled letters
    (e.g. the two lams of ٱللَّه) as separate positions.
    """
    blank_id = _blank_id()

    spans: dict[int, tuple[int, int, list[float]]] = {}
    position = -1
    previous = blank_id

    for frame, token in enumerate(path):
        if token == blank_id:
            previous = token
            continue
        if token != previous:
            position += 1
        previous = token
        if position not in spans:
            spans[position] = (frame, frame, [])
        start, _, frame_scores = spans[position]
        frame_scores.append(float(scores[frame]))
        spans[position] = (start, frame, frame_scores)

    return spans


def align_script(
    emission,
    ref_words: list[tuple[str, int, str]],
    script: list[int],
    sec_per_frame: float,
) -> tuple[list[AlignedWord], float]:
    """Align one ordered script (indices into ``ref_words``, repeats allowed)."""
    scripted = [ref_words[i] for i in script]
    target_ids, target_to_word, missing = build_targets(scripted)
    if missing:
        log.warning("characters missing from the alignment vocab (aligned as gaps): %s", sorted(missing))

    path, scores, total = _align_path(emission, target_ids)
    spans = _token_spans(path, scores)

    # target position -> which scripted word it belongs to
    positions_by_word: dict[int, list[int]] = {}
    for position, word_idx in enumerate(target_to_word):
        if word_idx >= 0:
            positions_by_word.setdefault(word_idx, []).append(position)

    seen: set[int] = set()
    aligned: list[AlignedWord] = []
    for scripted_idx, ref_idx in enumerate(script):
        verse_key, word_index, uthmani = ref_words[ref_idx]
        frames = [spans[p] for p in positions_by_word.get(scripted_idx, []) if p in spans]
        if frames:
            start = min(f[0] for f in frames) * sec_per_frame
            end = (max(f[1] for f in frames) + 1) * sec_per_frame
            word_scores = [s for f in frames for s in f[2]]
            score = float(np.exp(np.mean(word_scores))) if word_scores else 0.0
        else:
            # A word whose every character was out-of-vocab gets no frames.
            # Collapse it onto the previous word's end rather than leaving it at
            # 0.0: a word out of time order breaks every downstream gap
            # calculation, and silently turns repeat detection into a runaway.
            start = end = aligned[-1].end if aligned else 0.0
            score = 0.0

        aligned.append(
            AlignedWord(
                text=uthmani,
                verse_key=verse_key,
                word_index=word_index,
                start=round(start, 3),
                end=round(end, 3),
                score=round(score, 4),
                is_repeat=ref_idx in seen,
            )
        )
        seen.add(ref_idx)

    return aligned, total


# ---------------------------------------------------------------------------
# Repeat detection
# ---------------------------------------------------------------------------

#: A hole this long between two aligned words is suspicious -- either a real
#: pause, or audio the linear reference has no text for (i.e. a repeat).
REPEAT_GAP_SEC = 0.6

#: Longest phrase we will consider as having been repeated.
MAX_REPEAT_WORDS = 12

#: A candidate repeat is accepted on *per-frame* gain over the blank baseline,
#: not total gain -- a long gap accumulates more nats than a short one purely
#: by being long, so an absolute threshold would scale with gap length rather
#: than with evidence.
#:
#: Measured on real recitation, the separation is wide and the sign is the real
#: discriminator: a true repeat scored +0.075/frame, while genuine pauses
#: scored -0.077 and -0.126/frame -- every candidate at a real pause came out
#: *worse* than assuming silence. This threshold sits between those bands.
MIN_REPEAT_GAIN_PER_FRAME = 0.03

#: Floor on total gain as well, so a very short gap can't trip the per-frame
#: test on a handful of noisy frames.
#:
#: Both thresholds were set from a single reference clip, so they are the least
#: validated numbers in this module. A multi-word repeat clears them by a wide
#: margin; a one-word match on a very common word (ٱللَّهَ, مَا, مِن) can sit just
#: above them on thin evidence. If false repeats show up, raise these before
#: reaching for anything more elaborate.
MIN_REPEAT_GAIN_TOTAL = 5.0

#: Cap on insertions, so a pathological clip cannot loop indefinitely.
MAX_REPEAT_INSERTIONS = 12

# ---------------------------------------------------------------------------
# Phrase detection
# ---------------------------------------------------------------------------

#: Percentile of the frame-energy distribution treated as "a dip". Recitation
#: recordings are usually produced/normalised and contain no true silence --
#: this clip's floor sits at -27 dB against a -19 dB median -- so an absolute
#: dB threshold finds nothing. The boundaries are *relative* dips.
DIP_PERCENTILE = float(os.getenv("ALIGN_DIP_PERCENTILE", "15"))

#: A dip has to last this long to count as a phrase boundary rather than the
#: ordinary micro-gap between two words.
MIN_DIP_SEC = 0.20

#: Phrases shorter than this are merged into their neighbour -- too short to be
#: a meaningful on-screen segment.
MIN_PHRASE_SEC = 0.8


@dataclass
class Phrase:
    start: float
    end: float


def detect_boundaries(pcm: np.ndarray, window_sec: float = 0.02) -> list[float]:
    """Candidate phrase boundaries, offered generously for the search to choose from.

    Deliberately *not* derived from gaps in the alignment. A hole in a forced
    alignment usually means unmodelled repeated text or a smeared word, not a
    pause -- every such hole measured on the reference clip contained speech at
    68-132% of average level. Splitting on those produced spurious one-word
    segments in the middle of elongated recitation. Real phrase boundaries come
    from the audio itself.

    These are *candidates*, not decisions. Picking one threshold and committing
    to its boundaries fails in both directions at once: on the reference clip
    the setting that found the right count overall still merged two phrases
    inside one ayah while over-splitting another. `assign_phrase_ranges` decides
    which candidates are real, by whether using one lets the text line up
    better -- so this only has to avoid *missing* a true boundary.
    """
    hop = max(1, int(window_sec * SAMPLE_RATE))
    frames = np.array([np.sqrt(np.mean(pcm[i : i + hop] ** 2) + 1e-12) for i in range(0, max(1, len(pcm) - hop), hop)])
    if not len(frames):
        return [Phrase(0.0, len(pcm) / SAMPLE_RATE)]

    db = 20 * np.log10(frames + 1e-12)
    threshold = float(np.percentile(db, DIP_PERCENTILE))

    dips: list[tuple[float, float]] = []
    run_start: int | None = None
    for i, quiet in enumerate(db < threshold):
        if quiet and run_start is None:
            run_start = i
        elif not quiet and run_start is not None:
            if (i - run_start) * window_sec >= MIN_DIP_SEC:
                dips.append((run_start * window_sec, i * window_sec))
            run_start = None
    if run_start is not None and (len(db) - run_start) * window_sec >= MIN_DIP_SEC:
        dips.append((run_start * window_sec, len(db) * window_sec))

    duration = len(pcm) / SAMPLE_RATE
    # Cut at the middle of each dip; the exact instant matters little because a
    # dip is by definition the quietest part of the boundary.
    boundaries = [0.0]
    for dip_start, dip_end in dips:
        midpoint = (dip_start + dip_end) / 2
        if midpoint - boundaries[-1] >= MIN_PHRASE_SEC:
            boundaries.append(midpoint)
    if duration - boundaries[-1] < MIN_PHRASE_SEC and len(boundaries) > 1:
        boundaries.pop()
    boundaries.append(duration)

    log.info(
        "%d candidate boundaries at the p%.0f energy threshold (%.1f dB)", len(boundaries) - 2, DIP_PERCENTILE, threshold
    )
    return boundaries


def _blank_score(emission, frame_start: int, frame_end: int) -> float:
    """Log-likelihood of explaining a frame window as pure silence/blank.

    This is the null hypothesis a candidate repeat has to beat: "there is no
    text here." At frames carrying real speech the blank posterior is low, so
    text that genuinely matches scores above it and text that doesn't scores
    below -- which is exactly the discrimination we need.
    """
    blank_id = _blank_id()
    return float(emission[0, frame_start:frame_end, blank_id].sum())


def _fill_score(emission, ref_words, sequence: list[int], frame_start: int, frame_end: int) -> float:
    """Log-likelihood of a candidate word sequence over one frame window."""
    window = emission[:, frame_start:frame_end, :]
    target_ids, _, _ = build_targets([ref_words[i] for i in sequence])
    if not target_ids or required_frames(target_ids) > window.shape[1]:
        return float("-inf")
    try:
        _, _, total = _align_path(window, target_ids)
    except AlignError:
        return float("-inf")
    return total


# ---------------------------------------------------------------------------
# Phrase -> word-range assignment
# ---------------------------------------------------------------------------

#: Most reference words one phrase can plausibly carry.
MAX_PHRASE_WORDS = 22

#: How far back a phrase may start relative to where the previous one ended,
#: for the small overlaps reciters use when picking a phrase back up.
MAX_BACK_OVERLAP = 4

#: Beam width over phrase->range assignments.
BEAM_WIDTH = 10

#: Consecutive reference words one neighbouring phrase may take back when no
#: phrase claimed them. One or two words is the usual damage from a mid-word
#: boundary or a swallowed conjunction; the cap leaves room for a short phrase
#: whose decode failed outright, while stopping a reference range wider than
#: the audio from having whole ayahs swept into the nearest segment.
MAX_ORPHAN_WORDS = 4

#: A phrase whose decoded text matches the reference this poorly is not part of
#: the passage being aligned -- it is silence, an intro, a du'a, or a surah the
#: caller isn't aligning. Emitting it anyway produced segments captioned with
#: text nobody recited, at 0.00 match, which is worse than emitting nothing.
MIN_ASSIGN_SCORE = 0.5


@dataclass
class Segment:
    verse_key: str
    start_word: int
    end_word: int
    start: float
    end: float
    score: float
    is_restart: bool = False

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class RecitationResult:
    words: list[AlignedWord]
    segments: list[Segment]
    mean_score: float
    #: Fraction of the reference text the phrase assignment actually consumed.
    #:
    #: This is the signal `mean_score` was wrongly believed to provide: whether
    #: the audio plausibly *is* this passage. It works because a phrase is only
    #: given reference words that explain its frames, so a correct reference
    #: gets walked end to end while a wrong one strands most of itself.
    #:
    #: Measured on the reference clip: the correct range covered 1.00, while six
    #: wrong ranges covered 0.04-0.28. Unlike a score threshold, this is close to
    #: scale-free -- it does not move with reciter speed, clip length, or how
    #: much text was supplied.
    #:
    #: A legitimately partial recitation (reference wider than the audio) also
    #: reads low. That is not a false alarm: the range genuinely does not match
    #: the audio, and the caller should narrow it.
    #:
    #: Precisely, this is *how far into* the reference the assignment reached,
    #: not what fraction of it was assigned -- a reading covering words 0-5 and
    #: 60-68 of 69 scores 1.00. That matches `assign_phrase_ranges`' own
    #: `covered` semantics, and it separated every case measured, but it is a
    #: weaker claim than "every word was accounted for".
    reference_coverage: float = 0.0


def _verse_starts(ref_words: list[tuple[str, int, str]]) -> dict[int, int]:
    """Index of the first reference word of each word's own ayah."""
    starts: dict[int, int] = {}
    first_of_verse: dict[str, int] = {}
    for i, (verse_key, _, _) in enumerate(ref_words):
        first_of_verse.setdefault(verse_key, i)
    for i, (verse_key, _, _) in enumerate(ref_words):
        starts[i] = first_of_verse[verse_key]
    return starts


#: How many candidate boundaries a single phrase may swallow. Raising this
#: widens the search quadratically for little gain -- a phrase spanning more
#: than a few candidate dips is rare.
MAX_BOUNDARY_SPAN = 3

#: The same, for the decode-driven path, where it is a genuinely different
#: tradeoff: a merged window decodes *better* than its halves (more context,
#: no cut words), so nothing in a text-match score ever prefers a split and the
#: search will merge as far as it is allowed to. Two is what the evidence
#: supports -- on the reference clip a span of 2 recovered a phrase the dip
#: detector had cut in half (7 of 11 segments correct against 6), while a span
#: of 3 swallowed four real phrase boundaries into one 22-second segment and
#: scored 5.
MAX_DECODE_SPAN = 2


def decode_window(emission, frame_start: int, frame_end: int) -> str:
    """Greedy CTC read-out of one window. Only meaningful for the nemo backend."""
    model, blank_id = _load_nemo_aligner()
    ids = emission[0, frame_start:frame_end].argmax(-1).cpu().tolist()

    collapsed: list[int] = []
    previous = None
    for token in ids:
        if token != previous and token != blank_id:
            collapsed.append(token)
        previous = token
    return model.tokenizer.ids_to_text(collapsed) if collapsed else ""


def decode_phrases(pcm: np.ndarray, boundaries: list[float]) -> list[str]:
    """Greedy read-out of each phrase, with no reference text involved.

    Used by range auto-detection, which has to know what was said before it can
    know what to align against. Each phrase gets its own emission for the same
    reason as in `assign_phrase_ranges_by_decode`: NeMo normalises features per
    window, so a full-clip read-out is a materially different (and worse)
    decode than the same phrases decoded individually.
    """
    decoded: list[str] = []
    for i in range(len(boundaries) - 1):
        chunk = pcm[int(boundaries[i] * SAMPLE_RATE) : int(boundaries[i + 1] * SAMPLE_RATE)]
        if len(chunk) < SAMPLE_RATE // 4:
            decoded.append("")
            continue
        emission = compute_emission(chunk)
        decoded.append(decode_window(emission, 0, emission.shape[1]))
    return decoded


def span_decoder(
    pcm: np.ndarray,
    boundaries: list[float],
    decoded_phrases: list[str] | None = None,
):
    """Greedy read-out of *any* span of candidate boundaries, computed on demand.

    `decode_phrases` reads back adjacent pairs only, which is all range
    detection needs. Choosing between candidate boundaries needs the read-out
    of merged spans too, and those cannot be sliced out of the per-pair ones --
    NeMo normalises features per window, so `[i, j]` decoded whole is a
    different decode from `[i, i+1]` and `[i+1, j]` concatenated. Any
    already-computed pairs are seeded in rather than decoded twice.
    """
    cache: dict[tuple[int, int], str] = {}
    if decoded_phrases is not None:
        cache.update({(i, i + 1): text for i, text in enumerate(decoded_phrases)})

    def decode(i: int, j: int) -> str:
        if (i, j) not in cache:
            chunk = pcm[int(boundaries[i] * SAMPLE_RATE) : int(boundaries[j] * SAMPLE_RATE)]
            if len(chunk) < SAMPLE_RATE // 4:
                cache[(i, j)] = ""
            else:
                emission = compute_emission(chunk)
                cache[(i, j)] = decode_window(emission, 0, emission.shape[1])
        return cache[(i, j)]

    return decode


def _skeleton(word: str) -> str:
    """Loose comparison form: consonant skeleton, alef and weak final letters dropped.

    Dropping *every* alef is what makes this agree with a decoder's spelling.
    Uthmani writes a pronounced long ā as a superscript alef wherever the rasm
    omits the letter (ٱلظّـٰلِمِينَ, لَقَـٰدِرُونَ), and `normalize_for_vocab`
    strips that as a diacritic -- so the reference reads الظلمين while the
    decoder writes الظالمين and the two never match. Writing the superscript
    alef back as ا only moves the problem: for the words whose plain spelling
    also omits it (هذا, ذلك, الله, الرحمن) that breaks matches which
    currently work. Removing the letter from both sides collapses the two
    spellings onto one form, the same trick the trailing weak-letter strip
    already uses for waqf/wasl endings.
    """
    base = normalize_for_vocab(word).replace("ة", "ه")
    base = base.replace("ؤ", "و").replace("ئ", "ي").replace("ء", "")
    base = base.replace("ا", "") or base
    return re.sub(r"[اويه]+$", "", base) or base


def match_decoded_to_range(
    decoded: str,
    ref_words: list[tuple[str, int, str]],
    cursor: int,
) -> tuple[int, int, float] | None:
    """Locate what a phrase decoded to within the reference text.

    Matching the *decoded text* is far more reliable than scoring candidate
    word ranges by alignment likelihood. A Quran-tuned CTC model reads a single
    phrase back almost verbatim, so this is close to a direct read-out, whereas
    likelihood scoring has to compare hypotheses of different lengths and was
    measurably unable to separate them.

    Matching each phrase independently is also what recovers restarts for free:
    when a reciter says a phrase and then repeats it extended, both phrases
    simply match near the same place in the text, and the overlap falls out.
    """
    tokens = [_skeleton(t) for t in decoded.split()]
    tokens = [t for t in tokens if t]
    if not tokens:
        return None

    corpus = [_skeleton(w[2]) for w in ref_words]
    n = len(corpus)
    best: tuple[int, int, float] | None = None

    for start in range(n):
        verse_key = ref_words[start][0]
        # A phrase never spans an ayah boundary.
        limit = start
        while limit + 1 < n and ref_words[limit + 1][0] == verse_key:
            limit += 1

        for end in range(start, min(limit, start + MAX_PHRASE_WORDS - 1) + 1):
            window = corpus[start : end + 1]
            matcher = difflib.SequenceMatcher(None, tokens, window)
            similarity = matcher.ratio()
            # Mild preference for staying near where the last phrase ended, to
            # break ties between the several places a short formulaic phrase
            # legitimately matches.
            distance = min(abs(start - cursor), n) / max(n, 1)
            score = similarity - 0.05 * distance
            if best is None or score > best[2]:
                best = (start, end, score)

    return best


def assign_phrase_ranges(
    emission,
    ref_words: list[tuple[str, int, str]],
    boundaries: list[float],
    sec_per_frame: float,
) -> list[tuple[int, int, float, float, float]]:
    """Decide which reference words each phrase contains.

    A beam search rather than a single forward pass, because the locally best
    range for one phrase is often not the one that lets the rest of the
    recitation line up. Each phrase is scored by force-aligning a candidate
    word range against *only that phrase's frames*, normalised per frame so
    long and short phrases compare fairly.

    Candidate starts are: continue where the last phrase ended, back up a few
    words, or restart at the beginning of an ayah. That last option is what
    reproduces the overlapping structure real recitation has -- a reciter says
    part of an ayah, then goes back to its start and carries further -- which a
    strictly forward alignment cannot represent at all.
    """
    total_frames = emission.shape[1]
    verse_starts = _verse_starts(ref_words)
    n = len(ref_words)
    cache: dict[tuple[int, int, int, int], float] = {}

    def range_value(start: int, end: int, frame_start: int, frame_end: int) -> float:
        """How much better words[start..end] explain these frames than silence does."""
        key = (frame_start, frame_end, start, end)
        if key not in cache:
            # Scoring as gain over blank, rather than raw likelihood, removes a
            # systematic bias toward SHORT ranges: fewer tokens leaves more
            # frames free to take the cheap blank label, so a 1-word guess
            # otherwise beats the correct 8-word range on a long phrase.
            fill = _fill_score(emission, ref_words, list(range(start, end + 1)), frame_start, frame_end)
            null = _blank_score(emission, frame_start, frame_end)
            cache[key] = float("-inf") if fill == float("-inf") else (fill - null) / max(1, frame_end - frame_start)
        return cache[key]

    # boundary index -> list of (cursor, covered, score, assignments)
    states: dict[int, list[tuple[int, int, float, list]]] = {0: [(0, -1, 0.0, [])]}

    for i in range(len(boundaries) - 1):
        if i not in states:
            continue
        for j in range(i + 1, min(i + 1 + MAX_BOUNDARY_SPAN, len(boundaries))):
            phrase_start, phrase_end = boundaries[i], boundaries[j]
            frame_start = max(0, int(phrase_start / sec_per_frame))
            frame_end = min(total_frames, int(phrase_end / sec_per_frame) + 1)
            if frame_end - frame_start < 4:
                continue

            arrivals: list[tuple[int, int, float, list]] = []
            for cursor, covered, total, assignments in states[i]:
                starts = {cursor}
                for back in range(1, MAX_BACK_OVERLAP + 1):
                    if cursor - back >= 0:
                        starts.add(cursor - back)
                # Restarting at the top of an ayah is what produces the
                # overlapping structure real recitation has: part of an ayah,
                # then back to its start and onward. A strictly forward
                # alignment cannot represent that at all.
                starts.add(verse_starts.get(min(cursor, n - 1), 0))
                if cursor > 0:
                    starts.add(verse_starts.get(min(cursor - 1, n - 1), 0))

                for start in sorted(s for s in starts if 0 <= s < n):
                    verse_key = ref_words[start][0]
                    for end in range(start, min(n, start + MAX_PHRASE_WORDS)):
                        # A phrase never spans an ayah boundary -- the reference
                        # site's model, and the natural unit reciters pause on.
                        if ref_words[end][0] != verse_key:
                            break
                        value = range_value(start, end, frame_start, frame_end)
                        if value == float("-inf"):
                            continue
                        arrivals.append(
                            (
                                end + 1,
                                max(covered, end),
                                total + value,
                                assignments + [(start, end, value, phrase_start, phrase_end)],
                            )
                        )

            if not arrivals:
                continue
            # Keep the best state per coverage depth rather than the top N by
            # score: ranking on score alone lets many near-identical shallow
            # readings crowd out the one branch that has actually advanced
            # through the text, and once pruned the search can never reach the
            # end -- it just re-recites the same ayah forever.
            best_by_coverage: dict[int, tuple[int, int, float, list]] = {}
            for state in arrivals + states.get(j, []):
                current = best_by_coverage.get(state[1])
                if current is None or state[2] > current[2]:
                    best_by_coverage[state[1]] = state
            states[j] = sorted(best_by_coverage.values(), key=lambda s: s[2], reverse=True)[:BEAM_WIDTH]

    final = states.get(len(boundaries) - 1, [])
    if not final:
        raise AlignError("Could not assign any phrase ranges -- the audio and reference text may not correspond.")

    complete = [state for state in final if state[1] >= n - 1]
    best = max(complete or final, key=lambda state: state[2])
    if not complete:
        log.warning("no reading covered the full reference (best reached word %d of %d)", best[1] + 1, n)
    return best[3]


def _match_ratio(decoded: str, ref_words: list[tuple[str, int, str]], start: int, end: int) -> float:
    """How well one phrase's decode matches a *given* reference range.

    The similarity `match_decoded_to_range` ranks candidates by, minus its
    proximity tie-break -- here the range is supplied rather than searched for.
    """
    tokens = [token for token in (_skeleton(t) for t in decoded.split()) if token]
    if not tokens or end < start:
        return 0.0
    window = [_skeleton(ref_words[i][2]) for i in range(start, end + 1)]
    return difflib.SequenceMatcher(None, tokens, window).ratio()


def _absorb_orphan_words(
    assignments: list[tuple[int, int, float, float, float]],
    decodes: list[str],
    ref_words: list[tuple[str, int, str]],
) -> list[tuple[int, int, float, float, float]]:
    """Give reference words no phrase claimed to whichever neighbour loses least.

    Every reference word was recited -- that is what makes it reference text --
    so a word no segment contains has been *dropped from the output*, not
    merely unmatched. Two mechanisms strand words, and both leave the audio
    fully claimed, so unclaimed *time* is not the signal:

    * a boundary lands inside a word (a long madd or a shadda dips as quietly
      as a breath), leaving the head in one window and the tail in the other,
      so neither fragment matches -- `ٱلسَّيِّئَةَ` split into `الس` and `َةُ`;
    * the decoder drops a leading conjunction at a phrase edge, so the match
      starts one word late -- `وَصَدَقَ` read back as `صَدَقَ`.

    Which neighbour should take them is decided by evidence rather than by a
    fixed side: each is re-scored with the orphans folded in, and the one whose
    match degrades least gets them. On real recitation that picks a different
    side in different places -- `وَصَدَقَ` costs the phrase before it 0.13 and
    the phrase after it 0.06, while `وَمِنْهُم` costs 0.11 before and 0.20
    after -- which a "always extend the previous segment" rule gets wrong half
    the time.

    The taker's score is recomputed rather than kept, so a segment holding a
    word its decode never read back says so.
    """
    repaired = list(assignments)

    for i in range(len(repaired) - 1):
        start, end, score, phrase_start, phrase_end = repaired[i]
        next_start, next_end, next_score, next_phrase_start, next_phrase_end = repaired[i + 1]

        first, last = end + 1, next_start - 1
        if last < first or last - first + 1 > MAX_ORPHAN_WORDS:
            continue
        # A phrase never spans an ayah boundary, so only a neighbour in the
        # orphans' own ayah may take them.
        verse_key = ref_words[first][0]
        if any(ref_words[w][0] != verse_key for w in range(first, last + 1)):
            continue

        to_previous = ref_words[end][0] == verse_key and last - start + 1 <= MAX_PHRASE_WORDS
        to_next = ref_words[next_start][0] == verse_key and next_end - first + 1 <= MAX_PHRASE_WORDS
        if not to_previous and not to_next:
            continue

        previous_extended = _match_ratio(decodes[i], ref_words, start, last)
        next_extended = _match_ratio(decodes[i + 1], ref_words, first, next_end)
        previous_cost = _match_ratio(decodes[i], ref_words, start, end) - previous_extended
        next_cost = _match_ratio(decodes[i + 1], ref_words, next_start, next_end) - next_extended

        if to_previous and (not to_next or previous_cost <= next_cost):
            # Any audio the skipped phrase left unclaimed goes with the words.
            repaired[i] = (start, last, previous_extended, phrase_start, max(phrase_end, next_phrase_start))
            taker, cost = "%.2f-%.2fs" % (phrase_start, phrase_end), previous_cost
        else:
            repaired[i + 1] = (first, next_end, next_extended, min(next_phrase_start, phrase_end), next_phrase_end)
            taker, cost = "%.2f-%.2fs" % (next_phrase_start, next_phrase_end), next_cost

        log.info(
            "phrase %s takes %d stranded word(s) at %.2f match cost: %r",
            taker,
            last - first + 1,
            cost,
            " ".join(ref_words[w][2] for w in range(first, last + 1)),
        )

    # The mirror case at the front: words the first phrase decoded but did not
    # match, with no earlier segment to weigh against. The same-ayah guard is
    # what keeps a reference range that starts an ayah or two early -- which
    # auto-detection does when a passage opens on text the Quran repeats
    # verbatim -- from having those unrecited ayahs pulled into segment one.
    if repaired:
        start, end, score, phrase_start, phrase_end = repaired[0]
        # Only back to the top of the segment's own ayah -- never into an
        # earlier one, which is how far the reference may legitimately reach.
        first = start
        while first > 0 and ref_words[first - 1][0] == ref_words[start][0]:
            first -= 1
        if first < start and start - first <= MAX_ORPHAN_WORDS and end - first + 1 <= MAX_PHRASE_WORDS:
            log.info(
                "phrase %.2f-%.2fs takes %d stranded word(s) at the start of its ayah: %r",
                phrase_start,
                phrase_end,
                start - first,
                " ".join(ref_words[w][2] for w in range(first, start)),
            )
            repaired[0] = (first, end, _match_ratio(decodes[0], ref_words, first, end), phrase_start, phrase_end)

    # A tail the last phrase decoded badly enough to fall short of -- there is
    # no next segment to weigh it against, and nothing else can ever carry it.
    if repaired:
        start, end, score, phrase_start, phrase_end = repaired[-1]
        last = len(ref_words) - 1
        if (
            end < last
            and last - end <= MAX_ORPHAN_WORDS
            and last - start + 1 <= MAX_PHRASE_WORDS
            and all(ref_words[w][0] == ref_words[end][0] for w in range(end + 1, last + 1))
        ):
            log.info(
                "phrase %.2f-%.2fs takes %d stranded word(s) at the end of the reference: %r",
                phrase_start,
                phrase_end,
                last - end,
                " ".join(ref_words[w][2] for w in range(end + 1, last + 1)),
            )
            repaired[-1] = (
                start,
                last,
                _match_ratio(decodes[-1], ref_words, start, last),
                phrase_start,
                phrase_end,
            )

    return repaired


def _split_strands_words(decode, match_from, i: int, j: int, cursor: int) -> bool:
    """Would keeping the candidate boundaries inside [i, j] lose reference words?

    Walks the span one window at a time and asks whether each window picks up
    where the last left off. A gap means a boundary fell inside a word: both
    halves decode as fragments, neither matches, and the word between them is
    lost. That -- not a better-looking match -- is what justifies merging.
    """
    at = cursor
    for step in range(i, j):
        match = match_from(decode(step, step + 1), at)
        if match is None or match[2] < MIN_ASSIGN_SCORE:
            return True
        start, end, _ = match
        if start > at:
            return True
        at = end + 1
    return False


def phrase_search() -> bool:
    """Whether a phrase may span more than one candidate boundary.

    On by default. Set ASR_PHRASE_SEARCH=0 to pin every candidate boundary as a
    hard split, which is what this path did before the search existed.
    """
    return (os.getenv("ASR_PHRASE_SEARCH") or "1").strip().lower() not in ("0", "false", "no")


def assign_phrase_ranges_by_decode(
    pcm: np.ndarray,
    ref_words: list[tuple[str, int, str]],
    boundaries: list[float],
    decoded_phrases: list[str] | None = None,
) -> list[tuple[int, int, float, float, float]]:
    """Decode each phrase, then locate what it said in the reference text.

    Each phrase gets its **own** emission rather than a slice of the whole
    clip's. That is not an optimisation -- it changes the result. NeMo's
    preprocessor normalises features across whatever window it is handed, so a
    phrase decoded on its own and the same phrase read out of a full-clip
    emission are genuinely different decodes. On the reference clip the
    full-clip read-out silently dropped both repeated phrases and returned
    empty text for one that decodes cleanly in isolation.

    A phrase may span up to `MAX_BOUNDARY_SPAN` candidate boundaries, chosen by
    search rather than fixed in advance. `detect_boundaries` calls its output
    candidates "for the search to choose from", but this path used to treat
    every one as a hard split -- so a dip inside a long madd cut a word in half,
    both halves decoded as fragments, and the word was lost. Measured on real
    recitation, loosening the dip threshold to catch a missed breath made
    results *worse* for exactly this reason (2-5 of 11 segments correct against
    6, with up to 22 reference words dropped), because every extra candidate was
    another forced cut. Being able to decline a candidate is what makes a
    generous candidate list safe.

    Segmentations are compared on reference words explained -- each phrase's
    match ratio weighted by how many words it covers -- rather than on the sum
    of the ratios, which would grow with the number of phrases and so always
    prefer splitting. Merging wins only when it genuinely matches better, and
    an exact tie keeps the finer split.
    """
    decode = span_decoder(pcm, boundaries, decoded_phrases)
    match_from = lambda text, at: match_decoded_to_range(text, ref_words, at)
    phrases = len(boundaries) - 1
    max_span = MAX_DECODE_SPAN if phrase_search() else 1

    # boundary index -> (words explained, phrases used, assignments, decodes)
    states: dict[int, tuple[float, int, list, list[str]]] = {0: (0.0, 0, [], [])}

    for i in range(phrases):
        if i not in states:
            continue
        explained, used, assignments, decodes = states[i]
        cursor = assignments[-1][1] + 1 if assignments else 0

        for j in range(i + 1, min(i + 1 + max_span, phrases + 1)):
            if j > i + 1 and not _split_strands_words(decode, match_from, i, j, cursor):
                # Merging is only ever *allowed* to fix a cut that lost text.
                # Nothing in a text-match score prefers a split -- a longer
                # window has more context and no cut words, so it reads back at
                # least as well -- which means an unconditional search merges
                # every boundary it is offered. On real recitation that turned
                # two correct segments either side of an audible pause into one
                # 21-second segment. Stranded reference words are the evidence
                # that a boundary landed inside a word rather than between two.
                continue
            decoded = decode(i, j)
            match = match_decoded_to_range(decoded, ref_words, cursor)
            if match is None or match[2] < MIN_ASSIGN_SCORE:
                # This span explains nothing. Still a legal step -- the audio may
                # be silence, an intro, or a du'a -- it just earns no credit.
                candidate = (explained, used + 1, assignments, decodes)
            else:
                start, end, score = match
                candidate = (
                    explained + score * (end - start + 1),
                    used + 1,
                    assignments + [(start, end, score, boundaries[i], boundaries[j])],
                    decodes + [decoded],
                )
            current = states.get(j)
            if current is None or candidate[:2] > current[:2]:
                states[j] = candidate

    if phrases not in states:
        raise AlignError("Could not assign any phrase ranges -- the audio and reference text may not correspond.")

    _, _, assignments, decodes = states[phrases]
    claimed = {(a[3], a[4]) for a in assignments}
    for i in range(phrases):
        window = (boundaries[i], boundaries[i + 1])
        if window not in claimed and not any(a[3] <= window[0] and window[1] <= a[4] for a in assignments):
            log.info("phrase %.2f-%.2fs matched nothing in the reference -- no segment emitted", *window)
    for (start, end, score, phrase_start, phrase_end), decoded in zip(assignments, decodes):
        log.info(
            "phrase %.2f-%.2fs -> %s:%d-%d (%.2f) %r",
            phrase_start,
            phrase_end,
            ref_words[start][0],
            ref_words[start][1] + 1,
            ref_words[end][1] + 1,
            score,
            decoded[:60],
        )

    return _absorb_orphan_words(assignments, decodes, ref_words)


def align_recitation(
    pcm: np.ndarray,
    ref_words: list[tuple[str, int, str]],
    boundaries: list[float] | None = None,
    decoded_phrases: list[str] | None = None,
) -> RecitationResult:
    """Full pipeline: phrases from audio, word ranges per phrase, times from alignment.

    `boundaries` and `decoded_phrases` may be passed in when the caller has
    already computed them -- range auto-detection needs the same decodes, and
    they are the expensive part.
    """
    duration = len(pcm) / SAMPLE_RATE
    emission = compute_emission(pcm)
    sec_per_frame = duration / emission.shape[1]

    if boundaries is None:
        boundaries = detect_boundaries(pcm)
    if align_backend() == "nemo":
        assignments = assign_phrase_ranges_by_decode(pcm, ref_words, boundaries, decoded_phrases)
    else:
        assignments = assign_phrase_ranges(emission, ref_words, boundaries, sec_per_frame)

    # The script is every assigned range concatenated, so a restart appears as
    # the same reference words twice -- which is exactly what was recited.
    script: list[int] = []
    for start, end, _, _, _ in assignments:
        script.extend(range(start, end + 1))
    if not script:
        script = list(range(len(ref_words)))

    # Time each phrase *within its own window* rather than running one global
    # alignment over the whole clip. A global pass is free to spread the script
    # across the entire timeline, so a word could be placed far outside the
    # phrase whose decode produced it -- on a 10-minute recitation the first
    # word landed at 2.15-2.23s for a phrase spanning 0.82-9.67s. Constraining
    # each phrase to its own frames keeps segment times and audio in step.
    total_frames = emission.shape[1]
    aligned: list[AlignedWord] = []
    segments: list[Segment] = []
    previous_end = -1

    for start, end, value, phrase_start, phrase_end in assignments:
        frame_start = max(0, int(phrase_start / sec_per_frame))
        frame_end = min(total_frames, int(phrase_end / sec_per_frame) + 1)
        indices = list(range(start, end + 1))

        span: list[AlignedWord] = []
        if frame_end - frame_start >= 2:
            try:
                span, _ = align_script(
                    emission[:, frame_start:frame_end, :], ref_words, indices, sec_per_frame
                )
            except AlignError:
                span = []

        if span:
            for word in span:
                word.start = round(word.start + phrase_start, 3)
                word.end = round(word.end + phrase_start, 3)
        else:
            # Too much text for the window to fit; spread it evenly rather than
            # dropping the segment, and let the low score flag it.
            step = (phrase_end - phrase_start) / max(len(indices), 1)
            span = [
                AlignedWord(
                    text=ref_words[i][2],
                    verse_key=ref_words[i][0],
                    word_index=ref_words[i][1],
                    start=round(phrase_start + n * step, 3),
                    end=round(phrase_start + (n + 1) * step, 3),
                    score=0.0,
                )
                for n, i in enumerate(indices)
            ]

        for word in span:
            word.is_repeat = start <= previous_end
        aligned.extend(span)

        # A segment is a *display* unit, so it spans its whole phrase rather
        # than only the words the decoder happened to catch. Using the tight
        # word span put a caption on screen for 0.08s of an 8.85s phrase when
        # the decode picked up one word of the basmala. Per-word times stay
        # exact in `words` for anything that needs them.
        segments.append(
            Segment(
                verse_key=ref_words[start][0],
                start_word=ref_words[start][1],
                end_word=ref_words[end][1],
                start=round(phrase_start, 3),
                end=round(phrase_end, 3),
                # Already a 0-1 text-match ratio from `match_decoded_to_range`;
                # it is not a log-probability and must not be exponentiated.
                score=round(max(0.0, min(1.0, float(value))), 4),
                is_restart=start <= previous_end,
            )
        )
        previous_end = end

    mean_score = float(np.mean([w.score for w in aligned])) if aligned else 0.0

    # How far through the reference the assignment actually got. Computed from
    # the assignments rather than from `aligned`, because a repeat inserts the
    # same words twice and would otherwise push this above 1.0.
    reached = max((end for _, end, _, _, _ in assignments), default=-1)
    coverage = (reached + 1) / len(ref_words) if ref_words else 0.0
    if coverage < 1.0:
        log.info(
            "reference coverage %.2f -- the reading reached word %d of %d",
            coverage,
            reached + 1,
            len(ref_words),
        )

    return RecitationResult(
        words=aligned,
        segments=segments,
        mean_score=mean_score,
        reference_coverage=round(coverage, 4),
    )


def detect_repeats(
    emission,
    ref_words: list[tuple[str, int, str]],
    sec_per_frame: float,
) -> tuple[list[int], list[dict]]:
    """Grow a linear script into one that accounts for repeated phrases.

    Framed as "what text explains this unexplained audio?" rather than "was
    the preceding phrase repeated?". For each gap the current alignment cannot
    account for, the candidates are the runs of reference words immediately
    before and after the gap -- a reciter repeating themselves says text
    adjacent to where they are -- and each is scored by forced-aligning it
    against *only the gap's frames*. The null hypothesis is that those frames
    are blank; a candidate is accepted only if it explains them better.

    Two things make this robust where a naive version isn't. Scoring is local:
    over a whole clip the tens of nats separating a real repeat are swamped by
    the thousands in the rest of the path. And candidates are drawn from both
    sides of the gap, because in an ambiguous region the linear alignment may
    have placed the first utterance *after* the hole rather than before it.
    """
    script = list(range(len(ref_words)))
    aligned, _ = align_script(emission, ref_words, script, sec_per_frame)
    total_frames = emission.shape[1]
    applied: list[dict] = []

    #: Safety net against pathological input: a recitation that is more than
    #: half repeats is possible, one that is twice its own reference text is
    #: a bug somewhere upstream.
    max_script_length = 2 * len(ref_words)

    for _ in range(MAX_REPEAT_INSERTIONS):
        if len(script) >= max_script_length:
            log.warning("repeat detection stopped: script grew to %d words from %d", len(script), len(ref_words))
            break

        best = None  # (gain per frame, insert_at, sequence, total gain)

        for gap_idx in range(len(aligned) - 1):
            gap = aligned[gap_idx + 1].start - aligned[gap_idx].end
            if gap <= REPEAT_GAP_SEC:
                continue

            # Pad slightly so a word onset/decay at the edge isn't clipped off.
            frame_start = max(0, int((aligned[gap_idx].end - 0.1) / sec_per_frame))
            frame_end = min(total_frames, int((aligned[gap_idx + 1].start + 0.1) / sec_per_frame) + 1)
            if frame_end - frame_start < 4:
                continue

            null = _blank_score(emission, frame_start, frame_end)

            candidates: list[list[int]] = []
            for length in range(1, MAX_REPEAT_WORDS + 1):
                if gap_idx + 1 - length >= 0:  # text just recited
                    candidates.append(script[gap_idx + 1 - length : gap_idx + 1])
                if gap_idx + 1 + length <= len(script):  # text about to be recited
                    candidates.append(script[gap_idx + 1 : gap_idx + 1 + length])

            frames = frame_end - frame_start
            for sequence in candidates:
                if not sequence:
                    continue
                gain = _fill_score(emission, ref_words, sequence, frame_start, frame_end) - null
                if gain == float("-inf"):
                    continue
                if gain < MIN_REPEAT_GAIN_TOTAL or gain / frames < MIN_REPEAT_GAIN_PER_FRAME:
                    continue
                # Rank across gaps by per-frame gain so a long gap doesn't win
                # on length alone.
                if best is None or gain / frames > best[0]:
                    best = (gain / frames, gap_idx + 1, list(sequence), gain)

        if best is None:
            break

        _, insert_at, sequence, gain = best
        repeated = " ".join(ref_words[i][2] for i in sequence)
        log.info(
            "repeat detected: %d word(s) at %.1fs (+%.1f nats over blank) -- %r",
            len(sequence),
            aligned[insert_at - 1].end,
            gain,
            repeated,
        )
        applied.append(
            {
                "atSeconds": round(aligned[insert_at - 1].end, 2),
                "words": len(sequence),
                "gain": round(gain, 1),
                "text": repeated,
            }
        )

        script = script[:insert_at] + sequence + script[insert_at:]
        aligned, _ = align_script(emission, ref_words, script, sec_per_frame)

    return script, applied
