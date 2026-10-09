"""Ayahs starting well after the ayah before ends: is the opening heard in the gap?

    asr-service/.venv/bin/python scripts/reciters/gaps.py shatri qul          -> .run/reciters/shatri/gaps.jsonl
    asr-service/.venv/bin/python scripts/reciters/gaps.py yasser quran.com    (quran.com's timings, from its API)

QUL's exports tile a recording, each ayah starting where the one before ends, so a gap of seconds between them is
audio the export gives to no ayah. Al-Shatri's 3:91 begins ten seconds before its listed start, in such a gap. For
every ayah starting over GAP after the ayah before ends: `moved` where the phoneme model clearly hears its opening in
the gap (cost <= 0.2), else `kept`. Every move is to be listened to (listen.py) before it is used -- the opening may be
words the ayah before also says.

2026-10-09: 267 gaps across every export; 24 moved (Abdul Basit 13, Al-Shatri 9, Al-Ghamdi 1, Al-Tunaiji 1).
"""
from __future__ import annotations

import json
import sys
import urllib.request

import common

GAP = 1.5
SURE = 0.2
#: quran.com's ids for the reciters it times.
QURAN_COM = {"sudais": 3, "yasser": 97, "shuraim": 10}


def from_qul(who: str, pairs: dict) -> dict[str, tuple[float, float]]:
    return {key: (t["timestamp_from"] / 1000, t["timestamp_to"] / 1000) for key, t in common.qul(who).items()
            if pairs.get(key.split(":")[0]) in (None, "qul")}


def from_quran_com(who: str, surah: int) -> dict[str, tuple[float, float]]:
    api = f"https://api.qurancdn.com/api/qdc/audio/reciters/{QURAN_COM[who]}/audio_files?chapter={surah}&segments=true"
    request = urllib.request.Request(api, headers={"User-Agent": "QuranClipper reciter tools"})
    verses = json.load(urllib.request.urlopen(request, timeout=60))["audio_files"][0]["verse_timings"]
    return {v["verse_key"]: (v["timestamp_from"] / 1000, v["timestamp_to"] / 1000) for v in verses}


def timings(who: str, source: str) -> dict[str, tuple[float, float]]:
    """Each ayah's (start, end) in seconds, from the source the studio uses for the surah."""
    pairs = json.loads((common.LIB / "timingPairs.json").read_text()).get(who, {})
    if source == "qul":
        return from_qul(who, pairs)
    spans: dict[str, tuple[float, float]] = {}
    for surah in (s for s in range(1, 115) if pairs.get(str(s)) in (None, "quran.com")):
        spans.update(from_quran_com(who, surah))
    return spans


def gap_check(ear: common.Ear, who: str, key: str, q: float, ended: float) -> dict:
    surah, _ = common.by_key(key)
    inside = [(o, c) for o, c in ear.scan(who, surah, key, ended - 0.3, q - 0.6) if ended - 0.3 <= o < q - 0.6 and c <= SURE]
    return {"key": key, "q": q, "prevTo": ended, "gap": round(q - ended, 2), "inside": inside,
            "status": "moved" if inside else "kept", "start": inside[0][0] if inside else q}


def main(who: str, source: str) -> None:
    ear = common.Ear()
    done = {record["key"] for record in common.read_records(who, "gaps.jsonl")}
    spans = timings(who, source)
    before = lambda key: spans.get(f"{common.by_key(key)[0]}:{common.by_key(key)[1] - 1}")
    keys = [k for k in sorted(spans, key=common.by_key) if before(k) and spans[k][0] - before(k)[1] > GAP]

    def report(record: dict) -> None:
        common.add_record(who, "gaps.jsonl", record)
        print(who, record["key"], record["status"], round(record["q"], 2), "->", record["start"], "gap", record["gap"], flush=True)

    common.each(keys, done, lambda key: gap_check(ear, who, key, spans[key][0], before(key)[1]), report)


if __name__ == "__main__":
    main(common.reciter(sys.argv[1]), sys.argv[2] if len(sys.argv) > 2 else "qul")
