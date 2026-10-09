"""A second opinion on starts the phoneme model could not confirm (starts.py's unresolved, nothing heard near).

    asr-service/.venv/bin/python scripts/reciters/second.py jalil [key ...]   -> .run/reciters/jalil/second.jsonl

The aligner reads the ayah before and the ayah together. Where it hears the ayah begin over a second before its
published start, the start moves there if the phoneme model also hears the opening (status `moved`, cost <= 0.25), or
-- since an opening run on from the word before matches loosely -- if it hears it more loosely (<= 0.35) and does NOT
hear it at the published start (`loose`). The second condition is what keeps the aligner's own early starts out: it
can put an ayah's first word a second or more early (Jalil's 21:20, 38:22) where the phoneme model hears the opening at
the published start. Every `moved` and `loose` start is to be listened to (listen.py) before it is used.

Without keys: every unresolved start in .run/reciters/<reciter>/starts with nothing heard within 1.5s of it.
"""
from __future__ import annotations

import sys

import common

SURE = 0.25
LOOSE = 0.35


def heard_near(record: dict) -> bool:
    heard = [o for o, _ in record.get("near", [])] + [o for o, _ in record.get("heard") or []]
    return any(-0.6 <= o - record["q"] <= 1.5 for o in heard)


def unconfirmed(who: str) -> list[str]:
    records = [record for surah in common.read_folder(who, "starts") for record in surah]
    return sorted((r["key"] for r in records if r["status"] == "unresolved" and not heard_near(r)), key=common.by_key)


def heard_at_published(ear: common.Ear, who: str, key: str) -> bool:
    surah, _ = common.by_key(key)
    q = common.qul(who)[key]["timestamp_from"] / 1000
    return any(abs(o - q) <= 0.8 for o, _ in ear.openings(who, surah, key, q - 0.8, q + 3.5))


def ruling(ear: common.Ear, who: str, key: str, at: float) -> tuple[str, float] | None:
    """Whether the phoneme model bears the aligner out at `at`: ('moved' | 'loose', start) or None."""
    surah, _ = common.by_key(key)
    near = [(o, c) for o, c in ear.scan(who, surah, key, at - 0.8, at + 1.5) if abs(o - at) <= 0.8]
    sure = [o for o, c in near if c <= SURE]
    if sure:
        return "moved", round(min(at, sure[0]), 3)
    loose = [o for o, c in near if c <= LOOSE]
    return ("loose", round(min(at, loose[0]), 3)) if loose and not heard_at_published(ear, who, key) else None


def opinion(ear: common.Ear, who: str, key: str) -> dict:
    surah, ayah = common.by_key(key)
    export = common.qul(who)
    q = export[key]["timestamp_from"] / 1000
    record = {"key": key, "q": q, "status": "kept", "start": q}
    if f"{surah}:{ayah - 1}" not in export:
        return record
    passage = common.load(who, surah, ayah - 1, ayah)
    heard = common.first_heard(common.align(passage, export[f"{surah}:{ayah - 1}"]["timestamp_from"] / 1000 - 1, q + 6), key)
    record["aligner"] = heard[:3]
    found = ruling(ear, who, key, heard[0]) if heard and heard[0] < q - 1.0 else None
    return {**record, "status": found[0], "start": found[1]} if found else record


def main(who: str, keys: list[str]) -> None:
    ear = common.Ear()
    done = {record["key"] for record in common.read_records(who, "second.jsonl")}

    def report(record: dict) -> None:
        common.add_record(who, "second.jsonl", record)
        print(record["key"], record["status"], record["q"], "->", record["start"], record.get("aligner"), flush=True)

    common.each(keys or unconfirmed(who), done, lambda key: opinion(ear, who, key), report)


if __name__ == "__main__":
    main(common.reciter(sys.argv[1]), sys.argv[2:])
