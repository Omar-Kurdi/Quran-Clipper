"""Score the alignment pipeline against known-good segmentation.

Ground truth lives in `scripts/expected_segments.txt` as plain text; this
resolves each line to a (verse_key, start_word, end_word) range by skeleton
matching, so hand-typed simplified orthography scores the same as Uthmani.

Run from the repo root:
    asr-service/.venv/bin/python scripts/eval_segments.py ~/Music/test.mp3 33 21 23
"""
from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import sys
import urllib.request

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "asr-service"))
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO").upper(), format="%(levelname)s %(message)s")

from app import align  # noqa: E402
from app.audio import SAMPLE_RATE  # noqa: E402

EXPECTED_PATH = os.path.join(os.path.dirname(__file__), "expected_segments.txt")


def match_skeleton(word: str) -> str:
    """Looser than the alignment vocab form: also folds ta-marbuta and drops
    trailing weak letters, so يَرْجُو and يَرْجُوا۟ compare equal."""
    base = align.normalize_for_vocab(word).replace("ة", "ه")
    return re.sub(r"[اويه]+$", "", base) or base


def fetch_words(surah: int, start: int, end: int) -> list[tuple[str, int, str]]:
    url = (
        f"https://api.quran.com/api/v4/verses/by_chapter/{surah}"
        "?language=en&words=true&fields=text_uthmani&word_fields=text_uthmani&per_page=300"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
    verses = json.load(urllib.request.urlopen(req))["verses"]
    out: list[tuple[str, int, str]] = []
    for verse in verses:
        if not start <= verse["verse_number"] <= end:
            continue
        index = 0
        for word in verse["words"]:
            if word.get("char_type_name") != "word":
                continue
            out.append((verse["verse_key"], index, word["text_uthmani"]))
            index += 1
    return out


def resolve_expected(ref_words: list[tuple[str, int, str]]) -> list[tuple[str, int, int, str]]:
    """Map each expected line onto the corpus as (verse_key, start_word, end_word)."""
    corpus = [match_skeleton(w[2]) for w in ref_words]
    resolved: list[tuple[str, int, int, str]] = []

    with open(EXPECTED_PATH, encoding="utf-8") as handle:
        lines = [ln.strip() for ln in handle if ln.strip() and not ln.strip().startswith("#")]

    for line in lines:
        wanted = [match_skeleton(t) for t in line.split()]
        wanted = [w for w in wanted if w]
        best, best_score = None, -1.0
        for start in range(len(corpus) - len(wanted) + 1):
            window = corpus[start : start + len(wanted)]
            score = sum(1 for a, b in zip(wanted, window) if a == b) / len(wanted)
            if score > best_score:
                best, best_score = start, score
        if best is None or best_score < 0.6:
            raise SystemExit(f"Could not resolve expected segment to the corpus: {line!r}")
        verse_key = ref_words[best][0]
        resolved.append((verse_key, ref_words[best][1] + 1, ref_words[best + len(wanted) - 1][1] + 1, line))
    return resolved


def score(predicted: list[tuple[str, int, int]], expected: list[tuple[str, int, int, str]]) -> float:
    """Exact (verse, start_word, end_word) matches, order-independent, no double-counting."""
    remaining = list(predicted)
    hits = 0
    print(f"\n{'#':>3}  {'expected':<18} {'matched?':<10} text")
    print("-" * 78)
    for i, (verse_key, start, end, text) in enumerate(expected, 1):
        key = (verse_key, start, end)
        if key in remaining:
            remaining.remove(key)
            hits += 1
            mark = "YES"
        else:
            mark = "no"
        print(f"{i:>3}  {verse_key+':'+str(start)+'-'+str(end):<18} {mark:<10} {text[:44]}")

    if remaining:
        print(f"\n{len(remaining)} predicted segment(s) with no expected counterpart:")
        for verse_key, start, end in remaining:
            print(f"     {verse_key}:{start}-{end}")

    print(f"\nSCORE: {hits}/{len(expected)} exact word-range matches "
          f"({len(predicted)} predicted vs {len(expected)} expected)")
    return hits / len(expected)


def main() -> None:
    audio_path = sys.argv[1]
    surah, start, end = (int(x) for x in sys.argv[2:5])

    ref_words = fetch_words(surah, start, end)
    expected = resolve_expected(ref_words)
    print(f"reference: {len(ref_words)} words; ground truth: {len(expected)} segments")

    raw = subprocess.run(
        ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-i", audio_path,
         "-f", "s16le", "-ac", "1", "-ar", str(SAMPLE_RATE), "pipe:1"],
        stdout=subprocess.PIPE, check=True).stdout
    pcm = np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0

    result = align.align_recitation(pcm, ref_words)
    predicted = [(s.verse_key, s.start_word + 1, s.end_word + 1) for s in result.segments]

    print("\npredicted segments:")
    for i, s in enumerate(result.segments, 1):
        flag = "  (restart)" if s.is_restart else ""
        print(f"{i:>3}  {s.verse_key}:{s.start_word+1}-{s.end_word+1}  {s.start:6.2f}-{s.end:6.2f}{flag}")

    score(predicted, expected)


if __name__ == "__main__":
    main()
