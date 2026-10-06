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

import numpy as np  # noqa: E402

from app import align, corpus, regroup  # noqa: E402
from app.audio import SAMPLE_RATE  # noqa: E402

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

# Fussilat 41:31's last words as the new ground-truth clip has them: the held
# closure of the دّ in تَدَّعُونَ reads as 0.36s of quiet, 0.08s into the word.
fussilat = [
    word("41:31", 13, "فِيهَا", 41.71, 42.27),
    word("41:31", 14, "مَا", 42.51, 42.59),
    word("41:31", 15, "تَدَّعُونَ", 42.98, 44.98),
]
segments, _ = align._segment_the_timeline(fussilat, [13, 14, 15], 45.0, pauses=[(43.06, 43.42)])
check(
    "a silence inside the last word does not cut the caption before it",
    ok=ranges(segments) == [("41:31", 14, 16)],
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

# The studio's "fewer / more screen breaks" setting moves the bars, and only
# them: at "normal" these are the calls the aligner has always made.
print("\nfewer / more screen breaks -- the bars move with the setting")
# test5.mp3 stops at the unmarked ٱلْأَرْضِ on about a quarter-second of quiet.
ghafir21 = [
    word("40:21", 18, "فِى", 0.0, 0.9),
    word("40:21", 19, "ٱلْأَرْضِ", 1.0, 2.0),
    word("40:21", 20, "فَأَخَذَهُمُ", 2.3, 3.0),
    word("40:21", 21, "ٱللَّهُ", 3.1, 4.0),
]
for setting, want in (("normal", [("40:21", 19, 22)]), ("more", [("40:21", 19, 20), ("40:21", 21, 22)])):
    segments, _ = align._segment_the_timeline(
        ghafir21, [18, 19, 20, 21], 4.1, pauses=[(2.02, 2.27)], bar_scale=align.BREAK_SCALES[setting]
    )
    check(f"0.25s of quiet at an unmarked word, {setting}", ok=ranges(segments) == want, detail=f"got {ranges(segments)}")

# test_this.mp3 carries on through مَوْلَىٰكُمْ ۖ, leaving only a 0.32s gap in the alignment.
tahrim2 = [
    word("66:2", 6, "وَٱللَّهُ", 0.0, 0.8),
    word("66:2", 7, "مَوْلَىٰكُمْ ۖ", 0.9, 1.6),
    word("66:2", 8, "وَهُوَ", 1.92, 2.4),
    word("66:2", 9, "ٱلْعَلِيمُ", 2.5, 3.2),
]
for setting, want in (("normal", [("66:2", 7, 8), ("66:2", 9, 10)]), ("fewer", [("66:2", 7, 10)])):
    segments, _ = align._segment_the_timeline(tahrim2, [6, 7, 8, 9], 3.3, pauses=[], bar_scale=align.BREAK_SCALES[setting])
    check(f"a stop mark on the alignment's gap alone, {setting}", ok=ranges(segments) == want, detail=f"got {ranges(segments)}")

# A room whose stops never go quiet. Abdullah_Almusa.mp3 stops at every ayah
# end only 8.4 dB under its speech level, short of the usual 10 dB, so no pause
# inside an ayah could register at all. The clip's own ayah ends set the depth.
print("\nhow quiet a stop is -- read from the clip's own ayah ends")


def recitation(stop_db: float, ayahs: int = 5) -> tuple[np.ndarray, list[align.AlignedWord]]:
    """Speech at a steady level, with a 0.6s stop at every ayah end `stop_db` under it."""
    rng = np.random.default_rng(0)
    speech, stop = 0.3, 0.3 * 10 ** (stop_db / 20)
    parts, words, t = [], [], 0.0
    for ayah in range(1, ayahs + 1):
        parts.append(rng.normal(0, speech, int(2.0 * SAMPLE_RATE)))
        words.append(word(f"1:{ayah}", 0, "كَلِمَة", t, t + 2.0))
        parts.append(rng.normal(0, stop, int(0.6 * SAMPLE_RATE)))
        t += 2.6
    return np.concatenate(parts), words


pcm, words = recitation(-25.0)
check(
    "a room whose stops reach the usual depth keeps it",
    ok=align.calibrated_drop(pcm, words) == align.QUIET_DROP_DB,
)
pcm, words = recitation(-8.4)
drop = align.calibrated_drop(pcm, words)
check(
    "a reverberant one is read at its own stops' depth",
    ok=7.0 < drop < align.QUIET_DROP_DB,
    detail=f"drop {drop:.1f} dB",
)
check(
    "and those stops now count as pauses, where the usual drop finds none",
    ok=len(align.quiet_spans(pcm, drop=drop)) >= 4 and not align.quiet_spans(pcm),
    detail=f"{len(align.quiet_spans(pcm, drop=drop))} with the clip's drop, {len(align.quiet_spans(pcm))} without",
)
pcm, words = recitation(-8.4, ayahs=2)
check(
    "two ayah ends are too few to judge a room by",
    ok=align.calibrated_drop(pcm, words) == align.QUIET_DROP_DB,
)
# One ayah end is too few on its own, but the reciter went back twice: each
# return is a stop as certain as an ayah end, and three are enough to read the
# room by. Each ayah is said twice, with the same 8.4 dB stop after every one.
pcm, _ = recitation(-8.4, ayahs=4)
went_back = [
    word("1:1", 0, "كَلِمَة", 0.0, 2.0), word("1:1", 0, "كَلِمَة", 2.6, 4.6),
    word("1:2", 0, "كَلِمَة", 5.2, 7.2), word("1:2", 0, "كَلِمَة", 7.8, 9.8),
]
check(
    "a restart counts as a stop to read the room by, as an ayah end does",
    ok=7.0 < align.calibrated_drop(pcm, went_back, script=[0, 0, 1, 1]) < align.QUIET_DROP_DB
    and align.calibrated_drop(pcm, went_back) == align.QUIET_DROP_DB,
    detail=f"drop {align.calibrated_drop(pcm, went_back, script=[0, 0, 1, 1]):.1f} dB with the restarts",
)

# Fewer / More re-cut a match the sidecar still holds, through the one grouping
# function `/align` itself calls -- so a re-cut cannot drift from a fresh match.
print("\nre-cutting a held match -- the same grouping a match makes")

held_pcm, held_words = recitation(-25.0)
held = align.prepare_grouping(held_pcm, held_words, list(range(len(held_words))), [False] * len(held_words), [])
duration = len(held_pcm) / SAMPLE_RATE
for setting, scale in align.BREAK_SCALES.items():
    direct, _ = align._segment_the_timeline(
        held.aligned, held.script, duration, held.quiet, held.repeated, held.hush, scale
    )
    check(
        f"a re-cut at {setting} groups exactly as the match would",
        ok=ranges(align.group_recitation(held, setting)) == ranges(align._close_gaps(direct, duration, held.quiet)),
    )

minute = align.Grouping(np.zeros(60 * SAMPLE_RATE, dtype=np.float32), [], [], [], [], [], [])
kept_before = regroup.MAX_KEPT_SECONDS
regroup.MAX_KEPT_SECONDS = 150
first = regroup.keep(regroup.Kept(minute, {}, 0.0))
second = regroup.keep(regroup.Kept(minute, {}, 0.0))
third = regroup.keep(regroup.Kept(minute, {}, 0.0))
check(
    "the oldest held match makes room for a new one, by length of audio",
    ok=regroup.find(first) is None and regroup.find(second) is not None and regroup.find(third) is not None,
)
check("an id nobody was given finds nothing", ok=regroup.find("not-an-id") is None)
regroup.MAX_KEPT_SECONDS = kept_before

print(f"\n{'FAILED: ' + ', '.join(FAILED) if FAILED else 'all checks passed'}")
sys.exit(1 if FAILED else 0)
