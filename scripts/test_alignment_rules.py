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
    word("40:13", 2, "يُرِيكُمْ ۖ", 1.2, 1.8),    # the reciter stops here
    word("40:13", 3, "آيَاتِهِ", 2.7, 3.3),
    word("40:14", 0, "فَادْعُوا", 3.5, 4.1),
    word("40:14", 1, "اللَّهَ", 4.2, 4.8),
]
script = [0, 1, 2, 3, 4, 5]
segments, _ = align._segment_the_timeline(run, script, 5.0, pauses=[(1.85, 2.65)])
starts = [(s.verse_key, s.start_word, s.end_word) for s in segments]
check(
    "an ayah boundary always ends a line",
    ("40:14", 0, 1) in starts,
    f"got {starts}",
)
check(
    "a silence the reciter took ends a line",
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
segments, _ = align._segment_the_timeline(smooth, [5, 6, 7, 8, 9], 3.6, pauses=[])
check(
    "with no silence in it, a phrase is not split",
    len(segments) == 1,
    f"split into {[(s.start_word, s.end_word) for s in segments]}",
)

# The bug this was written for. لَكُم carries no stop mark, and the 0.20s of
# quiet after it is the ordinary gap between two words -- the same length as
# the quiet after رِزْقًا ۚ, which *does* end the phrase. Only the mark separates
# them, so length alone must not be allowed to break here.
segments, _ = align._segment_the_timeline(smooth, [5, 6, 7, 8, 9], 3.6, pauses=[(1.42, 1.62)])
check(
    "a brief pause with no stop mark does not split a phrase",
    len(segments) == 1,
    f"split into {[(s.start_word, s.end_word) for s in segments]}",
)

# Long enough that nothing articulatory explains it.
segments, _ = align._segment_the_timeline(smooth, [5, 6, 7, 8, 9], 3.6, pauses=[(1.42, 2.42)])
check(
    "but a long one does, after the word that finished before the silence",
    len(segments) == 2 and segments[0].end_word == 6,
    f"got {[(s.start_word, s.end_word) for s in segments]}",
)

# Silence after the last word is the recording running out, not a break before
# anything -- this used to cut the final word off into a caption of its own.
segments, _ = align._segment_the_timeline(smooth, [5, 6, 7, 8, 9], 5.5, pauses=[(3.7, 5.5)])
check(
    "run-out silence at the end does not orphan the last word",
    len(segments) == 1 and segments[0].end_word == 9,
    f"got {[(s.start_word, s.end_word) for s in segments]}",
)

# Silence the aligner covered over with a word is still silence. Refusing to
# break there let a 1.42s pause disappear inside a stretched إِلَيْكَ.
segments, _ = align._segment_the_timeline(smooth, [5, 6, 7, 8, 9], 3.6, pauses=[(2.1, 2.6)])
check(
    "a stop a stretched word was laid over still ends a line",
    len(segments) == 2,
    f"got {[(s.start_word, s.end_word) for s in segments]}",
)

# The tail pass reads the audio between one segment's last word and the next
# segment's first. Closing that gap before it runs leaves it only half to read,
# which is how a segment silently stopped picking up words the reciter repeated
# at its end. So the splitter must hand back *tight* segments.
tight, _ = align._segment_the_timeline(run, script, 5.0, pauses=[(1.85, 2.65)])
check(
    "segments come back tight, leaving the gap for the tail pass to read",
    all(b.start > a.end for a, b in zip(tight, tight[1:])),
    f"got {[(s.start, s.end) for s in tight]}",
)
closed = align._close_gaps(tight, 5.0)
check(
    "and closing them afterwards leaves no hole for a caption to blink out in",
    all(abs(b.start - a.end) < 1e-6 for a, b in zip(closed, closed[1:])),
    f"got {[(s.start, s.end) for s in closed]}",
)

print("\nstop marks -- they do not all mean the same thing")
check(
    "لا (U+06D9) is read as forbidding a stop",
    align._stop_licence("فَلَا\u06D9") == "never",
    f'got {align._stop_licence("فَلَا\u06D9")}',
)
check(
    "a saktah (U+06DC) is a pause without ending the phrase",
    align._stop_licence("عِوَجَا\u06DC") == "never",
)
check(
    "waqf lazim (U+06D8) is compulsory",
    align._stop_licence("كَلَّا\u06D8") == "always",
)
check(
    "mu'anaqa (U+06DB) is one of a pair",
    align._stop_licence("فِيهِ\u06DB") == "paired",
)
for mark, name in (("\u06D6", "صلى"), ("\u06D7", "قلى"), ("\u06DA", "ج")):
    check(f"{name} permits a stop", align._stop_licence("كَلِمَةٌ" + mark) == "allowed")
check("a plain word carries no licence", align._stop_licence("كَلِمَةٌ") == "none")

# A line must not break where the mushaf says the sense does not.
forbidden = [
    word("40:13", 0, "هُوَ", 0.0, 0.5),
    word("40:13", 1, "ٱلَّذِى\u06D9", 0.6, 1.1),   # لا -- do not stop
    word("40:13", 2, "يُرِيكُمْ", 2.4, 3.0),
]
segments, _ = align._segment_the_timeline(forbidden, [0, 1, 2], 3.0, pauses=[(1.15, 2.35)])
check(
    "the audio wins over the mark: a reciter who stopped at a لا still ends a line",
    len(segments) == 2,
    f"got {[(s.start_word, s.end_word) for s in segments]}",
)
# What a mark still does is lower the bar, not raise or veto one.
brief = [
    word("40:13", 0, "هُوَ", 0.0, 0.5),
    word("40:13", 1, "ٱلَّذِى ۖ", 0.6, 1.1),
    word("40:13", 2, "يُرِيكُمْ", 1.25, 2.0),
]
segments, _ = align._segment_the_timeline(brief, [0, 1, 2], 2.0, pauses=[])
check(
    "a mark with no hesitation behind it does not end a line",
    len(segments) == 1,
    f"got {[(s.start_word, s.end_word) for s in segments]}",
)

print("\ntajweed -- a held nasal is not a silence")
check(
    "لَكُم مِّنَ merges two mims into one held nasal",
    align._held_nasal_junction("لَكُم", "مِّنَ"),
)
check(
    "a tanween before ف is hidden behind a nasal (ikhfa)",
    align._held_nasal_junction("بِكَلِمَـٰتٍ", "فَأَتَمَّهُنَّ"),
)
check(
    "nun sakinah before ي holds one too",
    align._held_nasal_junction("مِن", "يَشَآءُ"),
)
check(
    "but و after a voweled ه does not",
    not align._held_nasal_junction("وَرَسُولُهُۥ", "وَصَدَقَ"),
)
check(
    "nor does a tanween before a throat letter, which is izhar -- said clearly",
    not align._held_nasal_junction("عَلِيمًا", "حَكِيمًا"),
)

# The same quiet, at a join tajweed explains and at one it does not.
nasal = [
    word("40:13", 5, "وَيُنَزِّلُ", 0.0, 0.8),
    word("40:13", 6, "لَكُم", 0.9, 1.4),
    word("40:13", 7, "مِّنَ", 1.9, 2.4),
]
segments, _ = align._segment_the_timeline(nasal, [5, 6, 7], 2.4, pauses=[(1.42, 1.86)])
check(
    "quiet a ghunnah accounts for does not end a line",
    len(segments) == 1,
    f"got {[(s.start_word, s.end_word) for s in segments]}",
)
plain = [
    word("33:22", 9, "وَرَسُولُهُۥ", 0.0, 0.8),
    word("33:22", 10, "وَصَدَقَ", 1.3, 1.8),
]
segments, _ = align._segment_the_timeline(plain, [9, 10], 1.8, pauses=[(0.82, 1.26)])
check(
    "the same quiet at a join with no ghunnah does",
    len(segments) == 2,
    f"got {[(s.start_word, s.end_word) for s in segments]}",
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

# The same word claimed twice 0.08s apart is a boundary artifact, not a repeat:
# nobody says a word twice that fast. Going back means having stopped first.
too_fast = [
    word("40:13", 0, "هُوَ", 0.0, 0.4),
    word("40:13", 1, "ٱلَّذِى", 0.5, 0.9),
    word("40:13", 1, "ٱلَّذِى", 0.98, 1.4),
    word("40:13", 2, "يُرِيكُمْ", 1.5, 1.9),
]
segments, _ = align._segment_the_timeline(too_fast, [0, 1, 1, 2], 1.9)
check(
    "a word claimed twice with no time between is not a restart",
    len(segments) == 1,
    f"split into {[(s.start_word, s.end_word) for s in segments]}",
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

print("\nalignment cost -- refusing a pass rather than being killed by it")
# The two points the formula was fitted against, measured as peak RSS on this
# machine with a synthetic emission (vocab 1025, 12.75 frames/sec).
for minutes, frames, tokens, measured_mb in ((20, 15306, 10500, 373), (40, 30612, 21000, 1353)):
    predicted_mb = align.alignment_bytes(frames, tokens, 1025) / 1024**2
    check(
        f"{minutes} min is predicted within 15% of the {measured_mb} MB measured",
        abs(predicted_mb - measured_mb) / measured_mb < 0.15,
        f"predicted {predicted_mb:.0f} MB",
    )
    check(
        f"{minutes} min is predicted high rather than low",
        # The two terms alone land just under what was measured, so a budget
        # built on them would refuse too late. The headroom is what makes the
        # check useful rather than merely accurate.
        predicted_mb >= measured_mb,
        f"predicted {predicted_mb:.0f} MB against {measured_mb} MB",
    )
check(
    "cost grows with the square of the recording, not linearly",
    # Doubling the audio doubles the frames *and* the text to place in them.
    # A linear model would put this at 2; anything near 4 is the real shape.
    align.alignment_bytes(30612, 21000, 1025) / align.alignment_bytes(15306, 10500, 1025) > 3.4,
)
check(
    "the 14-minute clip that was measured end-to-end is nowhere near the budget",
    align.alignment_bytes(10523, 7220, 1025) < align.MAX_ALIGN_MEMORY_GB * 1024**3 / 4,
)

print(f"\n{'FAILED: ' + ', '.join(FAILED) if FAILED else 'all checks passed'}")
sys.exit(1 if FAILED else 0)
