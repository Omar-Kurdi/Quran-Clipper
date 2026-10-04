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

from app import phoneme, phoneme_reading, phoneme_table  # noqa: E402

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

print("\nchoice -- which model a match re-times with")

check("a match asks for nothing and gets the default", ok=phoneme.chosen("") == phoneme.DEFAULT_RETIME)
check("a named model is used", ok=phoneme.chosen("v31") == "v31")
check("none keeps fastconformer's times", ok=phoneme.chosen("none") is None)
check("an unknown name re-times nothing", ok=phoneme.chosen("bogus") is None)

print("\nchunks -- words joined in recitation share one")

for key, expected in (("67:12", [1, 1, 1, 2, 4]), ("67:30", [1, 1, 1, 1, 1, 5])):
    got = phoneme_table.chunk_sizes(phoneme_table.recited_words(TABLE[key]["aya_text"]), TABLE[key]["aya_phonemes_list"])
    # 67:30 joins five words into its last chunk; a cap of three once paired them wrongly.
    check(f"{key} lines up as {expected}", ok=got == expected, detail=f"got {got}")

check(
    "waqf marks are not words: each stays on its word, as the aligner numbers them",
    ok=phoneme_table.recited_words("ذَٰلِكَ ٱلْكِتَـٰبُ لَا رَيْبَ ۛ فِيهِ ۛ") == ["ذَٰلِكَ", "ٱلْكِتَـٰبُ", "لَا", "رَيْبَ ۛ", "فِيهِ ۛ"],
)

print("\nunits -- the aligned words grouped by chunk")

words = [("67:12", i) for i in range(9)]
units = phoneme_table.units_for(words, TABLE)
check(
    "a whole ayah is one unit per chunk",
    ok=units is not None and [u.words for u in units] == [[0], [1], [2], [3, 4], [5, 6, 7, 8]],
    detail=f"got {None if units is None else [u.words for u in units]}",
)
# A reciter going back to the second word of a joined pair: that run starts
# inside its chunk, so the chunk's start is not its first word's.
restart = phoneme_table.units_for([("67:12", 3), ("67:12", 4), ("67:12", 4)], TABLE)
check(
    "a run that starts inside a chunk is not given the chunk's start",
    ok=restart is not None and [(u.words, u.starts_chunk) for u in restart] == [([0, 1], True), ([2], False)],
    detail=f"got {None if restart is None else [(u.words, u.starts_chunk) for u in restart]}",
)
check("an ayah the table does not have gives up", ok=phoneme_table.units_for([("2:1", 0)], TABLE) is None)
check("a word past the end of its ayah gives up", ok=phoneme_table.units_for([("67:12", 9)], TABLE) is None)

print("\nstarts -- the chunk's where it has one, kept in order otherwise")

units = [
    phoneme_table.Unit([0], "", True),
    phoneme_table.Unit([1, 2], "", True),
    phoneme_table.Unit([3], "", True),
]
starts = phoneme.place_starts([1.0, 2.0, 2.2, 3.0], units, [1.2, 1.9, 3.1], offset=0.1)
check(
    "a chunk's first word takes the chunk's start, less the offset",
    ok=[round(s, 3) for s in starts[:2]] == [1.1, 1.8] and round(starts[3], 3) == 3.0,
    detail=f"got {starts}",
)
check("an inner word keeps its own start inside its chunk", ok=round(starts[2], 3) == 2.2, detail=f"got {starts}")
pinned = phoneme.place_starts([1.0, 0.5, 9.0], [phoneme_table.Unit([0, 1, 2], "", True)], [1.0], offset=0.0)
check("and is never before its chunk began", ok=pinned[1] == 1.0, detail=f"got {pinned}")
capped = phoneme.place_starts([1.0, 9.0, 2.0], [phoneme_table.Unit([0, 1], "", True), phoneme_table.Unit([2], "", True)], [1.0, 2.0], offset=0.0)
check("nor after the next chunk begins", ok=capped[1] == 2.0, detail=f"got {capped}")
blind = phoneme.place_starts([1.0, 2.0], [phoneme_table.Unit([0], "", True), phoneme_table.Unit([1], "", False)], [1.0, 1.5], offset=0.0)
check("a run starting inside a chunk keeps the fallback", ok=blind[1] == 2.0, detail=f"got {blind}")

print("\nspans -- the phoneme model's timing before any caption exists")

units = [phoneme_table.Unit([0], "", True), phoneme_table.Unit([1, 2], "", True)]
spans = phoneme.place_spans([(1.0, 1.5), (2.0, 2.4), (2.5, 3.0)], units, [(1.1, 1.6), (2.2, 3.2)], offset=0.1)
check("a chunk's edges are where the model heard them, less the offset", ok=spans[0] == (1.0, 1.5) and spans[1][0] == 2.1 and spans[2][1] == 3.1, detail=f"got {spans}")
check("a word inside a chunk keeps its own boundary there", ok=spans[1][1] == 2.4 and spans[2][0] == 2.5, detail=f"got {spans}")
unheard = phoneme.place_spans([(1.0, 1.5), (2.0, 2.5)], [phoneme_table.Unit([0], "", True), phoneme_table.Unit([1], "", True)], [None, (2.0, 2.5)], offset=0.0)
check("a unit the model did not place keeps the fallback", ok=unheard[0] == (1.0, 1.5), detail=f"got {unheard}")
crossed = phoneme.place_spans([(1.0, 1.5), (2.0, 2.5)], [phoneme_table.Unit([0], "", True), phoneme_table.Unit([1], "", True)], [(1.0, 2.3), (2.1, 2.5)], offset=0.0)
check("no word runs past the start of the next", ok=crossed[0][1] <= crossed[1][0], detail=f"got {crossed}")
check("and every word lasts", ok=all(b - a >= phoneme.MIN_WORD_SEC - 1e-9 for a, b in crossed), detail=f"got {crossed}")

