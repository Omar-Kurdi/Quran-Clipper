"""CTC forced alignment of *known* Quran text against recitation audio.

The difference from `asr.py` is the whole point of this module: nothing here
decodes in order to decide *timing*. The caller supplies the Uthmani text, that
text becomes a fixed CTC target sequence, and the model only chooses when each
character was spoken.

Three failure modes of the free-decode pipeline are therefore structurally
impossible rather than merely mitigated:

* a word cannot be dropped -- every reference word is in the target sequence,
  so the Viterbi path must assign it frames;
* a word cannot be garbled -- the output tokens *are* the Quran text, so the
  malformed-token artifact seen with NeMo's CTC branch (`يُؤْمِنُونَ`) has no way
  to occur;
* a word cannot be placed out of order -- the path is monotonic.

Because the search space is one fixed sequence rather than every possible
sequence, acoustic model quality matters far less here than for free decoding.
A model whose free decode of a clip was unreadable still placed all 53 words of
that clip correctly under forced alignment -- see docs/ALIGNMENT.md.

Reading the audio back still happens, and still decides two things nothing else
can: which passage this is, and where the reciter went back on themselves. What
it no longer decides is *when* anything was said. That separation is load-
bearing rather than tidy. When timing came from the read-out too, a phrase
boundary landing inside `رِزْقًا` left a one-letter tail, the tail matched a word
eight ayahs away exactly, 34 correctly-decoded phrases were then discarded for
being "behind" it, and 139 seconds of recitation collapsed into one caption
holding a single word -- at a reported confidence of 1.00. `carries_position`
and the state keying in `assign_phrase_ranges_by_decode` are what stop that;
`align_recitation` documents the order.
"""

from __future__ import annotations

import difflib
import logging
import os
import re
import statistics
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


def gated_model_needs_login() -> bool:
    """Whether the default align model is gated and no HF credential is stored.

    Reported as a warning, never as a backend failure: the weights may already
    be in the local cache from an earlier authenticated run, in which case this
    setup works fine. A false alarm that costs a line of log is acceptable; a
    false alarm that greys the provider out in the studio would not be.
    """
    if align_backend() != "nemo" or align_model_name() != DEFAULT_NEMO_ALIGN_MODEL:
        return False
    try:
        from huggingface_hub import get_token

        return not get_token()
    except Exception:
        return False


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
        # The default checkpoint is a gated repo: an unauthenticated fetch 401s.
        # That is a Hugging Face access decision, not a broken install, and the
        # raw HfHubHTTPError says nothing about how to get past it -- so name the
        # three steps here rather than leave someone reading a stack trace.
        try:
            path = hf_hub_download(repo_id=name, filename="nemo/fastconformer-quran.nemo")
        except Exception as exc:
            raise AlignError(
                f"Could not download {name} ({type(exc).__name__}: {exc}). This model is "
                "gated, so it needs a Hugging Face account that has accepted its terms: "
                f"1) accept them while logged in at https://huggingface.co/{name}, "
                "2) create a read token at https://huggingface.co/settings/tokens, "
                "3) run `hf auth login` (`huggingface-cli login` on huggingface_hub < 1.0) "
                "in this service's virtualenv. Setting ASR_ALIGN_BACKEND=wav2vec2 uses an "
                "ungated model instead but gives up detecting the surah from the audio."
            ) from exc
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
    #: Fraction of the reference text that was actually given time.
    #:
    #: Under one global forced alignment this is 1.0 for any input the aligner
    #: accepts, because every scripted word is given frames by construction --
    #: so it is a completeness check on this pipeline, *not* the wrong-passage
    #: signal it used to be relied on as. Use `decode_agreement` for that.
    #:
    #: It is still worth reporting, and it is now computed honestly: distinct
    #: words that received a timestamp, rather than how far into the reference
    #: the pipeline reached. The old measure read 1.00 on a run that placed
    #: only 10% of the words, because one stray match near the end was enough
    #: to make it look complete.
    reference_coverage: float = 0.0
    #: Independent cross-check that the audio really is this passage, from
    #: comparing what the decoder heard against what the aligner placed there.
    #: `None` when there was nothing to compare. See `decode_agreement`.
    #:
    #: Measured on two clips: 0.888 and 0.873 for the correct range against
    #: 0.010-0.121 for six wrong ones, and 0.479 for a reference covering only
    #: part of its audio. This is the signal `mean_score` and
    #: `reference_coverage` were both wrongly relied on for -- on the same
    #: cases mean score was *higher* for wrong ranges than the right one
    #: (0.947 against 0.696) and coverage read 1.000 for two of them.
    decode_agreement: float | None = None


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
    emission=None,
    sec_per_frame: float | None = None,
    ref_words: list[tuple[str, int, str]] | None = None,
):
    """Greedy read-out of *any* span of candidate boundaries, computed on demand.

    `decode_phrases` reads back adjacent pairs only, which is all range
    detection needs. Choosing between candidate boundaries needs the read-out
    of merged spans too, and those cannot be sliced out of the per-pair ones --
    NeMo normalises features per window, so `[i, j]` decoded whole is a
    different decode from `[i, i+1]` and `[i+1, j]` concatenated. Any
    already-computed pairs are seeded in rather than decoded twice.

    Every span is read **twice** where possible: once from its own emission and
    once out of the clip-wide one the aligner already computed. That same
    per-window normalisation makes these genuinely different decodes, and
    neither is reliably better -- measured over three clips the chunk reading
    won 5 windows, the clip-wide reading won 6, and 18 were level. What matters
    is that their mistakes are not the same mistakes. The clip-wide reading
    recovered the leading conjunction of `وَصَدَقَ`, read `ٱلسَّيِّئَةَ` where the
    chunk gave back the fragment `َةُ`, and got `تَبْدِيلًا` right where the chunk
    said `تَبْْتِيلًا`; the chunk reading in turn carries windows the clip-wide
    one reads as nothing at all. Keeping whichever matches the reference better
    turns a wrong word into a right one at the point it is first read, rather
    than leaving the repair passes downstream to notice a word went missing.
    """
    cache: dict[tuple[int, int], tuple[str, ...]] = {}
    if decoded_phrases is not None:
        cache.update({(i, i + 1): (text,) for i, text in enumerate(decoded_phrases)})

    def readings(i: int, j: int) -> tuple[str, ...]:
        options = cache.get((i, j))
        if options is None:
            chunk = pcm[int(boundaries[i] * SAMPLE_RATE) : int(boundaries[j] * SAMPLE_RATE)]
            if len(chunk) < SAMPLE_RATE // 4:
                options = ("",)
            else:
                own = compute_emission(chunk)
                options = (decode_window(own, 0, own.shape[1]),)
            cache[(i, j)] = options
        if emission is not None and sec_per_frame and len(options) == 1:
            frame_start = max(0, int(boundaries[i] / sec_per_frame))
            frame_end = min(emission.shape[1], int(boundaries[j] / sec_per_frame) + 1)
            if frame_end - frame_start >= 2:
                options = options + (decode_window(emission, frame_start, frame_end),)
                cache[(i, j)] = options
        return options

    def decode(i: int, j: int, cursor: int = 0) -> str:
        options = readings(i, j)
        if len(options) == 1 or ref_words is None:
            return options[0]
        best_text, best_score = options[0], -1.0
        for text in options:
            match = match_decoded_to_range(text, ref_words, cursor)
            score = match[2] if match else -1.0
            if score > best_score:
                best_text, best_score = text, score
        return best_text

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
    base = normalize_for_vocab(word.replace("\u06E7", "ي")).replace("ة", "ه")
    base = base.replace("ؤ", "و").replace("ئ", "ي").replace("ء", "")
    base = base.replace("ا", "") or base
    return re.sub(r"[اويه]+$", "", base) or base


