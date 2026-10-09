"""Ayah starts checked both ways, where the export's stretched words hide the boundary.

    asr-service/.venv/bin/python scripts/reciters/both.py jalil [key ...]   -> .run/reciters/jalil/both.jsonl

Khalid al-Jalil's 27:88 is listed ten seconds late, its first reading inside 27:87's word 17 -- before the last word
starts.py looks in -- and 3:31 five seconds early, his repeat of 3:30's end counted as its first word. Without keys,
every ayah whose ayah before has a word over 3s among its last three, or whose own first word runs over 2.5s, or whose
opening starts.py heard 1.5-10s after its published start.

The aligner reads around the boundary, the ayah before and the ayah together (from three words before the ayah before
ends to ten seconds in). Where it hears the ayah begin over a second away from published:
  moved   the phoneme model hears the opening there (cost <= 0.2), and for a later start not at the published one
  loose   earlier, heard more loosely (<= 0.35), not at the published start
  review  either, but the ayah opens on words the ayah before also says: only listening can tell
Every one is to be listened to (listen.py) before it is used.
"""
from __future__ import annotations

import re
import sys

import common

SURE = 0.2
LOOSE = 0.35


def plain(words: list[dict]) -> str:
    return " ".join(re.sub(r"[ً-ٰٟۖ-ۭـ\s]", "", word["arabic"]) for word in words)


def stretched(who: str, key: str) -> bool:
    """A word over 3s among the ayah before's last three, or the ayah's own first word over 2.5s."""
    surah, ayah = common.by_key(key)
    before = common.qul(who).get(f"{surah}:{ayah - 1}")
    words = common.words_of(common.qul(who)[key])
    long_before = bool(before) and any(s[2] - s[1] > 3000 for s in common.words_of(before)[-3:])
    return long_before or bool(words and words[0][0] == 1 and words[0][2] - words[0][1] > 2500)


def heard_late(who: str) -> set[str]:
    records = [record for surah in common.read_folder(who, "starts") for record in surah]
    return {r["key"] for r in records if r["status"] == "unresolved"
            and any(1.5 < o - r["q"] < 10 and c <= SURE for o, c in r.get("heard") or [])}


def candidates(who: str) -> list[str]:
    return sorted({key for key in common.qul(who) if stretched(who, key)} | heard_late(who), key=common.by_key)


def window(who: str, key: str) -> tuple[float, float]:
    surah, ayah = common.by_key(key)
    before, this = common.qul(who)[f"{surah}:{ayah - 1}"], common.qul(who)[key]
    start = min([s[1] for s in common.words_of(before)[-3:]] + [before["timestamp_to"] - 6000]) / 1000 - 3
    return max(start, before["timestamp_from"] / 1000 - 1), min(this["timestamp_to"] / 1000 + 1, this["timestamp_from"] / 1000 + 10)


def hearings(ear: common.Ear, who: str, key: str, at: float) -> tuple[list[float], list[float], bool]:
    """Where the opening is heard near `at`, surely and loosely, and whether it is heard at the published start."""
    surah, _ = common.by_key(key)
    q = common.qul(who)[key]["timestamp_from"] / 1000
    near = [(o, c) for o, c in ear.scan(who, surah, key, at - 0.8, at + 1.5) if abs(o - at) <= 0.8]
    at_published = any(abs(o - q) <= 0.8 for o, _ in ear.openings(who, surah, key, q - 0.8, q + 3.5))
    return [o for o, c in near if c <= SURE], [o for o, c in near if c <= LOOSE], at_published


def verdict(ear: common.Ear, who: str, key: str, passage: dict, at: float) -> tuple[str, float] | None:
    q = common.qul(who)[key]["timestamp_from"] / 1000
    sure, loose, at_published = hearings(ear, who, key, at)
    shared = plain(passage["verses"][1]["words"][:2]) in plain(passage["verses"][0]["words"])
    if sure and (at < q or not at_published):
        return ("review" if shared else "moved"), round(min(at, sure[0]), 3)
    earlier_loosely = loose and at < q and not at_published
    return ("loose", round(min(at, loose[0]), 3)) if earlier_loosely else None


def check(ear: common.Ear, who: str, key: str) -> dict:
    surah, ayah = common.by_key(key)
    q = common.qul(who)[key]["timestamp_from"] / 1000
    record = {"key": key, "q": q, "status": "kept", "start": q}
    if f"{surah}:{ayah - 1}" not in common.qul(who):
        return record
    passage = common.load(who, surah, ayah - 1, ayah)
    heard = common.first_heard(common.align(passage, *window(who, key)), key)
    record["aligner"] = heard[:3]
    found = verdict(ear, who, key, passage, heard[0]) if heard and abs(heard[0] - q) > 1.0 else None
    return {**record, "status": found[0], "start": found[1]} if found else record


def main(who: str, keys: list[str]) -> None:
    ear = common.Ear()
    done = {record["key"] for record in common.read_records(who, "both.jsonl")}

    def report(record: dict) -> None:
        common.add_record(who, "both.jsonl", record)
        print(record["key"], record["status"], record["q"], "->", record["start"], flush=True)

    common.each(keys or candidates(who), done, lambda key: check(ear, who, key), report)


if __name__ == "__main__":
    main(common.reciter(sys.argv[1]), sys.argv[2:])
