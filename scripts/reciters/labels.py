"""Do an export's word labels fit the recording, block by block? (A block runs from one going-back to the next.)

    asr-service/.venv/bin/python scripts/reciters/labels.py jalil [key ...]   -> .run/reciters/jalil/labels.txt

Khalid al-Jalil's export labels every word after a restart one word on: 57:4 lists his second reading 5..36 with 36
twice where he said 4..36. For each block, the median |heard - published| of its words is measured against the
aligner's reading as labelled and one word on (each word against its nearest heard occurrence, so repeats do not
mislead). build.py relabels a block that clearly fits one word on, and gives an ayah that fits neither way the
aligner's own words. Without keys: every ayah whose last label is listed twice and that goes back, or starts after
word 1 -- the signature, 223 of his ayahs. (Other reciters' exports, sampled, are labelled right.)
"""
from __future__ import annotations

import statistics
import sys

import common


def signature(timing: dict) -> bool:
    labels = [s[0] for s in sorted(timing["segments"], key=lambda s: s[1])]
    goes_back = any(b < a for a, b in zip(labels, labels[1:]))
    return len(labels) >= 2 and labels[-1] == labels[-2] and (goes_back or labels[0] != 1)


def candidates(who: str) -> list[str]:
    return sorted((key for key, timing in common.qul(who).items() if signature(timing)), key=common.by_key)


def blocks(segments: list) -> list[list]:
    ordered = sorted(segments, key=lambda s: s[1])
    cuts = [0] + [i for i in range(1, len(ordered)) if ordered[i][0] < ordered[i - 1][0]] + [len(ordered)]
    return [ordered[a:b] for a, b in zip(cuts, cuts[1:])]


def fit(block: list, heard: dict[int, list[float]], shift: int) -> float | None:
    gaps = [min(abs(at - start / 1000) for at in heard[index - 1 - shift]) for index, start, *_ in block if heard.get(index - 1 - shift)]
    return round(statistics.median(gaps), 2) if gaps else None


def check(who: str, key: str) -> str:
    surah, ayah = common.by_key(key)
    timing = common.qul(who)[key]
    passage = common.load(who, surah, ayah, ayah)
    reading = common.align(passage, timing["timestamp_from"] / 1000 - 4, timing["timestamp_to"] / 1000 + 1)
    heard: dict[int, list[float]] = {}
    for word in (w for w in reading.get("words", []) if w["verse_key"] == key):
        heard.setdefault(word["word_index"], []).append(word["start"])
    parts = [f"{b[0][0]}..{b[-1][0]}({len(b)}): {fit(b, heard, 0)}/{fit(b, heard, 1)}" for b in blocks(timing["segments"])]
    return f"{key} words {len(passage['verses'][0]['words'])} coverage {reading.get('referenceCoverage')} {' | '.join(parts)}"


def main(who: str, keys: list[str]) -> None:
    done = {line.split()[0] for line in common.read_lines(who, "labels.txt")}

    def report(line: str) -> None:
        common.append_line(who, "labels.txt", line)
        print(line, flush=True)

    common.each(keys or candidates(who), done, lambda key: check(who, key), report)


if __name__ == "__main__":
    main(common.reciter(sys.argv[1]), sys.argv[2:])
