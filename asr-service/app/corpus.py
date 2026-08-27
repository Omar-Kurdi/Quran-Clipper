"""The full Quran text, for discovering *which* passage was recited.

Only needed by range auto-detection. When the caller already knows the ayah
range, `/align` never touches this module.

The whole Uthmani text arrives in a single request (~1.6 MB, 6236 verses,
~82k words) and is cached on disk, so this costs one download ever rather than
114 per-chapter fetches.
"""

from __future__ import annotations

import json
import logging
import os
import re
import urllib.request
from functools import lru_cache

log = logging.getLogger(__name__)

BULK_URL = "https://api.quran.com/api/v4/quran/verses/uthmani"

#: api.quran.com returns 403 to requests without a User-Agent.
_HEADERS = {"User-Agent": "QuranClipCreator/1.0", "Accept": "application/json"}


def cache_path() -> str:
    override = os.getenv("QURAN_CACHE_PATH")
    if override:
        return override
    base = os.getenv("XDG_CACHE_HOME") or os.path.expanduser("~/.cache")
    return os.path.join(base, "quran-clip-creator", "uthmani.json")


def _download() -> list[dict]:
    request = urllib.request.Request(BULK_URL, headers=_HEADERS)
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = json.load(response)
    verses = payload.get("verses") or []
    if len(verses) < 6000:
        raise RuntimeError(f"Quran text download looks truncated ({len(verses)} verses).")
    return verses


@lru_cache(maxsize=1)
def load_verses() -> list[dict]:
    """All 6236 verses as ``{verse_key, text_uthmani}``, disk-cached."""
    path = cache_path()
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as handle:
                verses = json.load(handle)
            if len(verses) >= 6000:
                return verses
            log.warning("cached Quran text at %s looks truncated -- refetching", path)
        except Exception:
            log.warning("could not read cached Quran text at %s -- refetching", path, exc_info=True)

    log.info("downloading the full Quran text (one-time, ~1.6 MB)")
    verses = [{"verse_key": v["verse_key"], "text_uthmani": v["text_uthmani"]} for v in _download()]

    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(verses, handle, ensure_ascii=False)
        log.info("cached Quran text to %s", path)
    except Exception:
        log.warning("could not write the Quran cache to %s (will refetch next start)", path, exc_info=True)

    return verses


_LETTERS = re.compile(r"[ء-ي]")


def split_verse_words(text: str) -> list[str]:
    """Split a verse into recited words.

    Uthmani script writes waqf and sajda marks as free-standing tokens. They
    are notation, not words: nobody recites them and no audio frame can match
    them. Left as separate entries they would shift every following word index
    out of step with the app's own word list, so they are glued onto the
    preceding word instead.
    """
    words: list[str] = []
    for token in text.split():
        if _LETTERS.search(token) or not words:
            words.append(token)
        else:
            words[-1] = f"{words[-1]} {token}"
    return words


@lru_cache(maxsize=1)
def load_words() -> list[tuple[str, int, str]]:
    """Every Quran word as ``(verse_key, word_index, uthmani)``, in order."""
    words: list[tuple[str, int, str]] = []
    for verse in load_verses():
        for index, word in enumerate(split_verse_words(verse["text_uthmani"])):
            words.append((verse["verse_key"], index, word))
    return words


def words_for_range(surah: int, start_ayah: int, end_ayah: int) -> list[tuple[str, int, str]]:
    """Reference words for one ayah range, in the shape the aligner expects."""
    return [
        word
        for word in load_words()
        if word[0].split(":")[0] == str(surah) and start_ayah <= int(word[0].split(":")[1]) <= end_ayah
    ]


# ---------------------------------------------------------------------------
# Skeleton index, for locating decoded text in the corpus
# ---------------------------------------------------------------------------

_DIACRITICS = re.compile(r"[ً-ٰۖ-ۭـ]")


def skeleton(word: str) -> str:
    """Orthography-insensitive comparison form.

    Collapses everything ASR output and Uthmani script disagree about: harakat,
    hamza seats, alef wasla, ta-marbuta, the word-final long vowels that differ
    between waqf and wasl pronunciation, and alef itself -- Uthmani spells a
    pronounced long ā as a superscript alef wherever the rasm drops the letter
    (ٱلظّـٰلِمِينَ), which is stripped as a diacritic above, while a decoder
    writes it out (الظالمين). Dropping the letter on both sides is what makes
    those agree; see `align._skeleton`, which mirrors this.
    """
    text = _DIACRITICS.sub("", word)
    text = re.sub(r"[آأإٱ]", "ا", text)
    text = text.replace("ى", "ي").replace("ة", "ه")
    text = re.sub(r"[^ء-ي]", "", text)
    text = text.replace("ا", "") or text
    return re.sub(r"[اويه]+$", "", text) or text


NGRAM = 3


@lru_cache(maxsize=1)
def ngram_index() -> dict[tuple[str, ...], list[int]]:
    """Skeleton trigram -> corpus positions where it starts.

    Turns "where in the Quran is this phrase?" from an 82,000-position scan
    into a handful of candidate lookups.
    """
    skeletons = [skeleton(word[2]) for word in load_words()]
    index: dict[tuple[str, ...], list[int]] = {}
    for i in range(len(skeletons) - NGRAM + 1):
        key = tuple(skeletons[i : i + NGRAM])
        index.setdefault(key, []).append(i)
    log.info("built Quran trigram index: %d entries over %d words", len(index), len(skeletons))
    return index


@lru_cache(maxsize=1)
def corpus_skeletons() -> list[str]:
    return [skeleton(word[2]) for word in load_words()]
