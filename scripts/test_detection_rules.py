"""Fast checks on the passage detection rules that need no audio or model.

Pure text: what counts as a surah's opening letters, and taking a detected
range back over them. Run from the repo root:
    asr-service/.venv/bin/python scripts/test_detection_rules.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "asr-service"))

from app import detect  # noqa: E402

FAILED: list[str] = []


def check(name: str, *, passed: bool, detail: str = "") -> None:
    print(f"  {'PASS' if passed else 'FAIL'}  {name}")
    if not passed:
        if detail:
            print(f"        {detail}")
        FAILED.append(name)

print("\nopening letters -- a surah's letters are taken into a range that starts just after them")
check("الٓمٓ is only letters", passed=detect.is_opening_letters(["الٓمٓ"]))
check("so are طسٓمٓ, حمٓ and كهيعٓصٓ", passed=all(detect.is_opening_letters([w]) for w in ["طسٓمٓ", "حمٓ", "كهيعٓصٓ"]))
check("an ordinary short ayah is not", passed=not detect.is_opening_letters(["ٱلرَّحْمَـٰنُ"]))
check("nor is a word made of the same letters among others", passed=not detect.is_opening_letters(["قَالَ", "كَلَّا", "سَيَعْلَمُونَ"]))
OPENING = {(3, 1): ["الٓمٓ"], (3, 2): ["ٱللَّهُ", "لَآ"], (42, 1): ["حمٓ"], (42, 2): ["عٓسٓقٓ"], (55, 1): ["ٱلرَّحْمَـٰنُ"]}
ayah_words = lambda surah, ayah: OPENING.get((surah, ayah), ["كَلِمَةٌ", "أُخْرَىٰ"])  # noqa: E731
check(
    "Ali 'Imran detected from 3:2 is taken back to 3:1",
    passed=detect.with_opening_letters(detect.SurahRange(3, 2, 4, 5), ayah_words).start_ayah == 1,
)
check(
    "Ash-Shura detected from 42:3 goes back over both its letter ayahs",
    passed=detect.with_opening_letters(detect.SurahRange(42, 3, 9, 5), ayah_words).start_ayah == 1,
)
check(
    "a range starting past the opening is left where it is",
    passed=detect.with_opening_letters(detect.SurahRange(3, 14, 20, 5), ayah_words).start_ayah == 14,
)
check(
    "and so is one whose surah opens with no letters",
    passed=detect.with_opening_letters(detect.SurahRange(55, 2, 9, 5), ayah_words).start_ayah == 2,
)

print(f"\n{'FAILED: ' + ', '.join(FAILED) if FAILED else 'all checks passed'}")
sys.exit(1 if FAILED else 0)
