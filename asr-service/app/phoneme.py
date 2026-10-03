"""Re-timing aligned words with a phoneme-level Quran model -- a development trial.

The studio's aligner places words with `Muno459/fastconformer-quran`, a
character model. The zipformers below recognise phonemes instead, trained for
tajweed, and place word starts more tightly: measured 2026-10-03 on 267 ayahs of
67 and 78 (four reciters) against QUL's word timings, with one fixed offset per
model fitted on three reciters and tested on the fourth, fastconformer's median
error was 124 ms with 15.3% of words over 300 ms off, v3.1's 101 ms and 6.4%,
the older zipformer_p-quran's 111 ms and 4.7% (FutureIdeas #58).

Nothing about the captions changes here. Fastconformer still finds the passage
and cuts the captions; this only moves each word's start inside the caption it
already belongs to, which is what Highlight and Reveal draw. It is offered only
in a personal studio under `npm run dev`, so the two can be compared by ear.

Both models are gated on the Hub and released under Quran-Lab's no-profit
licence (NPL-1.2 for v3.1, NPL-1.1 for the older one) -- accept them on the Hub
and log in before the first use.

Heavy imports (onnxruntime, torch, huggingface_hub) stay inside functions, so
the pure parts can be tested with numpy alone.
"""

from __future__ import annotations

import itertools
import json
import logging
import re
import threading
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np

from .audio import SAMPLE_RATE

if TYPE_CHECKING:  # the types only; `retime` is handed what `align` made
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

#: Fastconformer's own offset against the same timings. A word the phoneme
#: model gives no start of its own (see `chunk_sizes`) keeps fastconformer's,
#: moved by this so the two agree on where a word begins.
FASTCONFORMER_OFFSET = -0.195

#: Seconds per output frame: 10 ms fbank hop, subsampled four times.
FRAME_SEC = 0.04

#: The shortest a re-timed word may be, so its middle stays inside its caption.
MIN_WORD_SEC = 0.02

_ARABIC_LETTER = re.compile(r"[ء-يٱ]")
_DIACRITICS = re.compile(r"[ؐ-ًؚ-ٰٟۖ-ۭـ]")


def recited_words(aya_text: str) -> list[str]:
    """The words of an ayah as the aligner indexes them: waqf marks are not words."""
    return [token for token in aya_text.split() if _ARABIC_LETTER.search(token)]


def _skeleton(text: str) -> str:
    text = _DIACRITICS.sub("", unicodedata.normalize("NFC", text))
    for a, b in (("أ", "ا"), ("إ", "ا"), ("آ", "ا"), ("ٱ", "ا"), ("ى", "ا"), ("ة", "ه"), ("ؤ", "و"), ("ئ", "ي"), ("ء", "")):
        text = text.replace(a, b)
    text = re.sub(r"(.)\1+", r"\1", text)  # phonemes lengthen a sound by repeating it
    return re.sub(r"[اوي]", "", text)  # and write long vowels their own way


def _distance(a: str, b: str) -> int:
    """Edit distance, a row at a time: insertions along a row are a running minimum."""
    target = np.array([ord(c) for c in b], dtype=np.int64)
    steps = np.arange(len(b) + 1)
    previous = steps.copy()
    for i, ca in enumerate(a, 1):
        kept_or_swapped = np.minimum(previous[1:] + 1, previous[:-1] + (target != ord(ca)))
        current = np.concatenate(([i], kept_or_swapped))
        previous = np.minimum.accumulate(current - steps) + steps
    return int(previous[-1])


#: The most words one phoneme chunk has been seen to join (67:30 joins five).
MAX_JOINED = 7

_UNREACHABLE = 10**9


