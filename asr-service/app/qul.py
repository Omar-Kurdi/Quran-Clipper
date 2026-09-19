"""What QUL knows about the Quran's text, for finding *which* passage was recited.

Opt-in, and only through `detect`. The studio's "Local + QUL" option sends
``assist=qul`` with an upload; without it nothing here is loaded and range
detection behaves exactly as it always has. That is deliberate -- the point of
the option is to compare the two on the same recording.

Two datasets from the Quranic Universal Library (qul.tarteel.ai), converted by
``scripts/qul-import.mjs`` into ``data/qul/``:

- **morphology.json** -- the root, lemma and stem of every word. Used to match
  a decoded word to the text by its root when the surface forms differ: the
  decoder hears يعلمون where the text has تعلمون, and the skeletons disagree
  on the first letter while the root, علم, does not.
- **mutashabihat.json** -- the phrases the Quran repeats, and everywhere each
  occurs. Used for the question the audio cannot answer: a phrase that occurs
  in seventy places sounds the same in all seventy, so every occurrence has to
  be a candidate, and a match that falls entirely inside one is no evidence of
  where the recitation is.

Word numbers in both files are QUL's: one-based over quran.com's words, which
is the same list `corpus.split_verse_words` produces zero-based.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from . import corpus

log = logging.getLogger(__name__)

#: Trigrams to index over. The same length as the surface index in `corpus`.
NGRAM = corpus.NGRAM


#: The exports are a few megabytes; anything far larger is not one of them.
MAX_EXPORT_BYTES = 64 * 1024 * 1024

#: The two files read, by name. Nothing else under the directory is opened.
EXPORTS = ("morphology.json", "mutashabihat.json")


def data_dir() -> Path:
    # asr-service/app/qul.py -> the repository root -> data/qul
    return Path(__file__).resolve().parents[2] / "data" / "qul"


def _read(name: str) -> dict | None:
    if name not in EXPORTS:
        return None
    path = data_dir() / name
    try:
        if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_EXPORT_BYTES:
            return None
        parsed = json.loads(path.read_text(encoding="utf-8"))
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        log.warning("could not read %s", path, exc_info=True)
        return None


def available() -> bool:
    """Whether both exports are on this machine."""
    return all((data_dir() / name).is_file() for name in EXPORTS)


@dataclass
class Assist:
    """Everything `detect` consults, indexed by corpus position."""

    #: Per corpus position, the word's root where it has one, else its stem,
    #: else its own skeleton -- so particles and pronouns still take part.
    morph_keys: list[str]
    #: Morph-key trigram -> corpus positions where it starts.
    morph_index: dict[tuple[str, ...], list[int]]
    #: Surface skeleton -> the morph key most often behind it in the corpus.
    lexicon: dict[str, str]
    #: Corpus position -> the repeated phrases whose occurrence covers it,
    #: as (phrase id, first position, last position) of that occurrence.
    covering: dict[int, list[tuple[str, int, int]]] = field(default_factory=dict)
    #: Phrase id -> (start, end) corpus positions of every occurrence.
    occurrences: dict[str, list[tuple[int, int]]] = field(default_factory=dict)

    def morph_key(self, token_skeleton: str) -> str:
        return self.lexicon.get(token_skeleton, token_skeleton)

    def twins(self, start: int, end: int) -> list[int]:
        """Start positions elsewhere that carry the same words as ``start..end``.

        For every repeated phrase covering the span's first word, the span is
        shifted onto each other occurrence by the same offset. Only a span that
        stays inside the occurrence is moved: a span running past the phrase is
        about more than the phrase, and its twin is not the same text.
        """
        length = end - start
        found = {
            other_start + start - occurrence_start
            for phrase, occurrence_start, _ in self.covering.get(start, ())
            for other_start, other_end in self.occurrences.get(phrase, ())
            if other_start != occurrence_start and other_start + start - occurrence_start + length <= other_end
        }
        # Phrases nest -- "min duni llah" sits inside longer repeats of itself --
        # so one twin can be reached through several of them.
        found.discard(start)
        return sorted(found)

    def is_repeated(self, start: int, end: int) -> bool:
        """Whether ``start..end`` lies wholly inside one occurrence of a repeated phrase."""
        return any(end <= occurrence_end for _, _, occurrence_end in self.covering.get(start, ()))


def _positions() -> dict[str, int]:
    """``"s:a:w"`` (QUL's one-based word) -> corpus position."""
    return {f"{key}:{index + 1}": position for position, (key, index, _) in enumerate(corpus.load_words())}


def _morph_keys(morphology: dict, positions: dict[str, int]) -> list[str]:
    keys = list(corpus.corpus_skeletons())
    word = morphology.get("word") or {}
    # Stems first, then roots over them: a root is the stronger claim. The text
    # as written, not through `corpus.skeleton`: that drops a final weak
    # letter, which would fold ثوي and ثوب into one root.
    found = [
        (positions.get(location), kind[0], "".join(str(value).split()))
        for kind in ("stems", "roots")
        for location, value in (word.get(kind) or {}).items()
    ]
    for position, kind, text in found:
        if position is not None and text:
            keys[position] = f"{kind}:{text}"
    return keys


def _span(place: dict, positions: dict[str, int]) -> tuple[int, int] | None:
    """One occurrence as corpus positions, or None when it names words the corpus lacks."""
    start = positions.get(f"{place.get('verseKey')}:{place.get('from')}")
    end = positions.get(f"{place.get('verseKey')}:{place.get('to')}")
    return (start, end) if start is not None and end is not None and end >= start else None


def _occurrences(mutashabihat: dict, positions: dict[str, int]) -> dict[str, list[tuple[int, int]]]:
    """Phrase id -> its occurrences as corpus positions, for phrases found at least twice."""
    located = {
        phrase: [span for span in (_span(place, positions) for place in places or []) if span]
        for phrase, places in (mutashabihat.get("phrases") or {}).items()
    }
    return {phrase: spans for phrase, spans in located.items() if len(spans) >= 2}


def _covering(occurrences: dict[str, list[tuple[int, int]]]) -> dict[int, list[tuple[str, int, int]]]:
    """Corpus position -> every occurrence that covers it."""
    covering: dict[int, list[tuple[str, int, int]]] = {}
    entries = (
        (position, (phrase, start, end))
        for phrase, spans in occurrences.items()
        for start, end in spans
        for position in range(start, end + 1)
    )
    for position, entry in entries:
        covering.setdefault(position, []).append(entry)
    return covering


@lru_cache(maxsize=1)
def load() -> Assist | None:
    """The assist, or None when the exports are not here."""
    morphology = _read("morphology.json")
    mutashabihat = _read("mutashabihat.json")
    if morphology is None or mutashabihat is None:
        return None

    positions = _positions()
    morph_keys = _morph_keys(morphology, positions)

    morph_index: dict[tuple[str, ...], list[int]] = {}
    for i in range(len(morph_keys) - NGRAM + 1):
        morph_index.setdefault(tuple(morph_keys[i : i + NGRAM]), []).append(i)

    # Which morph key each surface form most often stands for. A decoded word
    # can only be looked up by its surface; this is how it reaches a root.
    tally: dict[str, dict[str, int]] = {}
    for surface, key in zip(corpus.corpus_skeletons(), morph_keys):
        counts = tally.setdefault(surface, {})
        counts[key] = counts.get(key, 0) + 1
    lexicon = {surface: max(counts, key=counts.__getitem__) for surface, counts in tally.items()}

    occurrences = _occurrences(mutashabihat, positions)
    covering = _covering(occurrences)
    log.info(
        "QUL assist loaded: %d words with a root or stem, %d repeated phrases",
        sum(1 for key in morph_keys if key[:2] in ("r:", "s:")),
        len(occurrences),
    )
    return Assist(morph_keys, morph_index, lexicon, covering, occurrences)
