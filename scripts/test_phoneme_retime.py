"""Fast checks on the phoneme re-timing trial (`asr-service/app/phoneme.py`).

Only the parts that need no model: lining the phoneme table's chunks up with
the aligned words, and keeping a moved word inside the caption it was in.

Run from the repo root:
    asr-service/.venv/bin/python scripts/test_phoneme_retime.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "asr-service"))

from app import phoneme  # noqa: E402

FAILED: list[str] = []


def check(name: str, *, ok: bool, detail: str = "") -> None:
    print(f"  {'PASS' if ok else 'FAIL'}  {name}")
    if not ok:
        if detail:
            print(f"        {detail}")
        FAILED.append(name)


# 67:12 and 67:30 as the phoneme table writes them.
TABLE = {
    "67:12": {
        "aya_text": "إِنَّ ٱلَّذِينَ يَخْشَوْنَ رَبَّهُم بِٱلْغَيْبِ لَهُم مَّغْفِرَةٌۭ وَأَجْرٌۭ كَبِيرٌۭ",
        "aya_phonemes_list": [
            "ءِننننَ", "للَذِۦۦنَ", "يَخشَونَ", "رَببَهُ۾۾۾بِلغَيبِ", "لَهُممممَغفِرَتُوووَءَجڇرُںںںكَبِۦۦۦۦر",
        ],
    },
    "67:30": {
        "aya_text": "قُلْ أَرَءَيْتُمْ إِنْ أَصْبَحَ مَآؤُكُمْ غَوْرًۭا فَمَن يَأْتِيكُم بِمَآءٍۢ مَّعِينٍۭ",
        "aya_phonemes_list": [
            "قُل", "ءَرَءَيتُم", "ءِن", "ءَصبَحَ", "مَااااءُكُم",
            "غَورَںںںفَمَيييَءتِۦۦكُ۾۾۾بِمَااااءِممممَعِۦۦۦۦن",
        ],
    },
}

print("\nchunks -- words joined in recitation share one")

for key, expected in (("67:12", [1, 1, 1, 2, 4]), ("67:30", [1, 1, 1, 1, 1, 5])):
    got = phoneme.chunk_sizes(phoneme.recited_words(TABLE[key]["aya_text"]), TABLE[key]["aya_phonemes_list"])
    # 67:30 joins five words into its last chunk; a cap of three once paired them wrongly.
    check(f"{key} lines up as {expected}", ok=got == expected, detail=f"got {got}")

check(
    "waqf marks are not words",
    ok=phoneme.recited_words("ذَٰلِكَ ٱلْكِتَـٰبُ لَا رَيْبَ ۛ فِيهِ ۛ") == ["ذَٰلِكَ", "ٱلْكِتَـٰبُ", "لَا", "رَيْبَ", "فِيهِ"],
)

print("\nunits -- the aligned words grouped by chunk")

words = [("67:12", i) for i in range(9)]
units = phoneme.units_for(words, TABLE)
check(
    "a whole ayah is one unit per chunk",
    ok=units is not None and [u.words for u in units] == [[0], [1], [2], [3, 4], [5, 6, 7, 8]],
    detail=f"got {None if units is None else [u.words for u in units]}",
)
# A reciter going back to the second word of a joined pair: that run starts
# inside its chunk, so the chunk's start is not its first word's.
restart = phoneme.units_for([("67:12", 3), ("67:12", 4), ("67:12", 4)], TABLE)
check(
    "a run that starts inside a chunk is not given the chunk's start",
    ok=restart is not None and [(u.words, u.starts_chunk) for u in restart] == [([0, 1], True), ([2], False)],
    detail=f"got {None if restart is None else [(u.words, u.starts_chunk) for u in restart]}",
)
check("an ayah the table does not have gives up", ok=phoneme.units_for([("2:1", 0)], TABLE) is None)
check("a word past the end of its ayah gives up", ok=phoneme.units_for([("67:12", 9)], TABLE) is None)

print("\nstarts -- the chunk's where it has one, kept in order otherwise")

units = [
    phoneme.Unit([0], "", True),
    phoneme.Unit([1, 2], "", True),
    phoneme.Unit([3], "", True),
]
starts = phoneme.place_starts([1.0, 2.0, 2.2, 3.0], units, [1.2, 1.9, 3.1], offset=0.1)
check(
    "a chunk's first word takes the chunk's start, less the offset",
    ok=[round(s, 3) for s in starts[:2]] == [1.1, 1.8] and round(starts[3], 3) == 3.0,
    detail=f"got {starts}",
)
check("an inner word keeps its own start inside its chunk", ok=round(starts[2], 3) == 2.2, detail=f"got {starts}")
pinned = phoneme.place_starts([1.0, 0.5, 9.0], [phoneme.Unit([0, 1, 2], "", True)], [1.0], offset=0.0)
check("and is never before its chunk began", ok=pinned[1] == 1.0, detail=f"got {pinned}")
capped = phoneme.place_starts([1.0, 9.0, 2.0], [phoneme.Unit([0, 1], "", True), phoneme.Unit([2], "", True)], [1.0, 2.0], offset=0.0)
check("nor after the next chunk begins", ok=capped[1] == 2.0, detail=f"got {capped}")
blind = phoneme.place_starts([1.0, 2.0], [phoneme.Unit([0], "", True), phoneme.Unit([1], "", False)], [1.0, 1.5], offset=0.0)
check("a run starting inside a chunk keeps the fallback", ok=blind[1] == 2.0, detail=f"got {blind}")

print("\ncaptions -- a moved word stays in the caption it was in")

spans = [(0.0, 0.5), (0.5, 1.0), (1.0, 1.9), (2.1, 2.5)]
captions = [(0.0, 2.0), (2.0, 3.0)]
fitted = phoneme.fit_to_captions([-0.3, 0.6, 2.4, 2.2], spans, captions)
check("a start before its caption is brought to the caption's start", ok=fitted[0][0] == 0.0, detail=f"got {fitted}")
check(
    "a start past its caption's end is kept just inside it",
    ok=fitted[2][0] == round(2.0 - phoneme.MIN_WORD_SEC, 3) and fitted[2][1] <= 2.0,
    detail=f"got {fitted}",
)
check(
    "every word's middle stays in its caption",
    ok=all(captions[c][0] <= (a + b) / 2 <= captions[c][1] for (a, b), c in zip(fitted, [0, 0, 0, 1])),
    detail=f"got {fitted}",
)
check("starts never go backwards within a caption", ok=all(fitted[i][0] <= fitted[i + 1][0] for i in range(2)), detail=f"got {fitted}")
loose = phoneme.fit_to_captions([5.0], [(4.0, 4.4)], captions)
check("a word in no caption keeps its old span", ok=loose == [(4.0, 4.4)], detail=f"got {loose}")

print(f"\n{'FAILED: ' + ', '.join(FAILED) if FAILED else 'all checks passed'}")
sys.exit(1 if FAILED else 0)
