"""Fast checks on how `eval_segments.py` reads a ground-truth file.

The gauge is only as good as this: a line resolved to the wrong words scores a
right caption as a miss, and nothing downstream can tell. Needs no audio and
no model.

Run from the repo root:
    asr-service/.venv/bin/python scripts/test_eval_segments.py
"""
from __future__ import annotations

import importlib.util
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "asr-service"))

from app import corpus  # noqa: E402

# Loaded from its path rather than imported by name: a bare `import
# eval_segments` reads as a package to install, and it is a script beside this one.
_spec = importlib.util.spec_from_file_location("eval_segments", os.path.join(os.path.dirname(__file__), "eval_segments.py"))
eval_segments = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(eval_segments)

FAILED: list[str] = []


def check(name: str, *, ok: bool, detail: str = "") -> None:
    print(f"  {'PASS' if ok else 'FAIL'}  {name}")
    if not ok:
        if detail:
            print(f"        {detail}")
        FAILED.append(name)


def resolve(surah: int, first: int, last: int, lines: list[str]) -> list[tuple[str, int, int]]:
    with tempfile.NamedTemporaryFile("w", suffix=".txt", encoding="utf-8", delete=False) as handle:
        handle.write("\n".join(lines) + "\n")
    try:
        resolved = eval_segments.resolve_expected(corpus.words_for_range(surah, first, last), handle.name)
    finally:
        os.unlink(handle.name)
    return [entry[:3] for entry in resolved]


# Ghafir 40:21-22 says فَأَخَذَهُمُ ٱللَّهُ twice: 40:21's words 21-22 and 40:22's
# words 8-9. test5's ground truth has the second as a caption of its own.
print("\na phrase the passage says twice -- read in recitation order")
ghafir = resolve(40, 21, 22, [
    "فَأَخَذَهُمُ ٱللَّهُ بِذُنُوبِهِمْ وَمَا كَانَ لَهُم مِّنَ ٱللَّهِ مِن وَاقٍ",
    "ذَٰلِكَ بِأَنَّهُمْ كَانَت تَّأْتِيهِمْ رُسُلُهُم بِٱلْبَيِّنَـٰتِ فَكَفَرُوا۟",
    "فَأَخَذَهُمُ ٱللَّهُ ۚ",
])
check("goes to the occurrence after the line before it", ok=ghafir[2] == ("40:22", 8, 9), detail=f"got {ghafir}")
check("and the first line still to the first", ok=ghafir[0] == ("40:21", 21, 30), detail=f"got {ghafir}")

# A restart goes back, and must still land where the reciter went back to.
restart = resolve(40, 22, 22, [
    "ذَٰلِكَ بِأَنَّهُمْ كَانَت تَّأْتِيهِمْ رُسُلُهُم",
    "كَانَت تَّأْتِيهِمْ رُسُلُهُم بِٱلْبَيِّنَـٰتِ فَكَفَرُوا۟",
])
check("a restart resolves behind the line before it", ok=restart[1] == ("40:22", 3, 7), detail=f"got {restart}")

print(f"\n{'FAILED: ' + ', '.join(FAILED) if FAILED else 'all checks passed'}")
sys.exit(1 if FAILED else 0)
