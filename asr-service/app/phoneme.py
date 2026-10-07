"""Re-timing aligned words with a phoneme-level Quran model.

The studio's aligner places words with `Muno459/fastconformer-quran`, a
character model. The zipformers below recognise phonemes instead, trained for
tajweed, and place word starts more tightly: measured 2026-10-03 on 267 ayahs of
67 and 78 (four reciters) against QUL's word timings, with one fixed offset per
model fitted on three reciters and tested on the fourth, fastconformer's median
error was 124 ms with 15.3% of words over 300 ms off, v3.1's 101 ms and 6.4%,
the older zipformer_p-quran's 111 ms and 4.7% (FutureIdeas #58).

Nothing about the captions changes here. Fastconformer still finds the passage
and cuts the captions; this only moves each word's start inside the caption it
already belongs to, which is what Highlight and Reveal draw. Every match does
this with `DEFAULT_RETIME`, the model with the fewest words badly misplaced;
the other is offered in a personal studio under `npm run dev` for comparison,
and only a model that is used is ever downloaded.

Feeding these times to the caption rules instead was measured too (2026-10-04,
`ALIGN_PHONEME_TIMING`): 233/265 for v3.1 and 228/265 for the older model,
against fastconformer's 244 -- the rules are tuned to fastconformer's timing.

Both models are gated on the Hub and released under Quran-Lab's no-profit
licence (NPL-1.2 for v3.1, NPL-1.1 for the older one) -- accept them on the Hub
with the account the service logs in as. A model that cannot be loaded leaves
fastconformer's times, and says so in the log.

Heavy imports (onnxruntime, torch, huggingface_hub) stay inside functions, so
the pure parts can be tested with numpy alone.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np

from .audio import SAMPLE_RATE
from .phoneme_table import Unit, tokenize, units_for  # noqa: F401 -- also how `phoneme_reading` reaches them

if TYPE_CHECKING:  # the types only; `retime` is handed what `align` made
    import torch

    from .align import AlignedWord, Segment

log = logging.getLogger("asr-service")


@dataclass(frozen=True)
class PhonemeModel:
    repo: str
    revision: str
    onnx: str
    #: Where its word starts sit against QUL's word timings, in seconds (later
    #: is positive): the streaming encoder emits a little after the sound. One
    #: constant per model, measured as above.
    offset: float


MODELS: dict[str, PhonemeModel] = {
    "v31": PhonemeModel(
        repo="Quran-Lab/zipformer_p-arabic-v3",
        revision="3da514fc833b22c902ee466a7710cf399896f2f0",
        onnx="zipformer_p_arabic_v3.1.int8.onnx",
        offset=0.114,
    ),
    "old": PhonemeModel(
        repo="Muno459/zipformer_p-quran",
        revision="5cf149946f9ccf7bab30f16462e871e9031b4585",
        onnx="quran_phoneme_zipformer.int8.onnx",
        offset=0.031,
    ),
}

#: The model every match re-times its words with: the older zipformer, whose
#: tail is the shortest (4.7% of words over 300 ms off, against v3.1's 6.4%).
#: `ASR_PHONEME_RETIME` names another, or `none` -- as can a request -- for
#: fastconformer's own times.
DEFAULT_RETIME = "old"

def chosen(requested: str) -> str | None:
    """The model a request re-times with: its own choice, else the service's default; None for none."""
    name = (requested or os.getenv("ASR_PHONEME_RETIME", "") or DEFAULT_RETIME).strip().lower()
    return name if name in MODELS else None


#: The stages the dev-only phoneme lab can hand to a phoneme model, as `align_recitation` names them.
LAB_STAGES = {"reading": "phoneme_reading", "timing": "phoneme_timing"}


def lab_stages(lab: str) -> dict[str, str]:
    """``reading=v31;timing=old`` as `align_recitation`'s arguments; anything not a stage and a model is left out."""
    stages: dict[str, str] = {}
    for part in (lab or "").split(";"):
        stage, _, name = part.partition("=")
        if stage.strip() in LAB_STAGES and (name.strip() in MODELS or (stage.strip() == "reading" and name.strip() in ("best", "mixed", "fastconformer"))):
            stages[LAB_STAGES[stage.strip()]] = name.strip()
    return stages


#: Fastconformer's own offset against the same timings. A word the phoneme
#: model gives no start of its own (see `chunk_sizes`) keeps fastconformer's,
#: moved by this so the two agree on where a word begins.
FASTCONFORMER_OFFSET = -0.195

#: Seconds per output frame: 10 ms fbank hop, subsampled four times.
FRAME_SEC = 0.04

#: How much recording the encoder reads at once, and how much each window
#: shares with the next. See `Loaded.emission`.
WINDOW_SEC = 20.0
OVERLAP_SEC = 4.0

