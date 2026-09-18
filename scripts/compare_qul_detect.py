"""Compare "Local" and "Local + QUL" at finding which passage was recited.

For every ground-truth file whose recording is on disk, the audio is decoded
once and the decoded phrases are handed to range detection twice -- without
QUL's text data, which is what "Local" does, and with it, which is what
"Local + QUL" does. The passage each one finds is printed beside the passage
the ground truth says was recited.

Detection is the only thing the QUL option changes: once the passage is known,
both align it identically. So this is the whole comparison, and it takes one
decode per clip rather than two full alignments.

Needs the model and the QUL exports (`node scripts/qul-import.mjs`). Run from
the repo root:

    asr-service/.venv/bin/python scripts/compare_qul_detect.py
    asr-service/.venv/bin/python scripts/compare_qul_detect.py test3     # only files matching "test3"
"""
from __future__ import annotations

import glob
import importlib.util
import logging
import os
import re
import sys
from collections import Counter

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "asr-service"))
logging.basicConfig(level=os.getenv("LOG_LEVEL", "WARNING").upper(), format="%(levelname)s %(message)s")

from app import align, detect, qul  # noqa: E402

# The ground-truth helpers live beside this script, in `eval_segments.py`, and
# are loaded from that file rather than imported by name: it is a script, not
# an installed package.
_spec = importlib.util.spec_from_file_location("eval_segments", os.path.join(os.path.dirname(__file__), "eval_segments.py"))
eval_segments = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(eval_segments)


def label(found: detect.DetectedRange | None) -> str:
    if found is None:
        return "nothing found"
    return ", ".join(f"{r.surah}:{r.start_ayah}-{r.end_ayah}" for r in found.ranges) + f"  ({found.confidence:.2f})"


def verdict(found: detect.DetectedRange | None, surah: int, start: int, end: int) -> str:
    """exact, covers (a wider range that contains it), partial, wrong, or none."""
    ranges = found.ranges if found else []
    here = [(r.start_ayah, r.end_ayah) for r in ranges if r.surah == surah]
    outcomes = [
        ("none", found is None),
        ("wrong", not here),
        ("exact", here == [(start, end)] and len(ranges) == 1),
        ("covers", any(a <= start and b >= end for a, b in here)),
    ]
    return next((name for name, holds in outcomes if holds), "partial")


def compare(path: str, assist: qul.Assist) -> tuple[str, dict[str, str]]:
    """One ground-truth file: its row of the table, and each option's outcome."""
    name = os.path.basename(path)[len("expected_") : -len(".txt")][:34]
    facts = eval_segments.read_metadata(path)
    passage = re.match(r"(\d+):(\d+)-(\d+)$", facts.get("passage", ""))
    window = re.match(r"([\d.]+)-([\d.]+)$", facts.get("trim", "none"))
    trim = (float(window.group(1)), float(window.group(2))) if window else None
    audio = eval_segments.find_audio(facts["clip"], trim) if facts.get("clip") else None
    if not passage or not audio:
        return f"  {name:<34} skipped: {'no passage line' if not passage else 'recording not on disk'}", {}
    surah, start, end = (int(g) for g in passage.groups())

    pcm = eval_segments.decode(audio, trim)
    phrases = align.decode_phrases(pcm, align.detect_boundaries(pcm))
    found = {"Local": detect.detect_range(phrases), "Local + QUL": detect.detect_range(phrases, assist)}
    outcomes = {key: verdict(result, surah, start, end) for key, result in found.items()}
    cells = [f"{label(found[key])} [{outcomes[key]}]" for key in found]
    return f"  {name:<34} {f'{surah}:{start}-{end}':<12} {cells[0]:<28} {cells[1]:<28}", outcomes


def main() -> None:
    assist = qul.load()
    if assist is None:
        raise SystemExit(f"No QUL exports in {qul.data_dir()} -- run `node scripts/qul-import.mjs` first.")

    wanted = sys.argv[1] if len(sys.argv) > 1 else ""
    files = sorted(glob.glob(os.path.join(os.path.dirname(__file__), f"expected_*{wanted}*.txt")))
    if not files:
        raise SystemExit("No ground truth in scripts/.")

    print(f"\n  {'clip':<34} {'recited':<12} {'Local':<28} {'Local + QUL':<28}")
    print("  " + "-" * 104)
    outcomes: list[dict[str, str]] = []
    for path in files:
        row, outcome = compare(path, assist)
        print(row)
        outcomes.append(outcome)

    print()
    for key in ("Local", "Local + QUL"):
        counts = Counter(outcome[key] for outcome in outcomes if outcome)
        print(f"  {key:<12} " + ", ".join(f"{count} {name}" for name, count in sorted(counts.items())))


if __name__ == "__main__":
    main()
