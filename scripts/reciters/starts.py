"""Every ayah start of a reciter's QUL export, checked by the phoneme model alone.

    asr-service/.venv/bin/python scripts/reciters/starts.py jalil 1 2 3 ...   -> .run/reciters/jalil/starts/s<surah>.json

Each ayah gets a status:
  agree       its opening is heard at the published start
  twice       heard there, and earlier inside the long last word of the ayah before: the export lists the second reading
  found       not heard there, but clearly heard earlier, after the ayah before's last word began
  unresolved  neither -- the published start stays. Those heard 0.6-1.5s after it are confirmed in effect (the model
              hears an opening a little after it begins); the rest go to second.py.

A start is only ever moved earlier here: the fault this looks for is an opening folded into the ayah before. Moving
later is both.py's, with the aligner to agree.

Khalid al-Jalil's 6,236 ayahs (2026-10-09): 4,685 agree, 1,109 heard within 1.5s after, 59 moved, 383 unconfirmed.
(Surahs 1, 4 and the start of 2 ran with LONG_LAST at 1.2s; the rest at 2.0s, which every fold found also met.)
"""
from __future__ import annotations

import sys

import common

#: Highest cost at which a hearing may move a start.
SURE = 0.2
#: A last word of the ayah before longer than this may hold this ayah's first reading.
LONG_LAST = 2.0


def last_word(who: str, key: str) -> tuple[float | None, float]:
    """When the ayah before's last listed word starts, and how long it runs to that ayah's end, in seconds."""
    surah, ayah = common.by_key(key)
    before = common.qul(who).get(f"{surah}:{ayah - 1}")
    if not before or not before.get("segments"):
        return None, 0.0
    start = max([s[1] for s in common.words_of(before)] + [before["timestamp_from"]]) / 1000
    return start, before["timestamp_to"] / 1000 - start


def earlier_reading(ear: common.Ear, who: str, key: str, q: float) -> list[float]:
    """Where the opening is clearly heard inside the ayah before's long last word, if it is long."""
    start, length = last_word(who, key)
    if length <= LONG_LAST:
        return []
    surah, _ = common.by_key(key)
    return [o for o, c in ear.scan(who, surah, key, start - 0.3, q - 0.6) if start <= o < q - 0.6 and c <= SURE]


def found_elsewhere(ear: common.Ear, who: str, key: str, q: float) -> dict:
    """Not heard at the published start: heard clearly earlier, after the ayah before's last word began?"""
    surah, _ = common.by_key(key)
    start, _ = last_word(who, key)
    floor = start if start is not None else max(0.0, q - 4)
    heard = ear.scan(who, surah, key, max(0.0, floor - 0.3), q + 3)
    sure = [o for o, c in heard if floor <= o < q - 0.6 and c <= SURE]
    return {"status": "found" if sure else "unresolved", "start": sure[0] if sure else q, "heard": heard}


def check(ear: common.Ear, who: str, key: str) -> dict:
    surah, _ = common.by_key(key)
    q = common.qul(who)[key]["timestamp_from"] / 1000
    near = ear.openings(who, surah, key, q - 0.8, q + 3.5)
    earlier = earlier_reading(ear, who, key, q)
    record = {"key": key, "q": q, "near": near}
    if any(abs(o - q) <= 0.6 for o, _ in near):
        return {**record, "status": "twice" if earlier else "agree", "start": earlier[0] if earlier else q}
    if earlier:
        return {**record, "status": "found", "start": earlier[0]}
    return {**record, **found_elsewhere(ear, who, key, q)}


def surah_done(who: str, surah: int, records: list[dict]) -> None:
    common.write_json(who, f"s{surah}.json", records, folder="starts")
    counts: dict[str, int] = {}
    for record in records:
        counts[record["status"]] = counts.get(record["status"], 0) + 1
    print(who, surah, counts, flush=True)


def main(who: str, surahs: list[int]) -> None:
    ear = common.Ear()
    for surah in surahs:
        if common.read_json(who, f"s{surah}.json", folder="starts") is None:
            surah_done(who, surah, [check(ear, who, f"{surah}:{a}") for a in range(1, common.ayah_count(who, surah) + 1)])


if __name__ == "__main__":
    main(common.reciter(sys.argv[1]), [int(s) for s in sys.argv[2:]] or list(range(1, 115)))
