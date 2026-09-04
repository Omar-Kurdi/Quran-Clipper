"""Score the alignment pipeline against known-good segmentation.

Ground truth lives in `scripts/expected_segments.txt` as plain text; this
resolves each line to a (verse_key, start_word, end_word) range by skeleton
matching, so hand-typed simplified orthography scores the same as Uthmani.

Ground truth is per clip. The studio can write one out for you: correct the
captions by ear, then "Ground truth" in the header downloads a file in exactly
this format for that recording. Drop it in `scripts/` and pass it as the fifth
argument -- that is the whole loop, and it is what makes "did this change help?"
a number rather than an argument.

Run from the repo root:
    asr-service/.venv/bin/python scripts/eval_segments.py ~/Music/test.mp3 33 21 23
    asr-service/.venv/bin/python scripts/eval_segments.py test5.mp3 40 13 25 scripts/expected_test5.txt
"""
from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import sys
import urllib.request

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "asr-service"))
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO").upper(), format="%(levelname)s %(message)s")

from app import align  # noqa: E402
from app.audio import SAMPLE_RATE  # noqa: E402

DEFAULT_EXPECTED = os.path.join(os.path.dirname(__file__), "expected_segments.txt")


def match_skeleton(word: str) -> str:
    """Looser than the alignment vocab form: also folds ta-marbuta and drops
    trailing weak letters, so يَرْجُو and يَرْجُوا۟ compare equal."""
    base = align.normalize_for_vocab(word).replace("ة", "ه")
    return re.sub(r"[اويه]+$", "", base) or base


