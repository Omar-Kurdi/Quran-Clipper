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

print("\nthe openings -- the isti'adha and basmala said before a recitation are no ayah's phrases")
ISTIADHA = "أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ"
off = detect.without_openings
check("the isti'adha and a basmala heard in two halves are all taken off",
      passed=off([ISTIADHA, "", "بِسْمِ اللَّهِ", "الرَّحْمَنِ الرَّحِيمِ", "الم", "تِلْكَ آيَاتُ"]) == (["الم", "تِلْكَ آيَاتُ"], {"istiadha", "basmala"}))
check("without their marks or hamza", passed=off(["اعوذ بالله من الشيطان الرجيم الم"]) == (["الم"], {"istiadha"}))
check("a basmala on its own", passed=off(["بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ الم"]) == (["الم"], {"basmala"}))
check("a phrase that runs on past them keeps the rest", passed=off([ISTIADHA + " وَلَقَدْ آتَيْنَا"]) == (["وَلَقَدْ آتَيْنَا"], {"istiadha"}))
check("16:98 itself is left alone", passed=off(["فَإِذَا قَرَأْتَ الْقُرْآنَ فَاسْتَعِذْ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ"])[1] == set())
check("as are 113:1 and 114:1", passed=off(["قُلْ أَعُوذُ بِرَبِّ الْفَلَقِ"])[1] == set() and off(["أَعُوذُ بِرَبِّ النَّاسِ"])[1] == set())
check("and a basmala after the recitation has begun", passed=off(["الم", "بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ"])[1] == set())
check("a basmala heard only as its الرَّحْمَنِ الرَّحِيمِ, as the decoder can, is still taken off",
      passed=off([ISTIADHA, "", "الرَّحْمَنِ الرَّحِيمِ", "الم"]) == (["الم"], {"istiadha", "basmala"}))
check("but those words later on are the recitation's", passed=off(["الم", "الرَّحْمَنِ الرَّحِيمِ"])[1] == set())
check("Al-Fatihah found from 1:2 after its basmala starts at 1:1",
      passed=detect._from_the_basmala([detect.SurahRange(1, 2, 7, 6)], {"basmala"})[0].start_ayah == 1)
check("but not when no basmala was taken off",
      passed=detect._from_the_basmala([detect.SurahRange(1, 2, 7, 6)], {"istiadha"})[0].start_ayah == 2)

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
