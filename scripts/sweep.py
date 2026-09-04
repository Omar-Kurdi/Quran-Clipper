"""Try a range of values for one alignment threshold and score every clip.

Not a suggestion engine -- a parameter sweep. It re-runs the aligner across a
grid of values and reports which one scores best **across all ground truth**,
which is the whole point: twice this session a change that scored higher on the
single clip we had was the wrong change, and only a second clip could say so.
A value that wins on one recording and loses on another is not an improvement,
and this is what makes that visible instead of arguable.

Everything is loaded once and the constant is reassigned between runs, so a
sweep costs one model load rather than one per value.

Run from the repo root:
    asr-service/.venv/bin/python scripts/sweep.py                 # what can be swept
    asr-service/.venv/bin/python scripts/sweep.py MIN_UNMARKED_PAUSE_SEC
    asr-service/.venv/bin/python scripts/sweep.py QUIET_DROP_DB 6 8 10 12
"""
from __future__ import annotations

import glob
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "asr-service"))

import eval_segments as ev  # noqa: E402
from app import align  # noqa: E402

#: The thresholds worth sweeping, with a grid that brackets the current value.
#: Deliberately short -- every extra value is another full alignment of every
#: clip, and a grid this coarse already shows whether a threshold is on a cliff
#: or a plateau.
GRIDS: dict[str, list[float]] = {
    "MIN_UNMARKED_PAUSE_SEC": [0.18, 0.22, 0.26, 0.30, 0.34, 0.40],
    "MIN_MARKED_PAUSE_SEC": [0.10, 0.14, 0.18, 0.22, 0.26],
    "MIN_RESTART_GAP_SEC": [0.20, 0.25, 0.30, 0.35, 0.40],
    "QUIET_DROP_DB": [6, 8, 10, 12, 14],
    "NASAL_JUNCTION_FACTOR": [1.0, 1.5, 2.0, 2.5, 3.0],
    "MAX_PAUSE_INSET": [0.15, 0.20, 0.25, 0.30],
}


def load_clips():
    """Decode and resolve every ground-truth clip once."""
    clips = []
    for path in sorted(glob.glob(os.path.join(os.path.dirname(__file__), "expected_*.txt"))):
        facts = ev.read_metadata(path)
        passage = facts.get("passage", "")
        clip = facts.get("clip")
        if not clip or ":" not in passage:
            print(f"  skipping {os.path.basename(path)} (no clip/passage in it)")
            continue
        audio = ev.find_audio(clip)
        if not audio:
            print(f"  skipping {os.path.basename(path)} ({clip} is not in the repo root)")
            continue
        surah, rest = passage.split(":")
        start, end = rest.split("-")
        ref_words = ev.fetch_words(int(surah), int(start), int(end))
        expected = ev.resolve_expected(ref_words, path)
        trim_text = facts.get("trim", "none")
        trim = None
        if "-" in trim_text and trim_text != "none":
            a, b = trim_text.split("-")
            trim = (float(a), float(b))
        clips.append({
            "name": clip,
            "pcm": ev.decode(audio, trim),
            "ref_words": ref_words,
            "expected": expected,
        })
    return clips


def main() -> None:
    if len(sys.argv) < 2:
        print("\nSweepable thresholds (current value in brackets):\n")
        for name, grid in GRIDS.items():
            print(f"  {name:<26} {getattr(align, name)!r:<8} grid: {grid}")
        print("\n  asr-service/.venv/bin/python scripts/sweep.py <NAME> [values...]\n")
        return

    name = sys.argv[1]
    if not hasattr(align, name):
        raise SystemExit(f"align.py has no {name}. Run with no arguments to list what can be swept.")
    values = [float(v) for v in sys.argv[2:]] or GRIDS.get(name)
    if not values:
        raise SystemExit(f"No default grid for {name}; pass values explicitly.")

    original = getattr(align, name)
    print(f"\nloading clips...")
    clips = load_clips()
    if not clips:
        raise SystemExit("No scoreable ground truth. See ./gauge.sh.")
    total_expected = sum(len(c["expected"]) for c in clips)
    print(f"{len(clips)} clip(s), {total_expected} expected segments, {len(values)} value(s) to try\n")

    header = f"  {name:<22}" + "".join(f"{c['name'][:12]:>14}" for c in clips) + f"{'TOTAL':>10}"
    print(header)
    print("  " + "-" * (len(header) - 2))

    results: list[tuple[float, int]] = []
    for value in values:
        setattr(align, name, value)
        per_clip = []
        for clip in clips:
            result = align.align_recitation(clip["pcm"], clip["ref_words"])
            predicted = [(s.verse_key, s.start_word + 1, s.end_word + 1) for s in result.segments]
            per_clip.append(ev.count_hits(predicted, clip["expected"]))
        total = sum(per_clip)
        results.append((value, total))
        marker = "  <- current" if value == original else ""
        cells = "".join(f"{h}/{len(c['expected'])}".rjust(14) for h, c in zip(per_clip, clips))
        print(f"  {value:<22}{cells}{f'{total}/{total_expected}':>10}{marker}")

    setattr(align, name, original)

    best = max(results, key=lambda r: r[1])
    current = next((t for v, t in results if v == original), None)
    print()
    if current is not None and best[1] > current:
        print(f"  Best: {name}={best[0]} at {best[1]}/{total_expected}, "
              f"against {current}/{total_expected} at the current {original}.")
        print(f"  Set ALIGN_{name} to try it, and re-run ./gauge.sh to confirm.")
    else:
        ties = [v for v, t in results if t == best[1]]
        print(f"  Nothing beats the current {original} ({best[1]}/{total_expected}); "
              f"{len(ties)} value(s) tie at the top.")
        print("  A flat row means this threshold is not what is limiting the score.")
    print()


if __name__ == "__main__":
    main()