@dataclass
class _Lineup:
    """The table `chunk_sizes` fills: the cheapest way to cover ``i`` words with ``j`` chunks, and its last step."""

    best: np.ndarray
    back: np.ndarray

    def extend(self, words: list[str], chunk: str, i: int, j: int) -> None:
        """Try chunk ``j`` as words ``i`` onwards, one to `MAX_JOINED` of them."""
        for k in range(1, min(MAX_JOINED, len(words) - i) + 1):
            cost = self.best[i, j] + _distance(_skeleton("".join(words[i:i + k])), chunk)
            if cost < self.best[i + k, j + 1]:
                self.best[i + k, j + 1] = cost
                self.back[i + k, j + 1] = k


def chunk_sizes(words: list[str], chunks: list[str]) -> list[int] | None:
    """How many words each phoneme chunk of an ayah covers, or None if they cannot be lined up.

    The phoneme table writes an ayah as recited, so words joined in recitation
    -- a tanween merging into the next word, say -- are one chunk with no
    boundary inside it. Those inner words get no start from the phoneme model.
    """
    n, m = len(words), len(chunks)
    table = _Lineup(np.full((n + 1, m + 1), _UNREACHABLE, dtype=np.int64), np.zeros((n + 1, m + 1), dtype=np.int64))
    table.best[0, 0] = 0
    skeletons = [_skeleton(chunk) for chunk in chunks]
    for i, j in itertools.product(range(n + 1), range(m)):
        if table.best[i, j] < _UNREACHABLE:
            table.extend(words, skeletons[j], i, j)
    if table.best[n, m] >= _UNREACHABLE:
        return None
    sizes, i = [], n
    for j in range(m, 0, -1):
        sizes.append(int(table.back[i, j]))
        i -= sizes[-1]
    return sizes[::-1]


def tokenize(phonemes: str, tokens: dict[str, int]) -> list[int]:
    """A phoneme string as the model's units, longest match first -- some units are runs of one sound."""
    longest = max(len(symbol) for symbol in tokens)
    out: list[int] = []
    i = 0
    while i < len(phonemes):
        if phonemes[i].isspace():
            i += 1
            continue
        for n in range(min(longest, len(phonemes) - i), 0, -1):
            piece = phonemes[i:i + n]
            if piece != "<blank>" and piece in tokens:
                out.append(tokens[piece])
                i += n
                break
        else:
            raise ValueError(f"no phoneme unit for {phonemes[i]!r}")
    return out


@dataclass
class Unit:
    """A run of aligned words the phoneme model reads as one chunk."""

    #: Indices into the aligned word list.
    words: list[int]
    phonemes: str
    #: Whether the run starts where its chunk does, so the chunk's start is its first word's.
    starts_chunk: bool


def _layout(entry: dict | None) -> list[tuple[int, int]] | None:
    """For each word of an ayah, its chunk and its place in that chunk; None if the ayah does not line up."""
    if entry is None:
        return None
    sizes = chunk_sizes(recited_words(entry["aya_text"]), entry["aya_phonemes_list"])
    if sizes is None:
        return None
    return [(chunk, place) for chunk, size in enumerate(sizes) for place in range(size)]


def units_for(words: list[tuple[str, int]], table: dict) -> list[Unit] | None:
    """The aligned words, in order, grouped into phoneme chunks; None if any ayah does not line up.

    ``words`` is each aligned word's (verse key, word index), repeats included,
    in recitation order. A run that starts inside a chunk -- a reciter going
    back to the middle of a joined pair -- still reads that whole chunk, since
    the table has no phonemes for part of one.
    """
    layout: dict[str, list[tuple[int, int]] | None] = {}
    units: list[Unit] = []
    previous: tuple[str, int, int] | None = None  # verse, word index, chunk
    for position, (verse_key, word_index) in enumerate(words):
        if verse_key not in layout:
            layout[verse_key] = _layout(table.get(verse_key))
        places = layout[verse_key]
        if places is None or not 0 <= word_index < len(places):
            return None
        chunk, place = places[word_index]
        if previous is not None and previous == (verse_key, word_index - 1, chunk):
            units[-1].words.append(position)
        else:
            units.append(Unit([position], table[verse_key]["aya_phonemes_list"][chunk], place == 0))
        previous = (verse_key, word_index, chunk)
    return units


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


