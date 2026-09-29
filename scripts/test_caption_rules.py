"""Fast checks on where captions break and what a resumed phrase is taken to repeat.

Separate from `test_alignment_rules.py`, which is at the 500 lines Skylos
accepts in one file. Pure text and timing arithmetic: no audio, no model.

Run from the repo root:
    asr-service/.venv/bin/python scripts/test_caption_rules.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "asr-service"))

from app import align, corpus  # noqa: E402

FAILED: list[str] = []


def check(name: str, *, ok: bool, detail: str = "") -> None:
    print(f"  {'PASS' if ok else 'FAIL'}  {name}")
    if not ok:
        if detail:
            print(f"        {detail}")
        FAILED.append(name)


def word(key: str, index: int, text: str, start: float, end: float) -> align.AlignedWord:
    return align.AlignedWord(text=text, verse_key=key, word_index=index, start=start, end=end, score=1.0)


def ranges(segments: list[align.Segment]) -> list[tuple[str, int, int]]:
    return [(s.verse_key, s.start_word + 1, s.end_word + 1) for s in segments]


# At-Tahrim 66:12 words 9-13 as test_this.mp3 has them: 0.74s of quiet before
# وَصَدَّقَتْ and 0.40s after it, both over the bar for an unmarked stop.
print("\na word alone on a caption -- goes with the side it was said with")
tahrim = [
    word("66:12", 8, "مِن", 0.95, 1.04),
    word("66:12", 9, "رُّوحِنَا", 1.35, 2.15),
    word("66:12", 10, "وَصَدَّقَتْ", 3.19, 4.15),
    word("66:12", 11, "بِكَلِمَـٰتِ", 4.31, 5.34),
    word("66:12", 12, "رَبِّهَا", 5.42, 6.06),
]
pauses = [(2.5, 3.24), (3.58, 3.78), (3.9, 4.3), (5.54, 5.72)]
segments, _ = align._segment_the_timeline(tahrim, [8, 9, 10, 11, 12], 6.1, pauses=pauses)
check(
    "وَصَدَّقَتْ joins the words after it, across the shorter stop",
    ok=ranges(segments) == [("66:12", 9, 10), ("66:12", 11, 13)],
    detail=f"got {ranges(segments)}",
)

# Al-Mu'minun 23:96 in test2.mp3: ٱلسَّيِّئَةَ ۚ said, then said again on its own.
muminun = [
    word("23:96", 3, "أَحْسَنُ", 0.0, 0.8),
    word("23:96", 4, "ٱلسَّيِّئَةَ ۚ", 0.9, 1.8),
    word("23:96", 4, "ٱلسَّيِّئَةَ ۚ", 2.6, 3.3),
    word("23:96", 5, "نَحْنُ", 4.0, 4.4),
    word("23:96", 6, "أَعْلَمُ", 4.5, 5.0),
]
segments, _ = align._segment_the_timeline(muminun, [3, 4, 4, 5, 6], 5.1, pauses=[(1.9, 2.5), (3.4, 3.9)])
check(
    "a word a restart said again on its own is left alone",
    ok=ranges(segments) == [("23:96", 4, 5), ("23:96", 5, 5), ("23:96", 6, 7)],
    detail=f"got {ranges(segments)}",
)

tur = [
    word("52:1", 0, "وَٱلطُّورِ", 0.2, 1.2),
    word("52:2", 0, "وَكِتَـٰبٍۢ", 2.0, 2.8),
    word("52:2", 1, "مَّسْطُورٍۢ", 2.9, 3.8),
]
segments, _ = align._segment_the_timeline(tur, [0, 1, 2], 4.0, pauses=[(1.3, 1.9)])
check(
    "an ayah one word long keeps its caption",
    ok=ranges(segments) == [("52:1", 1, 1), ("52:2", 1, 2)],
    detail=f"got {ranges(segments)}",
)

# Ghafir 40:23 is six words, and test5.mp3 recites it twice whole.
print("\na resumed ayah -- the whole of it is a candidate, past the word-or-two limit")
ghafir = corpus.words_for_range(40, 23, 24)
first_pass = list(range(0, 6)) + list(range(6, 9))
check(
    "the run back to the ayah's first word is offered",
    ok=align._ayah_said_again(first_pass, 5, ghafir) == [list(range(0, 6))],
    detail=f"got {align._ayah_said_again(first_pass, 5, ghafir)}",
)
check(
    "not when the ayah so far is within the ordinary limit",
    ok=align._ayah_said_again(first_pass, 2, ghafir) == [],
)
check(
    "nor when the first pass did not start at the ayah's first word",
    ok=align._ayah_said_again(list(range(2, 9)), 3, ghafir) == [],
)

# Ghafir 40:16 in test5.mp3: the first pass read its ٱلْيَوْمَ as `الْيَوُونَ`,
# then the reciter went back to لِّمَنِ and carried on to the ayah's end.
print("\na pass the reciter went back over -- carried to the word it garbled")
ghafir16 = corpus.words_for_range(40, 16, 16)
passes = [(9, 10, 0.8, 56.26, 61.23), (9, 14, 1.0, 61.23, 68.93)]
read_outs = ["لِمَنِ الْمُلْكُ الْيَوُونَ", "لِمَنِ الْمُلْكُ الْيَوْمَ لِلَّهِ الْوَاحِدِ الْقَهَّارِ"]
finished = align._finish_before_restart(passes, read_outs, ghafir16)
check("the first pass ends on ٱلْيَوْمَ", ok=finished[0][:2] == (9, 11), detail=f"got {finished}")
onward = [(9, 10, 0.8, 56.26, 61.23), (11, 14, 1.0, 61.23, 68.93)]
check(
    "not when the next pass goes on rather than back",
    ok=align._finish_before_restart(onward, read_outs, ghafir16)[0][:2] == (9, 10),
)
other = ["لِمَنِ الْمُلْكُ سَبَّحَ", read_outs[1]]
check(
    "nor when the extra read-out spells nothing like the next word",
    ok=align._finish_before_restart(passes, other, ghafir16)[0][:2] == (9, 10),
)

print(f"\n{'FAILED: ' + ', '.join(FAILED) if FAILED else 'all checks passed'}")
sys.exit(1 if FAILED else 0)