print("\ncaptions -- a moved word stays in the caption it was in")

spans = [(0.0, 0.5), (0.5, 1.0), (1.0, 1.9), (2.1, 2.5)]
captions = [(0.0, 2.0), (2.0, 3.0)]
fitted = phoneme.fit_to_captions([-0.3, 0.6, 2.4, 2.2], spans, captions)
check("a start before its caption is brought to the caption's start", ok=fitted[0][0] == 0.0, detail=f"got {fitted}")
check(
    "a start past its own word's end is kept just inside the word, whose end stays",
    ok=fitted[2] == (round(1.9 - phoneme.MIN_WORD_SEC, 3), 1.9),
    detail=f"got {fitted}",
)
check(
    "every word's middle stays inside its old span, so a Fewer / More re-cut files it with the same caption",
    ok=all(a0 <= (a + b) / 2 < b0 for (a, b), (a0, b0) in zip(fitted, spans)),
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

print("\nreading -- what was recited, restarts included")

# Four units of three symbols each; the reciter says 1-2, goes back to 1, then says 1-4.
UNITS = [[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12]]
heard = [1, 2, 3, 4, 5, 6] + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
check("a restart is read as a run going back", ok=phoneme_reading.runs_recited(heard, UNITS) == [(0, 1), (0, 3)],
      detail=f"got {phoneme_reading.runs_recited(heard, UNITS)}")
check("a reading straight through is one run", ok=phoneme_reading.runs_recited(list(range(1, 13)), UNITS) == [(0, 3)])
check("a symbol misheard is not taken for a restart",
      ok=phoneme_reading.runs_recited([1, 2, 3, 4, 9, 6, 7, 8, 9, 10, 11, 12], UNITS) == [(0, 3)])
check("a unit never heard is still recited, in place",
      ok=phoneme_reading.runs_recited([1, 2, 3, 7, 8, 9, 10, 11, 12], UNITS) == [(0, 3)])
units = [phoneme_table.Unit([0], "", True), phoneme_table.Unit([1, 2], "", True), phoneme_table.Unit([3], "", True)]
script, again = phoneme_reading.script_from_runs([(0, 1), (1, 2)], units)
check("runs become the aligner's script, the words said again marked so",
      ok=script == [0, 1, 2, 1, 2, 3] and again == [False, False, False, True, True, True], detail=f"got {script} {again}")

REF = [("9:1", 0, "a"), ("9:1", 1, "b"), ("9:1", 2, "c"), ("9:2", 0, "d"), ("9:2", 1, "e")]
read = ([0, 1, 2, 1, 2, 3, 4], [False, False, False, True, True, False, False])
check("restarts are counted where the script goes back", ok=phoneme_reading._restarts(read[0]) == 1 and phoneme_reading._restarts([0, 1, 0, 1, 0, 1]) == 2)
check("one ayah's stretch of a script, with its flags",
      ok=phoneme_reading._ayah_block(read, REF, "9:1") == ([0, 1, 2, 1, 2], [False, False, False, True, True]))
check("an ayah the script leaves and comes back to is not taken apart",
      ok=phoneme_reading._ayah_block(([0, 1, 3, 1, 4], [False] * 5), REF, "9:1") is None)
swapped = phoneme_reading._with_block(read, REF, "9:1", ([0, 1, 0, 1, 2], [False, False, True, True, False]))
check("an ayah's stretch is replaced and the rest kept",
      ok=swapped == ([0, 1, 0, 1, 2, 3, 4], [False, False, True, True, False, False, False]), detail=f"got {swapped}")

print("\nopenings -- an isti'adha or basmala heard before the passage")

check("found inside whatever else was said", ok=phoneme_reading.best_match([1, 2, 3], [9, 1, 2, 3, 9])[:1] == (0,))
check("a symbol misheard costs one", ok=phoneme_reading.best_match([1, 2, 3], [9, 1, 7, 3, 9])[0] == 1)
check("nothing like it is far off", ok=phoneme_reading.best_match([1, 2, 3], [5, 5, 5])[0] == 3)

print("\nlab -- the stages the dev-only lab hands to a phoneme model")

check("reading and timing by name", ok=phoneme.lab_stages("reading=v31;timing=old") == {"phoneme_reading": "v31", "phoneme_timing": "old"})
check("anything else ignored", ok=phoneme.lab_stages("reading=whisper;starts=old;x") == {} and phoneme.lab_stages("") == {})

print(f"\n{'FAILED: ' + ', '.join(FAILED) if FAILED else 'all checks passed'}")
sys.exit(1 if FAILED else 0)
