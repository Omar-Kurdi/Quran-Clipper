"""Fast checks on which reference words the phrase search lets a window claim.

Separate from `test_alignment_rules.py`, which is within a few lines of the 500
Skylos accepts in one file: this covers only the route rules of
`assign_phrase_ranges_by_decode`, given the phrase read-outs as text, so it
needs no audio and no model.

Run from the repo root:
    asr-service/.venv/bin/python scripts/test_phrase_search.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "asr-service"))

import numpy as np  # noqa: E402

from app import align, corpus  # noqa: E402

FAILED: list[str] = []


def check(name: str, *, ok: bool, detail: str = "") -> None:
    print(f"  {'PASS' if ok else 'FAIL'}  {name}")
    if not ok:
        if detail:
            print(f"        {detail}")
        FAILED.append(name)


# Going back is only a restart over words that were said. Yusuf 12:3-4, as the
# reference: 12:3 is words 0-15 and 12:4 is 16-30, so 12:4's لِى is word 29.
print("\ngoing back -- over words said, never over words skipped")
check(
    "a return into words an earlier window jumped over is not a restart",
    ok=align._goes_back_over_unsaid((3, 15, 0.96), 29, {0, 1, 29}),
)
check(
    "going back over words already said is one",
    ok=not align._goes_back_over_unsaid((5, 12, 0.95), 8, set(range(9))),
)
check(
    "and so is going back over a few the decoder garbled on the first pass",
    ok=not align._goes_back_over_unsaid((2, 10, 0.90), 7, {0, 1, 5, 6, 7}),
)
check(
    "as is a run said again exactly",
    ok=not align._goes_back_over_unsaid((6, 8, 1.00), 8, set(range(9))),
)

# The read-outs of Maher al-Muaiqly's 12:3-4, windowed 0-158s, which put 12:4's
# لِى between 12:3's first two words and the rest of it and dropped عَلَيْكَ.
# `لَ عَلَيْد` is عَلَيْكَ, but its lone `ل` matched لِى 27 words ahead, and the
# next window then claimed 12:3 again as though it had been said. Given as
# decodes, so the search runs with no model and no audio.
print("\nthe search -- a wrong jump ahead is not the only way forward")
yusuf = corpus.words_for_range(12, 3, 4)
read_outs = [
    "نَحْنُ نَقُص",
    "لَ عَلَيْد",
    "مَا أَحْسَنَ الْقَصَصِ بِمَا أَوْحَيْنَا إِلَيْكَ هَذَا الْقُرْآنَ وَإِن كُنتَ مِن قَبْلِهِ لَمِنَ الْغَافِلِينَ",
    "إِذْ قَالَ يُوسُفُ لِأَبِيهِ يَا أَبَتِ إِنِّي رَأَيْتُ أَحَدَ عَشَرَ كَوْكَبًا وَشًا",
    "وَالشَّمْسَ وَالْقَمَرَ رَأَيْتُهُمْ لِي سَاجِدِينَ",
]
ranges = align.assign_phrase_ranges_by_decode(
    np.zeros(0, dtype=np.float32), yusuf, [34.94, 36.82, 38.14, 57.34, 69.94, 77.00], read_outs
)
claimed = [(yusuf[start][0], yusuf[start][1] + 1, yusuf[end][1] + 1) for start, end, *_ in ranges]
scripted = [word for start, end, *_ in ranges for word in range(start, end + 1)]
ayahs = [int(yusuf[word][0].split(":")[1]) for word in scripted]
check("no word of 12:4 is scripted inside 12:3", ok=ayahs == sorted(ayahs), detail=f"got {claimed}")
check("and عَلَيْكَ, which was recited there, is scripted", ok=2 in scripted, detail=f"got {claimed}")

print(f"\n{'FAILED: ' + ', '.join(FAILED) if FAILED else 'all checks passed'}")
sys.exit(1 if FAILED else 0)