#: The shortest a re-timed word may be, so its middle stays inside its caption.
MIN_WORD_SEC = 0.02

def place_starts(
    fallback: list[float],
    units: list[Unit],
    unit_starts: list[float | None],
    offset: float,
) -> list[float]:
    """Each word's start: its chunk's, where it begins one; otherwise the fallback, kept inside its chunk.

    ``fallback`` is fastconformer's start for every word, already moved by its
    offset; ``unit_starts`` the phoneme model's start for each unit, before
    ``offset`` is taken off.
    """
    starts = list(fallback)
    known = [None if at is None else at - offset for at in unit_starts]
    for u, unit in enumerate(units):
        following = next((at for at in known[u + 1:] if at is not None), None)
        _place_unit(starts, unit, known[u] if unit.starts_chunk else None, following)
    return starts


def _place_unit(starts: list[float], unit: Unit, own: float | None, following: float | None) -> None:
    """One unit's words: the first at the chunk's start if it has one, every one between it and the next."""
    low = -np.inf if own is None else own
    high = np.inf if following is None else following
    for k, word in enumerate(unit.words):
        at = own if (k == 0 and own is not None) else starts[word]
        starts[word] = float(min(max(at, low), high))


def place_spans(
    fallback: list[tuple[float, float]],
    units: list[Unit],
    unit_spans: list[tuple[float, float] | None],
    offset: float,
) -> list[tuple[float, float]]:
    """Each word's (start, end) from the phoneme model, before any caption exists.

    A unit's first word starts where the model hears the chunk begin (if the
    run begins the chunk) and its last word ends where the chunk ends. Words
    inside a chunk keep ``fallback`` -- fastconformer's span, already moved by
    its offset -- held inside the chunk. Then every word is kept in order: a
    start never before the previous start, an end never before its own start
    or after the next word's start.
    """
    spans = list(fallback)
    for unit, heard in zip(units, unit_spans):
        if heard is not None:
            _span_unit(spans, unit, heard[0] - offset, heard[1] - offset)
    return _in_order(spans)


def _span_unit(spans: list[tuple[float, float]], unit: Unit, low: float, high: float) -> None:
    """One unit's words between ``low`` and ``high``: its edges where the model heard them, the inside kept."""
    last = len(unit.words) - 1
    for k, word in enumerate(unit.words):
        start, end = (min(max(at, low), high) for at in spans[word])
        if k == 0 and unit.starts_chunk:
            start = low
        if k == last:
            end = high
        spans[word] = (start, end)


def _in_order(spans: list[tuple[float, float]]) -> list[tuple[float, float]]:
    out: list[tuple[float, float]] = []
    for i, (start, end) in enumerate(spans):
        start = max(start, out[-1][0] if out else start)
        following = spans[i + 1][0] if i + 1 < len(spans) else end
        end = max(start + MIN_WORD_SEC, min(end, max(following, start + MIN_WORD_SEC)))
        out.append((round(start, 3), round(end, 3)))
    return out


def fit_to_captions(
    starts: list[float],
    spans: list[tuple[float, float]],
    captions: list[tuple[float, float]],
) -> list[tuple[float, float]]:
    """New (start, end) for each word, inside the caption it was in before.

    The studio files a word under the caption its middle falls in, so a word
    moved past its caption's edge would vanish from it. A word that was in no
    caption keeps its old span. Within a caption starts never go backwards.

    The end is kept, and the start held where the word's middle stays inside
    its old span -- so it is filed with the same caption under any cut made
    from that alignment, including a Fewer / More re-cut, which uses the old
    spans and never sees these.
    """
    out: list[tuple[float, float]] = []
    last_start: dict[int, float] = {}
    for start, (old_start, old_end) in zip(starts, spans):
        middle = (old_start + old_end) / 2
        caption = next((c for c, (a, b) in enumerate(captions) if a <= middle <= b), None)
        if caption is None:
            out.append((old_start, old_end))
            continue
        low, high = captions[caption]
        low = max(low, 2 * old_start - old_end)  # its middle no earlier than its old start
        high = min(high, old_end)  # nor at or past its old end
        start = min(max(start, low, last_start.get(caption, low)), max(low, high - MIN_WORD_SEC))
        end = old_end
        last_start[caption] = start
        out.append((round(start, 3), round(end, 3)))
    return out


# ---------------------------------------------------------------------------
# The model
# ---------------------------------------------------------------------------


#: Larger than any file these models read besides their weights (the phoneme table is 5 MB).
MAX_SIDE_FILE_BYTES = 32 * 1024 * 1024


def _fetch(spec: PhonemeModel, name: str) -> str:
    """One of the model's files, from the Hub cache, downloaded first if it is not there yet."""
    from huggingface_hub import hf_hub_download

    return hf_hub_download(repo_id=spec.repo, filename=name, revision=spec.revision)