def fit_to_captions(
    starts: list[float],
    spans: list[tuple[float, float]],
    captions: list[tuple[float, float]],
) -> list[tuple[float, float]]:
    """New (start, end) for each word, inside the caption it was in before.

    The studio files a word under the caption its middle falls in, so a word
    moved past its caption's edge would vanish from it. A word that was in no
    caption keeps its old span. Within a caption starts never go backwards.
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
        start = min(max(start, low, last_start.get(caption, low)), max(low, high - MIN_WORD_SEC))
        end = min(high, max(old_end, start + MIN_WORD_SEC))
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


class _Loaded:
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

    def emission(self, pcm: np.ndarray):
        """Log-probabilities per 40 ms frame, streamed through the cache-aware encoder."""
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
        return torch.from_numpy(np.concatenate(frames))[None].float()


_loaded: dict[str, _Loaded] = {}
_lock = threading.Lock()


def _model(name: str) -> _Loaded:
    with _lock:
        if name not in _loaded:
            log.info("loading phoneme model %s (%s)", name, MODELS[name].repo)
            _loaded[name] = _Loaded(name)
        return _loaded[name]


def _unit_starts(emission, units: list[Unit], model: _Loaded) -> list[float | None]:
    import torch
    import torchaudio.functional as AF

    targets: list[int] = []
    owner: list[int] = []
    for u, unit in enumerate(units):
        ids = tokenize(unit.phonemes, model.tokens)
        targets += ids
        owner += [u] * len(ids)
    path, _ = AF.forced_align(emission, torch.tensor([targets], dtype=torch.int32), blank=model.blank)
    starts: list[float | None] = [None] * len(units)
    position, previous = -1, model.blank
    for frame, token in enumerate(path[0].tolist()):
        if token != model.blank and token != previous:
            position += 1
            if position < len(owner) and starts[owner[position]] is None:
                starts[owner[position]] = frame * FRAME_SEC
        previous = token
    return starts


def _hear(name: str, pcm: np.ndarray, words: list[AlignedWord]) -> tuple[list[Unit], list[float | None]] | None:
    """The words' phoneme units and where model ``name`` hears each begin, or None (logged) if it cannot."""
    if name not in MODELS:
        log.warning("phoneme re-timing skipped: no model %r (have %s)", name, ", ".join(MODELS))
        return None
    model = _model(name)
    units = units_for([(w.verse_key, w.word_index) for w in words], model.table)
    if not units:
        log.warning("phoneme re-timing (%s) skipped: the aligned words do not line up with its phoneme table", name)
        return None
    try:
        return units, _unit_starts(model.emission(pcm), units, model)
    except (RuntimeError, ValueError) as exc:  # too little audio for the text, or a unit it has no symbol for
        log.warning("phoneme re-timing (%s) skipped: %s", name, exc)
        return None


def retime(name: str, pcm: np.ndarray, words: list[AlignedWord], segments: list[Segment]) -> bool:
    """Move each aligned word's start to where model ``name`` hears it. Changes ``words`` in place.

    Returns False, leaving every word as it was, when ``name`` is not one of
    `MODELS` or the passage cannot be read with its phoneme table.
    """
    found = _hear(name, pcm, words)
    if found is None:
        return False
    units, heard = found
    starts = place_starts([w.start - FASTCONFORMER_OFFSET for w in words], units, heard, MODELS[name].offset)
    spans = fit_to_captions(starts, [(w.start, w.end) for w in words], [(s.start, s.end) for s in segments])
    moved = [abs(new - w.start) for (new, _), w in zip(spans, words)]
    for word, (start, end) in zip(words, spans):
        word.start, word.end = start, end
    log.info(
        "phoneme re-timing (%s): %d words in %d chunks, median move %.0f ms",
        name, len(words), len(units), float(np.median(moved)) * 1000 if moved else 0.0,
    )
    return True