def fetch_words(surah: int, start: int, end: int) -> list[tuple[str, int, str]]:
    url = (
        f"https://api.quran.com/api/v4/verses/by_chapter/{surah}"
        "?language=en&words=true&fields=text_uthmani&word_fields=text_uthmani&per_page=300"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
    verses = json.load(urllib.request.urlopen(req))["verses"]
    out: list[tuple[str, int, str]] = []
    for verse in verses:
        if not start <= verse["verse_number"] <= end:
            continue
        index = 0
        for word in verse["words"]:
            if word.get("char_type_name") != "word":
                continue
            out.append((verse["verse_key"], index, word["text_uthmani"]))
            index += 1
    return out


def resolve_expected(ref_words: list[tuple[str, int, str]], expected_path: str) -> list[tuple[str, int, int, str]]:
    """Map each expected line onto the corpus as (verse_key, start_word, end_word)."""
    corpus = [match_skeleton(w[2]) for w in ref_words]
    resolved: list[tuple[str, int, int, str]] = []

    with open(expected_path, encoding="utf-8") as handle:
        lines = [ln.strip() for ln in handle if ln.strip() and not ln.strip().startswith("#")]

    for line in lines:
        wanted = [match_skeleton(t) for t in line.split()]
        wanted = [w for w in wanted if w]
        best, best_score = None, -1.0
        for start in range(len(corpus) - len(wanted) + 1):
            window = corpus[start : start + len(wanted)]
            score = sum(1 for a, b in zip(wanted, window) if a == b) / len(wanted)
            if score > best_score:
                best, best_score = start, score
        if best is None or best_score < 0.6:
            raise SystemExit(f"Could not resolve expected segment to the corpus: {line!r}")
        verse_key = ref_words[best][0]
        resolved.append((verse_key, ref_words[best][1] + 1, ref_words[best + len(wanted) - 1][1] + 1, line))
    return resolved


def count_hits(predicted: list[tuple[str, int, int]], expected: list[tuple[str, int, int, str]]) -> int:
    """Exact (verse, start_word, end_word) matches, order-independent, no double-counting.

    Split out from `score` so the sweep can call it thousands of times without
    printing a table each time.
    """
    remaining = list(predicted)
    hits = 0
    for verse_key, start, end, _ in expected:
        key = (verse_key, start, end)
        if key in remaining:
            remaining.remove(key)
            hits += 1
    return hits


def score(predicted: list[tuple[str, int, int]], expected: list[tuple[str, int, int, str]]) -> float:
    """Exact (verse, start_word, end_word) matches, order-independent, no double-counting."""
    remaining = list(predicted)
    hits = 0
    print(f"\n{'#':>3}  {'expected':<18} {'matched?':<10} text")
    print("-" * 78)
    for i, (verse_key, start, end, text) in enumerate(expected, 1):
        key = (verse_key, start, end)
        if key in remaining:
            remaining.remove(key)
            hits += 1
            mark = "YES"
        else:
            mark = "no"
        print(f"{i:>3}  {verse_key+':'+str(start)+'-'+str(end):<18} {mark:<10} {text[:44]}")

    if remaining:
        print(f"\n{len(remaining)} predicted segment(s) with no expected counterpart:")
        for verse_key, start, end in remaining:
            print(f"     {verse_key}:{start}-{end}")

    print(f"\nSCORE: {hits}/{len(expected)} exact word-range matches "
          f"({len(predicted)} predicted vs {len(expected)} expected)")
    return hits / len(expected)


def read_metadata(expected_path: str) -> dict:
    """Pull the `# key: value` block the studio writes into a ground-truth file.

    Files written before this block existed simply have none, which is why
    every caller treats an empty result as "ask the command line instead"
    rather than as an error.
    """
    facts: dict[str, str] = {}
    header: list[str] = []
    with open(expected_path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line.startswith("#"):
                if line:
                    break  # past the header, into the segments
                continue
            header.append(line)
            match = re.match(r"#\s*([a-z-]+)\s*:\s*(.+?)\s*$", line)
            if match and match.group(2) != "unknown":
                facts[match.group(1)] = match.group(2)

    # Fallback for the files written before the block existed. Their first line
    # already carries both facts in prose -- "# Ground truth for test3.mp3
    # (Al-Baqarah 2:122-125), ..." -- so reading it saves re-exporting ground
    # truth that is otherwise perfectly good.
    if "clip" not in facts or "passage" not in facts:
        for line in header:
            prose = re.match(r"#\s*Ground truth for\s+(\S+?)\s*\(.*?(\d+):(\d+)[-\u2013](\d+)\)", line)
            if prose:
                facts.setdefault("clip", prose.group(1))
                facts.setdefault("passage", f"{prose.group(2)}:{prose.group(3)}-{prose.group(4)}")
                break
    return facts


def find_audio(clip: str) -> str | None:
    """Locate the clip named in the ground truth, relative to the repo root."""
    root = os.path.join(os.path.dirname(__file__), "..")
    for candidate in (os.path.join(root, clip), os.path.join(root, "scripts", clip), clip):
        if os.path.exists(candidate):
            return candidate
    return None


def decode(audio_path: str, trim: tuple[float, float] | None) -> np.ndarray:
    """Decode to PCM, re-cutting the studio's trim window when there was one.

    Trimming in the studio is destructive and never touches the file on disk,
    so scoring a trimmed timeline against the whole recording would compare a
    timeline to audio it does not describe. Making the same cut here is what
    keeps the file reproducible from the original.
    """
    window = ["-ss", str(trim[0]), "-to", str(trim[1])] if trim else []
    raw = subprocess.run(
        ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", *window,
         "-i", audio_path, "-f", "s16le", "-ac", "1", "-ar", str(SAMPLE_RATE), "pipe:1"],
        stdout=subprocess.PIPE, check=True).stdout
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0


def main() -> None:
    # Two ways in. With a ground-truth file that carries its own metadata,
    # `eval_segments.py scripts/expected_test3.txt` is the whole command --
    # nothing to remember and nothing to type wrong. The positional form is
    # kept for the files written before that block existed.
    args = sys.argv[1:]
    if len(args) == 1 and args[0].endswith(".txt"):
        expected_path = args[0]
        if not os.path.exists(expected_path):
            raise SystemExit(f"no ground truth at {expected_path}.")
        facts = read_metadata(expected_path)
        passage = re.match(r"(\d+):(\d+)-(\d+)$", facts.get("passage", ""))
        if not passage:
            raise SystemExit(
                f"{os.path.basename(expected_path)} carries no `# passage:` line, so the ayah range "
                "is unknown. Either re-export it from the studio, or pass the range: "
                "eval_segments.py <audio> <surah> <start> <end> <expected.txt>"
            )
        surah, start, end = (int(g) for g in passage.groups())
        clip = facts.get("clip")
        audio_path = find_audio(clip) if clip else None
        if not audio_path:
            raise SystemExit(
                f"{os.path.basename(expected_path)} names the clip {clip!r}, which is not in the repo "
                "root. Audio is deliberately not committed -- put the file there and run this again."
            )
    else:
        if len(args) < 4:
            raise SystemExit(
                "usage:\n"
                "  eval_segments.py scripts/expected_test3.txt          (file carries its own metadata)\n"
                "  eval_segments.py <audio> <surah> <start> <end> [expected.txt]"
            )
        audio_path = args[0]
        surah, start, end = (int(x) for x in args[1:4])
        expected_path = args[4] if len(args) > 4 else DEFAULT_EXPECTED
        facts = read_metadata(expected_path) if os.path.exists(expected_path) else {}

    if not os.path.exists(expected_path):
        raise SystemExit(
            f"no ground truth at {expected_path}.\n"
            "Correct the captions in the studio, then use \"Ground truth\" in the header to write one."
        )

    trim_text = facts.get("trim", "none")
    trim_match = re.match(r"([\d.]+)-([\d.]+)$", trim_text)
    trim = (float(trim_match.group(1)), float(trim_match.group(2))) if trim_match else None

    ref_words = fetch_words(surah, start, end)
    expected = resolve_expected(ref_words, expected_path)
    print(f"reference: {len(ref_words)} words; ground truth: {len(expected)} segments "
          f"from {os.path.basename(expected_path)}")

    pcm = decode(audio_path, trim)
    print(f"audio: {os.path.basename(audio_path)}"
          + (f", trimmed to {trim[0]:.2f}-{trim[1]:.2f}s as the studio had it" if trim else ""))

    result = align.align_recitation(pcm, ref_words)
    predicted = [(s.verse_key, s.start_word + 1, s.end_word + 1) for s in result.segments]

    print("\npredicted segments:")
    for i, s in enumerate(result.segments, 1):
        flag = "  (restart)" if s.is_restart else ""
        print(f"{i:>3}  {s.verse_key}:{s.start_word+1}-{s.end_word+1}  {s.start:6.2f}-{s.end:6.2f}{flag}")

    score(predicted, expected)


if __name__ == "__main__":
    main()
