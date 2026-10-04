"""Lining a phoneme model's Quran text up with the aligner's words.

The phoneme models come with every ayah already written as phonemes
(`ordered_quran_phonemes.json`), but written as recited: words joined in
recitation -- a tanween merging into the next word, say -- are one chunk with
no boundary inside. This works out which words each chunk covers, groups the
aligned words (repeats included) into the chunks the model will be asked to
place, and turns a chunk into the model's symbols. Plain Python and numpy, so
it is tested without a model; see `phoneme` for the model itself.
"""

from __future__ import annotations

import itertools
import re
import unicodedata
from dataclasses import dataclass

import numpy as np

from . import corpus

_DIACRITICS = re.compile(r"[ؐ-ًؚ-ٰٟۖ-ۭـ]")


def recited_words(aya_text: str) -> list[str]:
    """The words of an ayah as the aligner indexes them -- `corpus.split_verse_words`, a waqf mark kept on its word."""
    return corpus.split_verse_words(aya_text)


def _skeleton(text: str) -> str:
    text = _DIACRITICS.sub("", unicodedata.normalize("NFC", text)).replace(" ", "")
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
