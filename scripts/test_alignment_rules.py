"""Fast checks on the alignment rules that do not need audio or a model.

Everything here is pure text and timing arithmetic, so it runs in milliseconds
and needs no GPU, no checkpoint and no network. `eval_segments.py` covers the
end-to-end quality question; this covers the specific rules that, when they
were missing, let one bad match destroy a whole recitation.

Run from the repo root:
    asr-service/.venv/bin/python scripts/test_alignment_rules.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "asr-service"))

from app import align, corpus  # noqa: E402

FAILED: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    print(f"  {'PASS' if condition else 'FAIL'}  {name}")
    if not condition:
        if detail:
            print(f"        {detail}")
        FAILED.append(name)


# The exact fragment from the failure this was written for: a phrase boundary
# landed inside رِزْقًا in Ghafir 40:13 and left its tail as a phrase of its own.
FRAGMENT = "ْقًا"

print("\nskeletons -- why a fragment cannot be trusted to place itself")
check(
    "the fragment reduces to a single letter",
    align._skeleton(FRAGMENT) == "ق",
    f"got {align._skeleton(FRAGMENT)!r}",
)
check(
    "and that letter matches قوة exactly while scoring 0 against its own رزق",
    align._skeleton("قُوَّةً") == "ق" and align._skeleton("رِزْقًا") == "رزق",
)

print("\ncarries_position -- what may move the reading")
check("a one-letter tail may not", not align.carries_position(FRAGMENT))
check("nor may a single short word", not align.carries_position("مَا"))
check(
    "a real phrase may",
    align.carries_position("مِّنَ السَّمَاءِ رِزْقًا"),
)

print("\nmatch_decoded_to_range -- the regression itself")
ref = corpus.words_for_range(40, 13, 25)
cursor = 9  # just after رِزْقًا, where the reciter actually was
match = align.match_decoded_to_range(
    FRAGMENT, ref, cursor, near_only=not align.carries_position(FRAGMENT)
)
landed = ref[match[0]][0] if match else None
check(
    "the fragment cannot be placed in 40:21, eight ayahs away",
    landed != "40:21",
    f"landed at {landed} (this is the bug: it used to score 0.97 there)",
)
check(
    "and stays beside the cursor instead",
    match is not None and abs(match[0] - cursor) <= align.MAX_BACK_OVERLAP,
    f"landed at index {match[0] if match else None} against cursor {cursor}",
)
whole = align.match_decoded_to_range("وَمَا كَيْدُ الْكَافِرِينَ إِلَّا فِي ضَلَالٍ", ref, 0)
check(
    "a phrase that does carry position still finds it",
    whole is not None and ref[whole[0]][0] == "40:25",
    f"landed at {ref[whole[0]][0] if whole else None}",
)


def word(key: str, index: int, text: str, start: float, end: float) -> align.AlignedWord:
    return align.AlignedWord(
        text=text, verse_key=key, word_index=index, start=start, end=end, score=0.9
    )


print("\n_segment_the_timeline -- where a line may break")
# Two ayahs, read straight through, with one waqf-marked stop in the middle of
# the first and one ordinary word gap that must not become a break.
run = [
    word("40:13", 0, "هُوَ", 0.0, 0.5),
    word("40:13", 1, "الَّذِي", 0.6, 1.1),       # 0.10s -- no pause
    word("40:13", 2, "يُرِيكُمْ ۖ", 1.2, 1.8),    # waqf mark, followed by 0.9s
    word("40:13", 3, "آيَاتِهِ", 2.7, 3.3),
    word("40:14", 0, "فَادْعُوا", 3.5, 4.1),
    word("40:14", 1, "اللَّهَ", 4.2, 4.8),
]
script = [0, 1, 2, 3, 4, 5]
segments, _ = align._segment_the_timeline(run, script, 5.0)
starts = [(s.verse_key, s.start_word, s.end_word) for s in segments]
check(
    "an ayah boundary always ends a line",
    ("40:14", 0, 1) in starts,
    f"got {starts}",
)
check(
    "a waqf mark the reciter stopped on ends a line",
    ("40:13", 0, 2) in starts,
    f"got {starts}",
)
check(
    "an ordinary word gap does not",
    all(seg.end_word != 1 or seg.verse_key != "40:13" for seg in segments),
    f"got {starts}",
)

# The user's complaint: a dip with no pause behind it must not split a phrase.
smooth = [
    word("40:13", 5, "وَيُنَزِّلُ", 0.0, 0.8),
    word("40:13", 6, "لَكُم", 0.9, 1.4),
    word("40:13", 7, "مِّنَ", 1.5, 1.9),
    word("40:13", 8, "السَّمَاءِ", 2.0, 2.7),
    word("40:13", 9, "رِزْقًا", 2.8, 3.6),
]
segments, _ = align._segment_the_timeline(smooth, [5, 6, 7, 8, 9], 3.6, boundaries=[1.45])
check(
    "a dip the reciter did not pause on does not split a phrase",
    len(segments) == 1,
    f"split into {[(s.start_word, s.end_word) for s in segments]}",
)

print("\nrestarts")
# The reciter says words 0-2, goes back, and carries on past where they stopped.
back = [
    word("40:13", 0, "هُوَ", 0.0, 0.4),
    word("40:13", 1, "الَّذِي", 0.5, 0.9),
    word("40:13", 0, "هُوَ", 1.5, 1.9),
    word("40:13", 1, "الَّذِي", 2.0, 2.4),
    word("40:13", 2, "يُرِيكُمْ", 2.5, 2.9),
]
segments, _ = align._segment_the_timeline(back, [0, 1, 0, 1, 2], 2.9)
check(
    "going back over earlier words starts a new segment",
    len(segments) == 2 and segments[1].is_restart,
    f"got {[(s.start_word, s.end_word, s.is_restart) for s in segments]}",
)

print("\ndecode_agreement")
check(
    "nothing to compare reads as unmeasurable, not as disagreement",
    align.decode_agreement(run, [0.0, 5.0], ["ا"]) is None,
)
check(
    "text that matches what was placed there scores high",
    (align.decode_agreement(run, [0.0, 3.4], ["هُوَ الَّذِي يُرِيكُمْ آيَاتِهِ"]) or 0) > 0.8,
    f"got {align.decode_agreement(run, [0.0, 3.4], ['هُوَ الَّذِي يُرِيكُمْ آيَاتِهِ'])}",
)
check(
    "text that does not, scores low",
    (align.decode_agreement(run, [0.0, 3.4], ["الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ"]) or 0) < 0.4,
)

print(f"\n{'FAILED: ' + ', '.join(FAILED) if FAILED else 'all checks passed'}")
sys.exit(1 if FAILED else 0)
