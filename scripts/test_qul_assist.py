"""Fast checks on the "Local + QUL" detection assist.

Separate from `test_alignment_rules.py`, which checks the aligner every option
shares: this covers only what the QUL option adds to range detection, on a
made-up corpus, so it needs neither the QUL exports nor the Quran text download.

Run from the repo root:
    asr-service/.venv/bin/python scripts/test_qul_assist.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "asr-service"))

from app import corpus, detect  # noqa: E402
from app.qul import Assist  # noqa: E402

FAILED: list[str] = []


def check(name: str, *, ok: bool, detail: str = "") -> None:
    print(f"  {'PASS' if ok else 'FAIL'}  {name}")
    if not ok:
        if detail:
            print(f"        {detail}")
        FAILED.append(name)


def trigram_index(tokens: list[str]) -> dict:
    index: dict = {}
    for i in range(len(tokens) - corpus.NGRAM + 1):
        index.setdefault(tuple(tokens[i : i + corpus.NGRAM]), []).append(i)
    return index

print("\nrepeated phrases -- every occurrence is a candidate")

FILLER = "نجم"
PHRASE = ["كتب", "قلم", "درس"]
# The phrase fifty times, each occurrence parted from the next by filler.
toy: list[str] = []
occurrence_starts: list[int] = []
for _ in range(50):
    occurrence_starts.append(len(toy))
    toy.extend(PHRASE + [FILLER] * 4)
toy_index = trigram_index(toy)
last = occurrence_starts[-1]
twins_assist = Assist(
    morph_keys=list(toy),
    morph_index=toy_index,
    lexicon={},
    covering={
        position: [("p", start, start + 2)]
        for start in occurrence_starts
        for position in range(start, start + 3)
    },
    occurrences={"p": [(start, start + 2) for start in occurrence_starts]},
)

without = detect.locate_phrase(" ".join(PHRASE), toy, toy_index, near=last)
check(
    "without it, a phrase repeated more often than the candidate limit misses the right occurrence",
    ok=without is not None and without[0] != last,
    detail=f"got {without}",
)
with_twins = detect.locate_phrase(" ".join(PHRASE), toy, toy_index, near=last, assist=twins_assist)
check(
    "with it, every occurrence is scored and the one beside the recitation wins",
    ok=with_twins is not None and with_twins[0] == last,
    detail=f"got {with_twins}",
)
check(
    "a span wholly inside a repeated phrase is recognised as one",
    ok=twins_assist.is_repeated(occurrence_starts[3], occurrence_starts[3] + 2),
)
check(
    "a span running past it is not",
    ok=not twins_assist.is_repeated(occurrence_starts[3], occurrence_starts[3] + 3),
)
check(
    "twins keep the offset into the phrase, and never include the span itself",
    ok=twins_assist.twins(occurrence_starts[0] + 1, occurrence_starts[0] + 2)
    == [start + 1 for start in occurrence_starts[1:]],
)

print("\nroots -- a word heard in another form")

# The decoder heard يكتبون where the text has تكتبون. The letters
# disagree; the root does not.
roots = ["سمع", "تكتبون", "ذهب", "قعد"]
root_keys = ["r:سمع", "r:كتب", "r:ذهب", "r:قعد"]
root_index = trigram_index(root_keys)
root_assist = Assist(
    morph_keys=root_keys,
    morph_index=root_index,
    lexicon={corpus.skeleton(word): key for word, key in zip(roots, root_keys)} | {corpus.skeleton("يكتبون"): "r:كتب"},
)
skeleton_corpus = [corpus.skeleton(word) for word in roots]
skeleton_index = trigram_index(skeleton_corpus)
heard = "سمع يكتبون ذهب"
by_letters = detect.locate_phrase(heard, skeleton_corpus, skeleton_index)
by_root = detect.locate_phrase(heard, skeleton_corpus, skeleton_index, assist=root_assist)
check(
    "a word heard in another form scores higher by its root",
    ok=by_letters is not None and by_root is not None and by_root[2] > by_letters[2],
    detail=f"letters {by_letters}, roots {by_root}",
)
check(
    "and a root match is discounted, so it never outranks the same match on the letters",
    ok=by_root is not None and by_root[2] <= detect.ROOT_MATCH_WEIGHT,
    detail=f"got {by_root}",
)

print(f"\n{'FAILED: ' + ', '.join(FAILED) if FAILED else 'all checks passed'}")
sys.exit(1 if FAILED else 0)