def carries_position(decoded: str) -> bool:
    """Is there enough in this read-out to say *where* in the reference it is?

    A boundary landing inside a word leaves a tail that reads back as a letter
    or two, and a one-letter skeleton carries no positional information at all.
    Against a corpus of any size it always finds a perfect match somewhere: the
    tail of رِزْقًا reduces to `ق`, which matches قُوَّةً eight ayahs away *exactly*
    (1.00) while scoring 0.00 against the رزق it actually came from. That single
    match is what sent a whole recitation off the rails -- so a fragment may
    still continue where the reading already is, but it may never relocate it.
    """
    tokens = [t for t in (_skeleton(t) for t in decoded.split()) if t]
    return len(tokens) >= MIN_ANCHOR_TOKENS and sum(len(t) for t in tokens) >= MIN_ANCHOR_CHARS


def match_decoded_to_range(
    decoded: str,
    ref_words: list[tuple[str, int, str]],
    cursor: int,
    near_only: bool = False,
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

    # A read-out with no position of its own may only continue the reading, not
    # move it. See `carries_position`.
    first, last = 0, n - 1
    if near_only:
        first = max(0, cursor - MAX_BACK_OVERLAP)
        last = min(n - 1, cursor + MAX_BACK_OVERLAP)

    for start in range(first, last + 1):
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


def _unclaimed_between(decode, boundaries, previous_end: float, next_start: float, cursor: int) -> str | None:
    """Read-out of the window(s) no assignment claimed between two segments."""
    if next_start <= previous_end:
        return None
    try:
        i, j = boundaries.index(previous_end), boundaries.index(next_start)
    except ValueError:
        return None
    return decode(i, j, cursor) if j > i else None


def _absorb_orphan_words(
    assignments: list[tuple[int, int, float, float, float]],
    decodes: list[str],
    ref_words: list[tuple[str, int, str]],
    decode=None,
    boundaries: list[float] | None = None,
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
        prefer_previous = previous_cost <= next_cost

        # When a whole window went unclaimed, the stranded words were spoken in
        # *it*, and its own read-out says which side it belongs to far more
        # directly than a match score does. Opening on a real word means the
        # window carries a word of its own and should go forward with the
        # segment that follows; opening on a fragment -- or on nothing at all --
        # means it is the tail of the word before it and belongs backward.
        skipped = None
        if decode is not None and boundaries is not None:
            skipped = _unclaimed_between(decode, boundaries, phrase_end, next_phrase_start, end + 1)
        if skipped is not None:
            opening = skipped.split()
            prefer_previous = not (opening and _carries_a_word(opening[0], ref_words, first))
        # A stranded word carrying a stop mark *ends* a phrase, so it belongs to
        # the segment it closes rather than the one that follows it. This is the
        # same signal the segment splitter uses, read the other way round: the
        # mushaf says a phrase may end here, so a word sitting on one is the
        # last word of what came before, not the first of what comes next.
        if _WAQF_MARKS.search(ref_words[last][2]):
            prefer_previous = True

        if to_previous and (not to_next or prefer_previous):
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


def _carries_a_word(token: str, ref_words=None, expected: int | None = None) -> bool:
    """Is this read-out token a word, or a piece of one left by a cut?

    A cut through a word leaves two kinds of debris. The tail comes back as
    orthography with no consonant in it -- `ٱلسَّيِّئَةَ` splits into `الس` and
    `َةُ`, `وَمِنْهُم` leaves `ُ`. Emptiness alone is too weak a test there: a bare
    ta-marbuta survives normalisation as a letter while being no more a word
    than a lone vowel, so what is left after removing the long vowels, the hamza
    and the ta-marbuta is what decides.

    The *head* is harder, because it is spelled like a real word -- `فَ` is a
    plausible token in isolation. What gives it away is the reference: it is the
    beginning of the word the reading is about to reach and not that word, so
    comparing it against the expected word is what separates `فَ` from
    `فَضَّلْتُكُمْ`.
    """
    if not re.sub(r"[اويهةء]", "", normalize_for_vocab(token)):
        return False
    if ref_words is not None and expected is not None and 0 <= expected < len(ref_words):
        piece, whole = _skeleton(token), _skeleton(ref_words[expected][2])
        if piece != whole and whole.startswith(piece):
            return False
    return True


def _cuts_a_word(decode, i: int, j: int, cursor: int, ref_words=None, match_from=None) -> bool:
    """Does a boundary inside [i, j] look like it landed inside a word?

    A cut through a word leaves half of it stranded at the edge of a window,
    and the decoder reads that half back as orthography with no consonants at
    all -- the tail of ٱلسَّيِّئَةَ came back as `َةُ`, the tail of وَمِنْهُم as
    `ُ`. Anything that normalises to nothing is that: a piece of a word, not a
    word. Its presence is what separates a boundary that broke a word from one
    that merely sits next to a word the decoder garbled -- `مُصَلًّى` read back
    as `مُصًا` is a bad decode, and merging the phrase away is the wrong repair
    for it.
    """
    at = cursor
    for step in range(i, j):
        window = decode(step, step + 1, at)
        tail = window.split()
        # The word a trailing fragment would be the beginning of is the one
        # after everything this window matched, not the one the window started
        # on -- `فَ` at the end of a window reading `وَأَنِّي فَ` is the head of
        # `فَضَّلْتُكُمْ`, two words along from where that window began.
        match = match_from(window, at) if match_from is not None else None
        after = (match[1] + 1) if match else at
        head = decode(step + 1, step + 2, after).split() if step + 1 < j else []
        if tail and not _carries_a_word(tail[-1], ref_words, after):
            return True
        if head and not _carries_a_word(head[0], ref_words, after):
            return True
        at = after
    # The window opening the *next* phrase is the other half of the last cut.
    head = decode(j - 1, j, at).split()
    return bool(head) and not _carries_a_word(head[0], ref_words, at)


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
    emission=None,
    sec_per_frame: float | None = None,
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
    decode = span_decoder(pcm, boundaries, decoded_phrases, emission, sec_per_frame, ref_words)
    match_from = lambda text, at: match_decoded_to_range(text, ref_words, at)
    phrases = len(boundaries) - 1
    max_span = MAX_DECODE_SPAN if phrase_search() else 1

    # (boundary index, how far into the reference this route has got) -> route.
    #
    # Keying on the boundary *and* the reference position is the whole
    # correction here. It used to key on the boundary alone, which quietly made
    # the search wrong rather than merely approximate: how well a route can
    # continue depends entirely on where in the text it left off, so two routes
    # reaching the same boundary at different places are not comparable and the
    # better-scoring one must not be allowed to evict the other.
    #
    # That is exactly how a whole recitation was lost. A one-letter fragment
    # matched a word eight ayahs ahead for +0.97, which beat the honest route's
    # +0.00 at that boundary and replaced it -- and because the surviving route
    # had jumped the cursor to ayah 21, all 34 phrases that followed said text
    # now "behind" it and were dropped as explaining nothing new. Keeping both
    # routes alive lets the comparison happen where it is meaningful, at the
    # end: the honest route explains ~170 words, the poisoned one ~70.
    states: dict[int, dict[int, tuple[float, int, list, list[str]]]] = {0: {-1: (0.0, 0, [], [])}}

    for i in range(phrases):
        if i not in states:
            continue
        # Bounded so the extra dimension cannot make this expensive: only the
        # strongest few routes at each boundary are ever extended.
        routes = sorted(states[i].values(), key=lambda route: route[:2], reverse=True)[:BEAM_WIDTH]

        for explained, used, assignments, decodes in routes:
            reached = assignments[-1][1] if assignments else -1
            cursor = reached + 1

            for j in range(i + 1, min(i + 1 + max_span, phrases + 1)):
                if j > i + 1 and not _cuts_a_word(decode, i, j, cursor, ref_words, match_from):
                    # A longer window reads back at least as well as its halves --
                    # more context, no cut words -- so a better-matching merge is
                    # never on its own a reason to drop a boundary the audio found.
                    # Left unchecked the search merges to paper over a garbled
                    # decode, which is how two correct segments either side of an
                    # audible break became one 25-second caption. Merging needs
                    # evidence the boundary itself was wrong, and a word split
                    # across it is that evidence.
                    continue
                decoded = decode(i, j, cursor)
                match = match_decoded_to_range(
                    decoded, ref_words, cursor, near_only=not carries_position(decoded)
                )
                if match is None or match[2] < MIN_ASSIGN_SCORE:
                    # This span explains nothing. Still a legal step -- the audio may
                    # be silence, an intro, or a du'a -- it just earns no credit.
                    candidate = (explained, used + 1, assignments, decodes)
                elif match[1] <= reached:
                    # This window reaches no further into the reference than
                    # what is already on screen, so it has nothing of its own
                    # to show -- a second reading of a window can now match
                    # text the first reading missed, and without this it
                    # becomes a one-word caption wedged between two segments
                    # that already carry that word. Leaving it unclaimed lets
                    # the audio pass give its time to whichever of them owns it.
                    #
                    # Reaching *further* is a different thing entirely and is
                    # kept: that is a restart, where the reciter goes back and
                    # carries on past where they stopped, and it is a segment
                    # in its own right.
                    candidate = (explained, used + 1, assignments, decodes)
                else:
                    start, end, score = match
                    candidate = (
                        explained + score * (end - start + 1),
                        used + 1,
                        assignments + [(start, end, score, boundaries[i], boundaries[j])],
                        decodes + [decoded],
                    )

                slot = states.setdefault(j, {})
                landed = candidate[2][-1][1] if candidate[2] else -1
                # Rank on words explained, then on *more* phrases. A tie means both
                # segmentations account for the same text equally well, and the
                # finer one is the one that respects the pause the dip detector
                # found. Segments that explain nothing new are suppressed above
                # rather than merged away here.
                current = slot.get(landed)
                if current is None or candidate[:2] > current[:2]:
                    slot[landed] = candidate

    _, _, assignments, decodes = max(states[phrases].values(), key=lambda route: route[:2])
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

    return _absorb_orphan_words(assignments, decodes, ref_words, decode, boundaries)


#: The mushaf's own annotation of where a reciter may stop, which is the
#: question segmentation has to answer. `split_verse_words` glues these onto
#: the word they follow, so they arrive attached to the word they govern.
#:
#: They are *not* interchangeable, and treating them as one class was wrong in
#: both directions. Two of them forbid stopping rather than permitting it:
#:
#: * ``U+06D9`` (ۙ, لا) is lā -- do not stop, the meaning breaks if you do.
#: * ``U+06DC`` (ۜ, س) marks a saktah: a brief pause taken *without* breathing
#:   and without ending the phrase, so it is the opposite of a line ending.
#:
#: The rest permit a stop with different force, and that force decides how much
#: corroboration the audio has to supply (see `_stop_licence`).
_NEVER_STOP_MARKS = re.compile(r"[\u06D9\u06DC]")

#: ``U+06D8`` (ۘ, م) is waqf lāzim: stopping is compulsory because continuing
#: changes the meaning. Only 22 of them in the whole Quran, and at one the
#: reciter always stops -- so the least hesitation is enough to act on.
_COMPULSORY_STOP_MARK = re.compile(r"\u06D8")

#: ``U+06DB`` (ۛ, mu'ānaqa) comes in pairs and means "stop at one of these two,
#: never both": having stopped at the first, stopping at the second leaves the
#: sense incomplete. Twelve in the whole Quran.
_EITHER_OR_STOP_MARK = re.compile(r"\u06DB")

#: ``U+06D6`` (ۖ, صلى, continuing is better), ``U+06D7`` (ۗ, قلى, stopping is
#: better) and ``U+06DA`` (ۚ, ج, either is allowed). All are permission rather
#: than instruction, so each still needs the reciter's own pause to confirm it.
_WAQF_MARKS = re.compile(r"[\u06D6\u06D7\u06DA\u06DB]")

#: Unexplained audio at the end of a segment worth investigating for a repeat.
#: Every segment carries some trailing decay before the next boundary -- 1.0 to
#: 1.5s across the clips measured -- while the one phrase a reciter said twice
#: left 3.6s.
MIN_REPEAT_TAIL_SEC = 1.5

#: Skeleton characters that tail has to read back before it counts as speech
#: rather than a stray letter at the edge of a decode. The tails that are simply
#: silence read back as nothing at all; the one carrying a repeat read back
#: seven characters, against one for the closest thing to a false positive.
MIN_REPEAT_TAIL_CHARS = 3

#: Agreement between what the tail reads and the words that follow it.
MIN_REPEAT_TAIL_MATCH = 0.6


#: The least time between two utterances of the same word for it to be a real
#: repeat rather than a boundary artifact. See the restart rule in
#: `_segment_the_timeline`.
MIN_RESTART_GAP_SEC = float(os.getenv("ALIGN_MIN_RESTART_GAP_SEC", "0.30"))

#: A hole in the alignment narrower than this is ordinary word spacing.
REPEAT_GAP_SEC = float(os.getenv("ALIGN_REPEAT_GAP_SEC", "0.6"))

#: How many words a reciter may go back over when resuming. The practice is to
#: repeat the last word or two so the resumed phrase still carries its meaning;
#: allowing a long run instead lets this explain a hole with whatever fits.
MAX_REPEAT_WORDS = int(os.getenv("ALIGN_MAX_REPEAT_WORDS", "4"))

#: The aligner tends to stretch the word *before* a hole into it, swallowing
#: the onset of what was repeated. Reading a little earlier than the hole
#: recovers it: at the hole exactly, 33:22's repeated قَالُوا۟ reads back as
#: `طامُوا` and matches nothing; 0.2s earlier it reads `قَالُوا`.
REPEAT_LEAD_SEC = 0.2

#: How much of the candidate's spelling has to turn up in what was heard.
#: Measured as recall of the candidate rather than similarity between the two,
#: because the read-out of a hole carries bleed from its neighbours: against
#: `كذبقل` the correct قَالُوا۟ recalls 1.00 where plain similarity gives 0.57,
#: which is below any threshold that also rejects the wrong candidate (0.25).
MIN_REPEAT_MATCH = float(os.getenv("ALIGN_MIN_REPEAT_MATCH", "0.75"))

#: Too little read back to identify anything.
MIN_REPEAT_CHARS = 2

#: A whole phrase said twice is a different thing from going back a word or two
#: for context, and it can leave no hole at all: forced alignment must give
#: every frame to something, so instead of a gap it stretches one word over the
#: first pass. On one clip كَيْدُ was held for 8.3 seconds this way.
#:
#: Length alone cannot flag it -- madd stretches words legitimately -- so a
#: smear is only believed when the over-long word's own audio reads back as a
#: *run* of the reference, which elongation never does.
SMEAR_WORD_FACTOR = float(os.getenv("ALIGN_SMEAR_WORD_FACTOR", "4"))
MIN_SMEAR_SEC = float(os.getenv("ALIGN_MIN_SMEAR_SEC", "2.0"))
MIN_SMEAR_WORDS = 3
MAX_PHRASE_REPEAT_WORDS = int(os.getenv("ALIGN_MAX_PHRASE_REPEAT_WORDS", "8"))

#: Guard against a runaway: a recitation can be half repeats, but not twice its
#: own reference text.
MAX_REPEAT_INSERTIONS = 12


def _phrase_said_twice(
    pcm: np.ndarray,
    ref_words: list[tuple[str, int, str]],
    script: list[int],
    aligned: list[AlignedWord],
    spelling: dict[int, str],
):
    """A whole phrase recited twice, found where one word was stretched over it.

    The hole search cannot see this one. Forced alignment has to give every
    frame to some word, and where a phrase is repeated with no silence to
    separate the passes it covers the first pass by holding a single word --
    `كَيْدُ` for 8.3 seconds on one clip, rather than leaving a gap.

    A long word on its own proves nothing, since madd stretches words by
    design. What distinguishes a smear is that the word's own audio reads back
    as a *run* of the reference rather than as one elongated word.
    """
    lengths = sorted(word.end - word.start for word in aligned)
    if not lengths:
        return None
    typical = lengths[len(lengths) // 2]
    floor = max(MIN_SMEAR_SEC, SMEAR_WORD_FACTOR * typical)

    best = None
    for k, word in enumerate(aligned):
        if word.end - word.start < floor:
            continue
        chunk = pcm[int(word.start * SAMPLE_RATE) : int(word.end * SAMPLE_RATE)]
        if len(chunk) < SAMPLE_RATE // 2:
            continue
        emission = compute_emission(chunk)
        heard = "".join(_skeleton(t) for t in decode_window(emission, 0, emission.shape[1]).split())
        if len(heard) < MIN_REPEAT_CHARS:
            continue
        # The run the smear covered starts at or just before the stretched word.
        for start in range(max(0, k - 2), k + 1):
            for length in range(MIN_SMEAR_WORDS, MAX_PHRASE_REPEAT_WORDS + 1):
                if start + length > len(script):
                    break
                sequence = script[start : start + length]
                spelled = "".join(spelling[i] for i in sequence)
                if len(spelled) < MIN_REPEAT_CHARS:
                    continue
                matcher = difflib.SequenceMatcher(None, heard, spelled)
                matched = sum(block.size for block in matcher.get_matching_blocks())
                recall = matched / len(spelled)
                if recall < MIN_REPEAT_MATCH:
                    continue
                if best is None or (matched, recall) > best[:2]:
                    best = (matched, recall, start, list(sequence))
    return best


def _fill_gaps_with_repeats(
    pcm: np.ndarray,
    ref_words: list[tuple[str, int, str]],
    script: list[int],
    emission,
    sec_per_frame: float,
) -> tuple[list[int], list[dict]]:
    """Account for audio the script has no text for, using the words around it.

    Reciters resume by going back. Having stopped for breath they repeat the
    last word or two before carrying on, so the resumed phrase still reads
    whole -- the practice of ibtidā', and the tradition is explicit that after
    a pause you return far enough for the meaning to stand. A straight script
    has each word once, so the *first* utterance of the repeated words has no
    text to sit on, and the words around it get stretched over that audio.

    The hole is the signal, not the silence. The breath before a resumed phrase
    is often far too short to register as a pause: for the قَالُوا۟ of 33:22,
    recited twice, no dip threshold offers a boundary between the two
    utterances, yet the hole between them is 1.43s wide.

    Candidates are read rather than scored acoustically, which is the part the
    earlier attempt got wrong. Against the clip-wide emission these frames
    carry ~0.99 blank probability despite plainly containing speech, so every
    candidate scores *worse than silence* -- the correct قَالُوا۟ here scores
    -22.6 against it. Decoding the hole on its own emission answers the same
    question directly, because NeMo normalises features over whatever window it
    is handed.
    """
    applied: list[dict] = []
    # Parallel to `script`: True where this pass put a word back because the
    # audio says it was recited again. A backward step at one of these is a
    # repeat that has already been verified acoustically, which is a different
    # thing from two windows of the assignment search claiming the same word.
    inserted = [False] * len(script)
    aligned, _ = align_script(emission, ref_words, script, sec_per_frame)
    limit = 2 * len(ref_words)
    spelling = {i: "".join(_skeleton(t) for t in ref_words[i][2].split()) for i in range(len(ref_words))}

    for _ in range(MAX_REPEAT_INSERTIONS):
        if len(script) >= limit:
            log.warning("repeat detection stopped: script grew to %d words from %d", len(script), len(ref_words))
            break

        best = None  # (matched chars, recall, insert_at, sequence)
        for k in range(len(aligned) - 1):
            if aligned[k + 1].start - aligned[k].end <= REPEAT_GAP_SEC:
                continue
            start_at = max(0.0, aligned[k].end - REPEAT_LEAD_SEC)
            chunk = pcm[int(start_at * SAMPLE_RATE) : int(aligned[k + 1].start * SAMPLE_RATE)]
            if len(chunk) < SAMPLE_RATE // 4:
                continue
            hole_emission = compute_emission(chunk)
            heard = "".join(
                _skeleton(t) for t in decode_window(hole_emission, 0, hole_emission.shape[1]).split()
            )
            if len(heard) < MIN_REPEAT_CHARS:
                continue

            for length in range(1, MAX_REPEAT_WORDS + 1):
                runs = []
                if k + 1 - length >= 0:  # the words just recited, said again
                    runs.append(script[k + 1 - length : k + 1])
                if k + 1 + length <= len(script):  # a run-up to the words about to be recited
                    runs.append(script[k + 1 : k + 1 + length])
                for sequence in runs:
                    spelled = "".join(spelling[i] for i in sequence)
                    if len(spelled) < MIN_REPEAT_CHARS:
                        continue
                    matcher = difflib.SequenceMatcher(None, heard, spelled)
                    matched = sum(block.size for block in matcher.get_matching_blocks())
                    recall = matched / len(spelled)
                    if recall < MIN_REPEAT_MATCH:
                        continue
                    # More of the candidate actually heard wins, so a longer
                    # real repeat beats a short one that merely fits.
                    if best is None or (matched, recall) > best[:2]:
                        best = (matched, recall, k + 1, list(sequence))

        if best is None:
            best = _phrase_said_twice(pcm, ref_words, script, aligned, spelling)
        if best is None:
            break

        matched, recall, insert_at, sequence = best
        spoken = " ".join(ref_words[i][2] for i in sequence)
        log.info(
            "repeat at %.1fs: %d word(s) recited again (%.0f%% of their spelling heard) -- %r",
            aligned[insert_at - 1].end,
            len(sequence),
            recall * 100,
            spoken,
        )
        applied.append(
            {
                "atSeconds": round(aligned[insert_at - 1].end, 2),
                "words": len(sequence),
                "match": round(recall, 2),
                "text": spoken,
            }
        )
        script = script[:insert_at] + sequence + script[insert_at:]
        inserted = inserted[:insert_at] + [True] * len(sequence) + inserted[insert_at:]
        aligned, _ = align_script(emission, ref_words, script, sec_per_frame)

    return script, applied, inserted


#: Tanween, and the vowels whose absence leaves a letter sākin.
_TANWEEN = "\u064B\u064C\u064D"
_VOWELS = "\u064E\u064F\u0650"

#: What a nūn sākinah or tanween does to the letter that follows it. Every one
#: of these is realised as a *held nasal* across the join -- idghām with
#: ghunnah into ي ن م و, iqlāb into ب, and ikhfā' before the fifteen. A mīm
#: sākinah does the same before م and ب.
_GHUNNAH_AFTER_NOON = set("يومنب") | set("تثجدذزسشصضطظفقك")
_GHUNNAH_AFTER_MEEM = set("مب")


#: A word ending in a madd letter, before a word opening on hamza, is madd
#: munfasil: the vowel is held across the join for several counts. Like a
#: ghunnah it is sustained sound rather than silence, and the aligner leaves it
#: as a gap -- وَٱغْفِرْ لَنَآ ۖ إِنَّكَ shows 0.88s of it without one quiet frame,
#: which was enough for a stop mark to put a caption boundary mid-phrase.
# Alef appears both bare (with a separate maddah sign) and precomposed.
_MADD_TAIL = "\u0627\u0622\u0648\u064A\u0649"
_MADDAH = "\u0653"
_HAMZA_HEAD = "\u0621\u0622\u0623\u0625\u0627\u0649"


def _madd_across_junction(first: str, second: str) -> bool:
    """Is a long vowel held from one word into the next (madd munfasil)?"""
    letters = [c for c in first if "\u0621" <= c <= "\u064A"]
    opening = [c for c in second if "\u0621" <= c <= "\u064A"]
    if not letters or not opening:
        return False
    if letters[-1] not in _MADD_TAIL:
        return False
    # The maddah sign is the unambiguous case; a bare madd letter before hamza
    # is the same rule, so both count.
    return opening[0] in _HAMZA_HEAD or _MADDAH in first


def _sustained_junction(first: str, second: str) -> bool:
    """Does the recitation itself hold a sound across this join?

    Either a ghunnah or a madd. Both are sustained voice rather than silence,
    both leave a gap in the alignment, and neither is the reciter stopping.
    """
    return _held_nasal_junction(first, second) or _madd_across_junction(first, second)


def _held_nasal_junction(first: str, second: str) -> bool:
    """Does tajweed hold a nasal across the join between these two words?

    This is the reason no acoustic test could tell a stop from a continuation.
    A ghunnah is a nasal hum held for about two counts: quiet, flat, and
    sustained -- the same shape as silence to anything measuring level, and
    energy, a neural VAD and the alignment gap all read it as a pause. But the
    reciter never stopped; they were still saying the word.

    It is not audible as a break and it is entirely predictable from the text,
    so the text is what settles it. `لَكُم مِّنَ` merges two mīms into one held
    nasal, and `بِكَلِمَـٰتٍ فَأَتَمَّهُنَّ` hides the tanween's nūn behind one -- both
    of which were being read as stops and splitting a phrase mid-word.

    A reciter may still stop at such a join if they choose, since stopping is
    allowed at any word end. This only says that the quiet found *there* is
    explained by the recitation itself, so it takes more than the usual
    evidence to call it a stop.
    """
    letters = [c for c in first if "\u0621" <= c <= "\u064A"]
    if not letters:
        return False
    last = letters[-1]
    tail = first[first.rfind(last) + 1 :]
    voweled = any(c in _VOWELS for c in tail)
    opening = [c for c in second if "\u0621" <= c <= "\u064A"]
    if not opening:
        return False
    head = opening[0]

    if any(c in _TANWEEN for c in first):
        return head in _GHUNNAH_AFTER_NOON
    if last == "\u0646" and not voweled:            # nūn sākinah
        return head in _GHUNNAH_AFTER_NOON
    if last == "\u0645" and not voweled:            # mīm sākinah
        return head in _GHUNNAH_AFTER_MEEM
    return False


def _stop_licence(text: str) -> str:
    """What the mushaf says about stopping after this word.

    ``"never"``   -- lā or a saktah: stopping breaks the sense, so no line ends here.
    ``"always"``  -- waqf lāzim: the reciter stops, so the least hesitation confirms it.
    ``"paired"``  -- mu'ānaqa: allowed, but only at one of the pair.
    ``"allowed"`` -- an ordinary permitted stop, needing the reciter's own pause.
    ``"none"``    -- no mark; only real silence can end a line here.
    """
    if _NEVER_STOP_MARKS.search(text):
        return "never"
    if _COMPULSORY_STOP_MARK.search(text):
        return "always"
    if _EITHER_OR_STOP_MARK.search(text):
        return "paired"
    if _WAQF_MARKS.search(text):
        return "allowed"
    return "none"


def _extend_over_repeated_tail(
    segments: list[Segment],
    spans: list[list[AlignedWord]],
    ref_words: list[tuple[str, int, str]],
    pcm: np.ndarray,
) -> list[Segment]:
    """Carry a segment over words it recited a second time at its own end.

    A reciter finishing a phrase often says its closing words again before
    going on, so the same text belongs to two consecutive segments. A
    straight-line reference cannot express that, and the second utterance --
    quieter and quicker than the first -- is read back too poorly for ordinary
    matching to find: `أَن طَهِّرَا` came back as `وَ عِنَبًاطَهِّرًا`, which shares no
    whole word with the reference and scores 0.00.

    So the comparison is by character rather than by word. Garbling scrambles
    which letters land in which token but leaves most of the letters, and
    `وعنبطهر` against `نطهر` agrees on four of them. That is enough to say what
    was said without needing the decode to be legible.

    Scored against the reference this way rather than acoustically, because the
    acoustic test cannot answer it: the clip-wide emission puts ~0.99 blank
    probability on these frames despite -16.5 dB of audio, and against the
    phrase's own emission the correct longer script still aligns worse than the
    incomplete short one.
    """
    index_of = {(key, position): i for i, (key, position, _) in enumerate(ref_words)}
    out: list[Segment] = []

    for position, (segment, span) in enumerate(zip(segments, spans)):
        out.append(segment)
        if not span:
            continue
        spoken_until = max(word.end for word in span)
        # Up to where the next segment's first word begins -- the whole of the
        # audio no word accounts for. Not `segment.end`: segments are made to
        # meet later, and measuring against a boundary that has already been
        # closed leaves only half the gap to read.
        following = next((s for s in spans[position + 1 :] if s), None)
        unclaimed_until = min(s.start for s in following) if following else segment.end
        if unclaimed_until - spoken_until < MIN_REPEAT_TAIL_SEC:
            continue
        last = index_of.get((segment.verse_key, segment.end_word))
        if last is None:
            continue

        chunk = pcm[int(spoken_until * SAMPLE_RATE) : int(unclaimed_until * SAMPLE_RATE)]
        if len(chunk) < SAMPLE_RATE // 4:
            continue
        emission = compute_emission(chunk)
        heard = "".join(_skeleton(t) for t in decode_window(emission, 0, emission.shape[1]).split())
        if len(heard) < MIN_REPEAT_TAIL_CHARS:
            continue

        best = None
        for length in range(1, MAX_ORPHAN_WORDS + 1):
            sequence = list(range(last + 1, last + 1 + length))
            if sequence[-1] >= len(ref_words) or ref_words[sequence[-1]][0] != segment.verse_key:
                break
            spelled = "".join(_skeleton(ref_words[i][2]) for i in sequence)
            ratio = difflib.SequenceMatcher(None, heard, spelled).ratio()
            if best is None or ratio > best[0]:
                best = (ratio, sequence)

        if best is None or best[0] < MIN_REPEAT_TAIL_MATCH:
            continue
        ratio, sequence = best
        log.info(
            "phrase %.2f-%.2fs says %d more word(s) in its last %.1fs than its text covered (%.2f): %r",
            segment.start,
            segment.end,
            len(sequence),
            unclaimed_until - spoken_until,
            ratio,
            " ".join(ref_words[i][2] for i in sequence),
        )
        out[-1] = Segment(
            verse_key=segment.verse_key,
            start_word=segment.start_word,
            end_word=ref_words[sequence[-1]][1],
            start=segment.start,
            # It was still reciting right up to the next segment, so it should
            # still be on screen: this is a caption that ended too early, not
            # only one missing words.
            end=round(unclaimed_until, 3),
            score=segment.score,
            is_restart=segment.is_restart,
        )

    return out


# ---------------------------------------------------------------------------
# Segmentation from the aligned timeline
# ---------------------------------------------------------------------------

#: Evidence a decoded phrase must carry before it is allowed to say anything
#: about *where* in the reference the reciter is. See `carries_position`.
MIN_ANCHOR_TOKENS = 2
MIN_ANCHOR_CHARS = 4


#: A pause on a stop mark only has to be long enough to be deliberate; the
#: mark carries the rest of the decision. Expressed against the clip's own
#: word gaps so it travels across reciters and tempos.
WAQF_PAUSE_FACTOR = float(os.getenv("ALIGN_WAQF_PAUSE_FACTOR", "1.5"))
MIN_WAQF_PAUSE_SEC = float(os.getenv("ALIGN_MIN_WAQF_PAUSE_SEC", "0.30"))

#: How far below the clip's own speech level counts as "not making sound".
#:
#: Measured against the speech level rather than as a rank over the clip, so
#: that trimming a recording does not change where it splits. A rank moves with
#: whatever else is in the file -- on one recording p16 sat at -18.0 dB over the
#: whole 308s and -17.0 dB over a 96s excerpt of it, enough to segment identical
#: audio differently. The speech level barely moves between the two (-10.1 dB
#: against -10.0 dB), being a property of the reciter and the room rather than
#: of how much was kept.
QUIET_DROP_DB = float(os.getenv("ALIGN_QUIET_DROP_DB", "10"))

#: Quiet either side of a brief interruption is one pause. Drawing breath in
#: the middle of a silence is audible, so the run of quiet frames breaks in two
#: -- on one clip a plain 0.88s pause came back as 24 quiet frames out of 46
#: whose longest unbroken run was 0.16s, and was discarded for missing 0.18s by
#: a single frame. Joining across a gap this short recovers it without joining
#: anything a word could fit inside.
QUIET_MERGE_SEC = float(os.getenv("ALIGN_QUIET_MERGE_SEC", "0.12"))

#: How far short of a word's end a silence may stop and still be read as
#: following that word. Beyond this the word is plainly still being said after
#: the quiet, so the quiet is inside it rather than at the join.
MAX_PAUSE_INSET = float(os.getenv("ALIGN_MAX_PAUSE_INSET", "0.25"))

#: Quiet shorter than this is the ordinary articulation gap between two words,
#: not a stop.
MIN_PAUSE_SEC = float(os.getenv("ALIGN_MIN_PAUSE_SEC", "0.18"))

#: How long the reciter must stop for at a place the mushaf marks. Lower than
#: the unmarked bar because less hesitation is needed to mean it there -- but a
#: mark alone never ends a line. The reciter's own voice decides.
MIN_MARKED_PAUSE_SEC = float(os.getenv("ALIGN_MIN_MARKED_PAUSE_SEC", "0.18"))

#: How long the reciter must stop for it to end a line with no waqf mark
#: licensing it. A reciter may stop anywhere, not only where the mushaf marks
#: it, so this is not a high bar -- it is the same "they actually stopped"
#: threshold as `MIN_RESTART_GAP_SEC`, which is the point: a stop is a stop,
#: whether the reciter then repeats a word or starts a new line.
#:
#: Lowering it to 0.18 scores better on the reference clip (11/11 against 9/11)
#: and is still the wrong setting: it splits `ٱلْأَنْهَـٰرُ` into a caption of its
#: own on another recording, and makes the same passage segment differently
#: depending on how much audio surrounds it. Marginal decisions are where the
#: two disagree, so the bar is kept above them.
MIN_UNMARKED_PAUSE_SEC = float(os.getenv("ALIGN_MIN_UNMARKED_PAUSE_SEC", "0.30"))

#: How much more silence it takes to call a stop where tajweed already holds a
#: nasal across the join. Enough to cover the ghunnah itself and no more: on one
#: clip the held nasals measure 0.00s and 0.30s of quiet where the reciter did
#: not stop, against 0.72s at a join carrying the same rule where they did.
#: See `_held_nasal_junction`.
NASAL_JUNCTION_FACTOR = float(os.getenv("ALIGN_NASAL_JUNCTION_FACTOR", "2"))


def quiet_spans(pcm: np.ndarray, window_sec: float = 0.02) -> list[tuple[float, float]]:
    """Stretches where the reciter is not making sound.

    An unmarked break is corroborated against *this*, not against holes in the
    alignment: a hole means the path had no text for those frames, which is
    what a repeated phrase or a smeared word looks like, and measured on real
    recitation those holes contain speech at 68-132% of average level.

    A rank rather than a level, because how quiet a recording gets between
    phrases is mostly a property of the room. On two clips here the same
    absolute drop found 28 pauses in one and 4 in the other, and the second was
    not the one that paused less -- it was the reverberant one, whose real
    stops never fall as far. `detect_boundaries` uses the same idea for the
    same reason; this is a separate, tighter setting because it is deciding
    rather than offering candidates.
    """
    hop = max(1, int(window_sec * SAMPLE_RATE))
    frames = np.array(
        [np.sqrt(np.mean(pcm[i : i + hop] ** 2) + 1e-12) for i in range(0, max(1, len(pcm) - hop), hop)]
    )
    if not len(frames):
        return []
    db = 20 * np.log10(frames + 1e-12)
    threshold = float(np.percentile(db, 70)) - QUIET_DROP_DB

    runs: list[tuple[float, float]] = []
    run: int | None = None
    for i, hushed in enumerate(db < threshold):
        if hushed and run is None:
            run = i
        elif not hushed and run is not None:
            runs.append((run * window_sec, i * window_sec))
            run = None
    if run is not None:
        runs.append((run * window_sec, len(db) * window_sec))

    # Join runs a breath broke apart, then keep what is long enough to be a stop.
    merged: list[list[float]] = []
    for begin, end in runs:
        if merged and begin - merged[-1][1] <= QUIET_MERGE_SEC:
            merged[-1][1] = end
        else:
            merged.append([begin, end])
    return [(a, b) for a, b in merged if b - a >= MIN_PAUSE_SEC]


def _close_gaps(segments: list[Segment], duration: float) -> list[Segment]:
    """Make consecutive segments meet, so a caption never blinks out.

    Runs *after* `_extend_over_repeated_tail`, and has to. Closing first hides
    the very evidence that pass reads: it looks at the audio between a
    segment's last aligned word and the next segment's first, and once the two
    have been made to meet in the middle only half of that is left. Decoding
    that half of one gap gave `وَامٌ وَاقب`, which matches nothing, where the
    whole gap reads `عِلَف طَهِّرًا` and matches at once.
    """
    for earlier, later in zip(segments, segments[1:]):
        middle = round((earlier.end + later.start) / 2, 3)
        earlier.end = middle
        later.start = middle
    if segments and 0 < duration - segments[-1].end < 2.0:
        segments[-1].end = round(duration, 3)
    return segments


def _segment_the_timeline(
    aligned: list[AlignedWord],
    script: list[int],
    duration: float,
    pauses: list[tuple[float, float]] | None = None,
    repeated: list[bool] | None = None,
) -> tuple[list[Segment], list[list[AlignedWord]]]:
    """Cut the aligned word sequence into on-screen segments.

    Segments are read *off* the alignment rather than decided before it. The
    old path did the opposite -- energy dips fixed the phrases, each phrase's
    decode was searched for in the corpus, and the timeline was whatever that
    search returned -- which let a single mismatched fragment place a word two
    minutes from where it was said. Here the path decides when every word was
    spoken first, and a segment is only ever a *grouping* of consecutive words,
    so no segment can span audio its own words do not cover.

    A line breaks at the end of an ayah, where the reciter went back to repeat
    something, at a mushaf stop mark they paused on, or at a silence too long
    for anything else to explain.

    The stop mark carries most of that decision, and it has to, because the
    two signals available without it do not order these cases. Pause *length*
    does not: 0.20s of quiet after لَكُم and 0.26s after رِزْقًا ۚ are the same
    pause, and only the second ends a phrase -- what separates them is where
    the sentence ends, which the mushaf already annotates and the audio does
    not. A gap in the *alignment* does not either, and is worse than useless:
    a hole in the path means it had no text for those frames, which is what a
    repeat or a smeared word looks like, and on one 250s clip every unmarked
    break taken from a hole landed on no silence at all -- several on
    stretches louder than the clip average. That is what split a continuous
    `وَيُنَزِّلُ لَكُم مِّنَ السَّمَاءِ رِزْقًا` where the reciter never stopped.

    So a mark needs only weak corroboration that the reciter did pause, and
    that can come from the word gap. Breaking *without* a mark has to carry
    the whole decision alone, so it needs real silence in the audio, and
    enough of it that nothing articulatory accounts for it.
        """
    if not aligned:
        return [], []

    pauses = sorted(pauses or ())

    gaps = sorted(
        max(0.0, nxt.start - word.end)
        for word, nxt in zip(aligned, aligned[1:])
        if word.verse_key == nxt.verse_key
    )
    # What "no pause" costs this reciter, from the clip's own timing.
    typical = statistics.median(gaps[: max(1, len(gaps) // 2)]) if gaps else 0.0
    waqf_pause = max(MIN_WAQF_PAUSE_SEC, WAQF_PAUSE_FACTOR * typical)

    def stopped_between(word: AlignedWord, nxt: AlignedWord) -> bool:
        """Did the reciter actually fall silent around this junction?

        Searched over the whole of both words rather than the gap between them,
        because the aligner routinely stretches a word across a silence: on one
        clip إِلَيْكَ was held over a 1.42s pause, leaving the repeat that followed
        it 0.08s away and looking like an artifact.
        """
        return any(
            end - begin >= MIN_RESTART_GAP_SEC and begin < nxt.end and end > word.start
            for begin, end in pauses
        )

    # Index of the last word of each piece.
    cuts: set[int] = set()
    for i, (word, nxt) in enumerate(zip(aligned, aligned[1:])):
        if word.verse_key != nxt.verse_key:
            cuts.add(i)
        elif script[i + 1] <= script[i]:
            # The reciter went back rather than on: a restart starts its own
            # line -- but only if they stopped first, since going back means
            # having stopped. A word cannot be said twice with 0.08s between
            # the utterances; that is a boundary cutting close to a word so
            # both windows read it. The stop counts whether it shows as a gap
            # between the two or as silence the aligner covered over.
            # Either side: a phrase put back before the run it repeats leaves
            # the backward step on the *original* word, not the inserted one.
            verified = bool(repeated) and i + 1 < len(repeated) and (repeated[i] or repeated[i + 1])
            if verified or nxt.start - word.end >= MIN_RESTART_GAP_SEC or stopped_between(word, nxt):
                # `verified` is a repeat the audio was read for and found to
                # contain those words again; it needs no separate proof that
                # the reciter stopped. Asking for one anyway hid a repetition
                # of وَلَقَدْ أَرْسَلْنَا مُوسَىٰ behind a smeared بِـَٔايَـٰتِنَا, which
                # left the whole passage on screen as though said once.
                cuts.add(i)

    # A stop mark plus the reciter's own hesitation ends a line. The gap is
    # read from the alignment here rather than from measured silence, because
    # in a reverberant recording a real stop need not go quiet at all: the
    # break at وَرَسُولُهُۥ ۚ bottoms out at only the 12th percentile of its clip,
    # shallower than junctions elsewhere where the reciter plainly did not
    # stop. The mark is what makes the hesitation meaningful.
    for i, (word, nxt) in enumerate(zip(aligned, aligned[1:])):
        if word.verse_key != nxt.verse_key:
            continue
        if _stop_licence(word.text) in ("allowed", "always", "paired"):
            # The mark plus the reciter's own hesitation. The gap is read from
            # the alignment rather than from measured silence, because in a
            # reverberant recording a real stop need not go quiet at all -- the
            # break at وَرَسُولُهُۥ ۚ has no quiet frame in it whatever. What keeps
            # elongation from passing as hesitation here is `_sustained_junction`.
            if _sustained_junction(word.text, nxt.text):
                # The recitation itself accounts for the gap, so the gap says
                # nothing about hesitation and the mark has nothing to stand on.
                # Leave it to the pause loop below, which asks the audio.
                pass
            elif nxt.start - word.end >= waqf_pause:
                cuts.add(i)

    # Every stop the reciter took ends a line. The audio decides this and
    # nothing else does: a stop mark is permission rather than instruction, and
    # reciters continue past them all the time -- breaking at ٱلْخَيْرِ ۚ on the
    # strength of the mark alone put a caption boundary where the recitation
    # ran straight on. All a mark does here is lower the bar for how much
    # silence counts, because at a place the mushaf marks less hesitation is
    # needed to mean it. A reciter may stop anywhere, marked or not.
    for pause_start, pause_end in pauses:
        length = pause_end - pause_start
        if length < MIN_MARKED_PAUSE_SEC:
            continue
        # The word the reciter had reached when the silence began. Chosen by
        # where each word *started*, so a word stretched over the silence is
        # still the one the pause follows.
        begun = [i for i, word in enumerate(aligned[:-1]) if word.start <= pause_start]
        if not begun:
            continue
        i = max(begun)
        if pause_end < aligned[i].end - MAX_PAUSE_INSET:
            # The silence stops well before this word does, so the word is
            # still going afterwards and the quiet is somewhere inside it, not
            # at the join. A word the aligner has stretched still ends where it
            # ends: لِّمَنِ smeared over 1.83s has 0.4s of quiet in its first
            # half and 0.6s of word after it, and splitting there left ٱلْمُلْكُ
            # alone in a caption. A silence the reciter really took runs *to*
            # the end of the word before it, or past it.
            continue
        follows = aligned[i + 1].start >= pause_start - 0.10
        covered = pause_end <= aligned[i].end + 0.10
        if not follows and not covered:
            # The next word had already run past this silence, so it separates
            # nothing -- the run-out at the end of a recording is silence after
            # the last word, not between two of them.
            continue
        marked = _stop_licence(aligned[i].text) in ("allowed", "always", "paired")
        bar = MIN_MARKED_PAUSE_SEC if marked else MIN_UNMARKED_PAUSE_SEC
        if _sustained_junction(aligned[i].text, aligned[i + 1].text) and not marked:
            # A ghunnah or a madd is held across this join, so quiet here is
            # partly the recitation itself and proves less than usual. With a
            # mark the bar is already the lower one and the mark carries the
            # rest: رِزْقًا ۚ is a ghunnah join the reciter does stop at, on 0.26s,
            # where the unmarked بِكَلِمَـٰتٍ does not on 0.30s.
            bar *= NASAL_JUNCTION_FACTOR
        if length >= bar:
            cuts.add(i)

    cuts.add(len(aligned) - 1)

    segments: list[Segment] = []
    spans: list[list[AlignedWord]] = []
    first = 0
    previous_end = -1
    for cut in sorted(cuts):
        span = aligned[first : cut + 1]
        if not span:
            continue
        scores = [w.score for w in span if w.score > 0]
        segments.append(
            Segment(
                verse_key=span[0].verse_key,
                start_word=span[0].word_index,
                end_word=span[-1].word_index,
                start=round(span[0].start, 3),
                end=round(span[-1].end, 3),
                score=round(float(np.mean(scores)) if scores else 0.0, 4),
                is_restart=script[first] <= previous_end,
            )
        )
        spans.append(span)
        previous_end = script[cut]
        first = cut + 1

    return segments, spans


def decode_agreement(
    aligned: list[AlignedWord],
    boundaries: list[float],
    decoded_phrases: list[str],
) -> float | None:
    """How far the free decode and the forced path agree on what is where.

    Forced alignment cannot fail loudly. Give it any text and any audio and it
    returns a complete, monotonic, confident-looking timeline -- so a user who
    picked the wrong ayah range gets plausible garbage rather than an error.

    `reference_coverage` used to be the guard, on the reasoning that a wrong
    reference cannot be walked to its end. Under a single global alignment that
    reasoning no longer holds: every reference word is placed by construction,
    correct range or not, so coverage reads 1.00 either way and separates
    nothing. (It read 1.00 on the run that dropped ayahs 14-20 entirely.)

    This separates them because it is an *independent* reading of the same
    audio. For each phrase, what the decoder heard is compared with the words
    the alignment placed in those seconds -- two different methods answering
    the same question. On the right text they describe the same recitation; on
    the wrong text the aligner is fitting text to audio that never said it, and
    the two stop agreeing. No corpus search is involved, so unlike the old
    coverage figure this cannot be talked into agreeing with itself.
    """
    if align_backend() != "nemo":
        # The threshold this feeds is calibrated against the Quran-tuned
        # decode. The general Arabic model's free output is unreadable -- the
        # transcript in docs/ALIGNMENT.md is the example -- so it disagrees
        # just as much with a *correct* alignment, and comparing it against
        # that threshold would warn on every clip. Unmeasurable, not zero.
        return None

    ratios: list[float] = []
    for i, text in enumerate(decoded_phrases):
        if i + 1 >= len(boundaries):
            break
        tokens = [t for t in (_skeleton(t) for t in text.split()) if t]
        if len(tokens) < MIN_ANCHOR_TOKENS or sum(len(t) for t in tokens) < MIN_ANCHOR_CHARS:
            # Too little read back to be evidence either way -- see MIN_ANCHOR_TOKENS.
            continue
        start, end = boundaries[i], boundaries[i + 1]
        here = [_skeleton(w.text) for w in aligned if w.start < end and w.end > start]
        ratios.append(difflib.SequenceMatcher(None, tokens, here).ratio() if here else 0.0)

    # None, not 0.0: nothing was read back to compare against, which is not
    # the same as reading back something that disagreed.
    return round(float(np.mean(ratios)), 4) if ratios else None


def align_recitation(
    pcm: np.ndarray,
    ref_words: list[tuple[str, int, str]],
    boundaries: list[float] | None = None,
    decoded_phrases: list[str] | None = None,
) -> RecitationResult:
    """Full pipeline: decide *what* was recited, then align it, then group it.

    Each stage now does only the job it is good at, which is the change that
    matters. Reading the audio back says which words were said and where the
    reciter went back on themselves -- it is reliable at that and nothing else
    replaces it. One forced alignment then decides *when* every one of those
    words was said. Segments are only a grouping of consecutive aligned words.

    Timing used to come from the read-out too, and that is what broke long
    recitations. Energy dips fixed the phrases, each phrase's decode was
    searched for in the corpus, and the timeline was whatever came back -- so a
    boundary landing inside a word left a one-letter tail, the tail matched a
    word eight ayahs away exactly, and 34 correctly-decoded phrases were then
    dropped for being "behind" it. 139 seconds of recitation became a single
    one-word caption, reported at confidence 1.00. Two things stop that here:
    the search can no longer be moved by a read-out that carries no position
    (`carries_position`), and it no longer discards routes that are behind on
    score but ahead on truth (see the state keying in the assignment search).

    Taking timing off the alignment fixes the quieter half of the same problem.
    A dip in the energy envelope is evidence of a pause, not proof of one, and
    treating every dip as a segment break split a continuous
    `وَيُنَزِّلُ لَكُم مِّنَ السَّمَاءِ رِزْقًا` across a breath the reciter never took.
    Segments now break where a reader would break them -- see
    `_segment_the_timeline`.

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
        assignments = assign_phrase_ranges_by_decode(
            pcm, ref_words, boundaries, decoded_phrases, emission, sec_per_frame
        )
    else:
        assignments = assign_phrase_ranges(emission, ref_words, boundaries, sec_per_frame)

    # The script is every assigned range concatenated, so a restart appears as
    # the same reference words twice -- which is exactly what was recited, and
    # what gives the alignment below text to put over the second utterance
    # instead of stretching its neighbours across it.
    script: list[int] = []
    for begin, finish, _, _, _ in assignments:
        script.extend(range(begin, finish + 1))
    if not script:
        script = list(range(len(ref_words)))

    # Give the reciter's own repeats text of their own, so the words around a
    # hole are not stretched across audio that said something else. See
    # `_fill_gaps_with_repeats`.
    script, repeats, repeated = _fill_gaps_with_repeats(pcm, ref_words, script, emission, sec_per_frame)

    # The one pass that decides all timing, over the whole clip at once.
    # Monotonic and gapless by construction: every scripted word is given
    # frames, in order, so no word can be placed outside the path and none can
    # be dropped. Measured against per-ayah ground truth on a 220s recitation,
    # this placed all 177 words with a mean ayah-start error of 0.48s.
    aligned, _ = align_script(emission, ref_words, script, sec_per_frame)

    segments, spans = _segment_the_timeline(aligned, script, duration, quiet_spans(pcm), repeated)
    segments = _close_gaps(_extend_over_repeated_tail(segments, spans, ref_words, pcm), duration)

    if decoded_phrases is None and align_backend() == "nemo":
        # Not free, but this is the only check that can catch a wrong ayah
        # range, and a supplied reference is exactly where one gets picked.
        try:
            decoded_phrases = decode_phrases(pcm, boundaries)
        except AlignError:
            decoded_phrases = []
    agreement = decode_agreement(aligned, boundaries, decoded_phrases or [])

    mean_score = float(np.mean([word.score for word in aligned])) if aligned else 0.0

    # Distinct reference words that were actually given time -- not how far
    # into the reference the pipeline reached, which is what this used to
    # measure and which read 1.00 on a run that placed only 10% of the words.
    assigned = {(word.verse_key, word.word_index) for word in aligned}
    coverage = len(assigned) / len(ref_words) if ref_words else 0.0
    if coverage < 1.0:
        log.info(
            "reference coverage %.2f -- %d of %d word(s) were never recited",
            coverage,
            len(ref_words) - len(assigned),
            len(ref_words),
        )

    return RecitationResult(
        words=aligned,
        segments=segments,
        mean_score=mean_score,
        reference_coverage=round(coverage, 4),
        decode_agreement=agreement,
    )

