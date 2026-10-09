"""After an ayah's start moved earlier, its old published span may hold the NEXT ayah's first reading.

    asr-service/.venv/bin/python scripts/reciters/cascade.py jalil   -> .run/reciters/jalil/cascade.jsonl

Khalid al-Jalil's 82:3 is listed over his first 82:4: once 82:3 was found to start earlier, its listed span still held
82:4's opening, which starts.py never looked in. For each moved ayah k, k+1's opening is looked for in
[k's published start, k+1's published start - 0.6] (cost <= 0.2), and a move found there is followed in turn.
Every move is to be listened to (listen.py): two of the first five found were the ayah before's own words, which the
next ayah opens with too (Al-Shatri's 2:107, Jalil's 29:54) -- see decisions.json.
"""
from __future__ import annotations

import sys

import common
from build import moves

SURE = 0.2


def following(ear: common.Ear, who: str, key: str) -> dict | None:
    """Whether the ayah after `key` is heard beginning inside `key`'s published span."""
    surah, ayah = common.by_key(key)
    export = common.qul(who)
    after = f"{surah}:{ayah + 1}"
    if after not in export:
        return None
    low, q = export[key]["timestamp_from"] / 1000, export[after]["timestamp_from"] / 1000
    if q - 0.6 <= low:
        return None
    hits = [(o, c) for o, c in ear.scan(who, surah, after, low - 0.3, q - 0.6) if low - 0.3 <= o < q - 0.6 and c <= SURE]
    return {"key": after, "after": key, "q": q, "status": "moved" if hits else "kept", "start": hits[0][0] if hits else q, "hits": hits[:3]}


def main(who: str) -> None:
    ear = common.Ear()
    common.remove(who, "cascade.jsonl")
    queue = sorted(moves(who, cascade=False), key=common.by_key)
    seen: set[str] = set()
    while queue:
        key = queue.pop(0)
        record = following(ear, who, key) if key not in seen else None
        seen.add(key)
        if not record:
            continue
        common.add_record(who, "cascade.jsonl", record)
        print(who, record["key"], record["status"], record["q"], "->", record["start"], "after", key, flush=True)
        if record["status"] == "moved":
            queue.insert(0, record["key"])


if __name__ == "__main__":
    main(common.reciter(sys.argv[1]))