#: The small files read beside the weights: the symbol table, and every ayah written as phonemes.
SIDE_FILES = ("tokens.txt", "ordered_quran_phonemes.json")


def side_file_dir(model: str) -> Path:
    """Where a model's side files are kept: in this service's own (gitignored) `.cache`."""
    # asr-service/app/phoneme.py -> asr-service/.cache/phoneme/<model>
    return Path(__file__).resolve().parents[1] / ".cache" / "phoneme" / model


def _read_side_file(model: str, name: str) -> str:
    """One of `SIDE_FILES` of one of `MODELS`, read once checked to be one: a regular file, of a sane size.

    Downloaded beside this service rather than read out of the Hub cache, whose
    location is whatever the environment says.
    """
    from huggingface_hub import hf_hub_download

    if model not in MODELS or name not in SIDE_FILES:
        raise ValueError(f"{model!r} {name!r} is not one of the phoneme models' side files.")
    spec = MODELS[model]
    hf_hub_download(repo_id=spec.repo, filename=name, revision=spec.revision, local_dir=side_file_dir(model))
    path = side_file_dir(model) / name
    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_SIDE_FILE_BYTES:
        raise RuntimeError(f"{path} is not a phoneme model's side file.")
    return path.read_text(encoding="utf-8")


class Loaded:
    def __init__(self, model: str):
        import onnxruntime as ort

        spec = MODELS[model]
        self.session = ort.InferenceSession(_fetch(spec, spec.onnx), providers=["CPUExecutionProvider"])
        meta = self.session.get_modelmeta().custom_metadata_map
        self.window = int(meta["T"])
        self.shift = int(meta["decode_chunk_len"])
        lines = _read_side_file(model, "tokens.txt").splitlines()
        self.tokens = {symbol: int(index) for symbol, index in (line.rsplit(" ", 1) for line in lines)}
        self.blank = self.tokens["<blank>"]
        self.table = json.loads(_read_side_file(model, "ordered_quran_phonemes.json"))

    def emission(self, pcm: np.ndarray) -> torch.Tensor:
        """Log-probabilities per 40 ms frame, over the whole recording, read a window at a time.

        Streamed through one recording from start to finish, the encoder goes
        deaf in stretches: in test5 it emitted nothing over 34.8-38.6s, where
        the same audio read on its own window says عَلَىٰ مَن يَشَآءُ plainly --
        the second reading of a restart, exactly what `phoneme_reading` is
        for. So each `WINDOW_SEC` is read fresh, overlapping its neighbours by
        `OVERLAP_SEC`, and each frame is taken from the window that saw it with
        the most context either side.
        """
        import torch

        hop = WINDOW_SEC - OVERLAP_SEC
        total = int(np.ceil(len(pcm) / SAMPLE_RATE / FRAME_SEC))
        pieces = []
        start = 0.0
        while True:
            end = start + WINDOW_SEC
            frames = self._stream(pcm[int(start * SAMPLE_RATE):int(end * SAMPLE_RATE)])
            last = end * SAMPLE_RATE >= len(pcm)
            keep_from = 0 if start == 0 else int(round(OVERLAP_SEC / 2 / FRAME_SEC))
            keep_to = len(frames) if last else int(round((WINDOW_SEC - OVERLAP_SEC / 2) / FRAME_SEC))
            pieces.append(frames[keep_from:keep_to])
            if last:
                break
            start += hop
        return torch.from_numpy(np.concatenate(pieces)[:total])[None].float()

    def _stream(self, pcm: np.ndarray) -> np.ndarray:
        """One window's log-probabilities, streamed through the cache-aware encoder from a fresh state."""
        import torch
        import torchaudio.compliance.kaldi as kaldi

        # Unscaled [-1, 1] samples: scaled to int16 range the model reads 80% of phonemes wrong.
        wave = torch.from_numpy(np.concatenate([pcm, np.zeros(SAMPLE_RATE // 2, np.float32)]).astype(np.float32))[None]
        feats = kaldi.fbank(
            wave, num_mel_bins=80, dither=0.0, snip_edges=False, sample_frequency=SAMPLE_RATE,
            window_type="povey", high_freq=-400, energy_floor=0.0,
        ).numpy()
        states = {
            inp.name: np.zeros([d if isinstance(d, int) else 1 for d in inp.shape], np.int64 if "int64" in inp.type else np.float32)
            for inp in self.session.get_inputs()
            if inp.name != "x"
        }
        outputs = [o.name for o in self.session.get_outputs()]
        frames = []
        for start in range(0, feats.shape[0], self.shift):
            chunk = feats[start:start + self.window]
            if chunk.shape[0] < self.window:
                chunk = np.pad(chunk, ((0, self.window - chunk.shape[0]), (0, 0)), constant_values=np.log(1e-10))
            result = self.session.run(None, {**states, "x": chunk[None].astype(np.float32)})
            frames.append(result[0][0])
            states.update({name.removeprefix("new_"): value for name, value in zip(outputs[1:], result[1:])})
        return np.concatenate(frames)


_loaded: dict[str, Loaded] = {}
_lock = threading.Lock()


def load(name: str) -> Loaded:
    with _lock:
        if name not in _loaded:
            log.info("loading phoneme model %s (%s)", name, MODELS[name].repo)
            _loaded[name] = Loaded(name)
        return _loaded[name]


def _unit_spans(emission, units: list[Unit], model: Loaded) -> list[tuple[float, float] | None]:
    """Where model ``model`` hears each unit, from its first symbol's first frame to its last symbol's last."""
    import torch
    import torchaudio.functional as AF

    targets: list[int] = []
    owner: list[int] = []
    for u, unit in enumerate(units):
        ids = tokenize(unit.phonemes, model.tokens)
        targets += ids
        owner += [u] * len(ids)
    path, _ = AF.forced_align(emission, torch.tensor([targets], dtype=torch.int32), blank=model.blank)
    frames: dict[int, list[int]] = {}  # unit -> the frames its symbols were emitted on
    position, previous = -1, model.blank
    for frame, token in enumerate(path[0].tolist()):
        position += token not in (model.blank, previous)
        if token != model.blank:
            frames.setdefault(owner[position], []).append(frame)
        previous = token
    return [(frames[u][0] * FRAME_SEC, (frames[u][-1] + 1) * FRAME_SEC) if u in frames else None for u in range(len(units))]


def _hear(name: str, pcm: np.ndarray, words: list[AlignedWord]) -> tuple[list[Unit], list[tuple[float, float] | None]] | None:
    """The words' phoneme units and where model ``name`` (one of `MODELS`) hears each, or None (logged) if it cannot."""
    try:
        model = load(name)
    except Exception as exc:  # noqa: BLE001 -- a gated repo not accepted, no network: never fail the match for it
        log.warning("phoneme re-timing (%s) skipped: the model could not be loaded (%s)", name, exc)
        return None
    units = units_for([(w.verse_key, w.word_index) for w in words], model.table)
    if not units:
        log.warning("phoneme re-timing (%s) skipped: the aligned words do not line up with its phoneme table", name)
        return None
    try:
        return units, _unit_spans(model.emission(pcm), units, model)
    except (RuntimeError, ValueError) as exc:  # too little audio for the text, or a unit it has no symbol for
        log.warning("phoneme re-timing (%s) skipped: %s", name, exc)
        return None


def retime_words(name: str, pcm: np.ndarray, words: list[AlignedWord]) -> bool:
    """Move every aligned word to where model ``name`` hears it, start and end, before the captions are cut.

    The other trial, beside `retime`: here the phoneme model's timing is what
    the caption breaks are decided from. Changes ``words`` in place; returns
    False, leaving them as they were, when the model cannot read the passage.
    """
    found = _hear(name, pcm, words) if name in MODELS else None
    if found is None:
        return False
    units, heard = found
    shifted = [(w.start - FASTCONFORMER_OFFSET, w.end - FASTCONFORMER_OFFSET) for w in words]
    _move(words, place_spans(shifted, units, heard, MODELS[name].offset))
    log.info("phoneme timing (%s) for the captions: %d words in %d chunks", name, len(words), len(units))
    return True


def retime(requested: str, pcm: np.ndarray, words: list[AlignedWord], segments: list[Segment]) -> str | None:
    """Move each aligned word's start to where the `chosen` model hears it. Changes ``words`` in place.

    Returns the model's name, or None -- leaving every word as it was -- when
    none was chosen, it could not be loaded, or it cannot read the passage.
    """
    name = chosen(requested)
    found = None if name is None else _hear(name, pcm, words)
    if name is None or found is None:
        return None
    units, heard = found
    heard_starts = [at[0] if at else None for at in heard]
    starts = place_starts([w.start - FASTCONFORMER_OFFSET for w in words], units, heard_starts, MODELS[name].offset)
    moved = _move(words, fit_to_captions(starts, [(w.start, w.end) for w in words], [(s.start, s.end) for s in segments]))
    log.info("phoneme re-timing (%s): %d words in %d chunks, median move %.0f ms", name, len(words), len(units), moved * 1000)
    return name


def _move(words: list[AlignedWord], spans: list[tuple[float, float]]) -> float:
    """Give each word its new span; the median distance a start moved, in seconds."""
    moved = [abs(start - word.start) for word, (start, _) in zip(words, spans)]
    for word, (start, end) in zip(words, spans):
        word.start, word.end = start, end
    return float(np.median(moved)) if moved else 0.0
