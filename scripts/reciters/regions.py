"""Where a reciter reads on into later ayahs and goes back over them, the aligner's reading of the stretch as captions.

    asr-service/.venv/bin/python scripts/reciters/regions.py jalil 82:16
    asr-service/.venv/bin/python scripts/reciters/regions.py jalil "44:42@text=42-50@window=384-494@region=43-49"
        -> .run/reciters/jalil/regions.json; build.py writes them to src/lib/measuredRegions.json

Khalid al-Jalil reads 82:17-19 and then all three again; per-ayah timings give each one span and cannot say so.
Given the whole stretch's text, the aligner follows him back. Each argument is an ayah whose published span holds the
next ayah's opening; the stretch read is a-1..a+3 over its published span unless `text=`/`window=` say otherwise, and
the region is from the first ayah gone back to through the furthest reached, unless `region=` says. The aligner's
reading shifts with the window: every caption of every region is to be listened to (listen.py region ...), and any
correction by hand recorded in decisions.json ("regions"), which this applies.

2026-10-09, Jalil: 23:99-100, 24:39-40, 43:67-68, 44:38-39, 44:43-49, 82:17-19. 9:128, 17:17, 18:103 and 56:26 looked
like it and are repeats inside one ayah.
"""
from __future__ import annotations

import sys

import common


def ayah_of(segment: dict) -> int:
    return int(segment["verse_key"].split(":")[1])


def stretch(who: str, key: str, given: dict[str, str]) -> tuple[dict, dict]:
    surah, ayah = common.by_key(key)
    export = common.qul(who)
    first, last = map(int, given["text"].split("-")) if "text" in given else (max(1, ayah - 1), min(ayah + 3, common.ayah_count(who, surah)))
    start, end = export[f"{surah}:{first}"]["timestamp_from"] / 1000 - 1, export[f"{surah}:{last}"]["timestamp_to"] / 1000 + 2
    if "window" in given:
        start, end = map(float, given["window"].split("-"))
    passage = common.load(who, surah, first, last)
    return passage, common.align(passage, start, end)


def gone_back(segments: list[dict]) -> tuple[int, int] | None:
    """The first ayah gone back to and the furthest reached before, or None if the reading never goes back."""
    reached, first, last = 0, None, 0
    for segment in segments:
        if ayah_of(segment) < reached:
            first, last = min(first or ayah_of(segment), ayah_of(segment)), max(last, reached)
        reached = max(reached, ayah_of(segment))
    return (first, last) if first is not None else None


def caption(reading: dict, surah: int, segment: dict) -> dict:
    timings = [{"index": w["word_index"], "start": round(w["start"], 3), "end": round(w["end"], 3)} for w in reading["words"]
               if w["verse_key"] == segment["verse_key"] and segment["start"] - 0.05 <= w["start"] < segment["end"]
               and segment["start_word"] <= w["word_index"] <= segment["end_word"]]
    out = {"verseKey": segment["verse_key"], "surahNumber": surah, "verseNumber": ayah_of(segment),
           "startTime": round(segment["start"], 3), "endTime": round(segment["end"], 3),
           "startWordIndex": segment["start_word"], "endWordIndex": segment["end_word"], "confidence": 1, "wordTimings": timings}
    return {**out, "notes": "restarted phrase"} if segment.get("is_restart") else out


def captions(reading: dict, surah: int, first: int, last: int) -> list[dict]:
    inside = [s for s in reading["segments"] if first <= ayah_of(s) <= last]
    start = min(s["start"] for s in inside if ayah_of(s) == first)
    end = max(s["end"] for s in inside if ayah_of(s) == last)
    return [caption(reading, surah, s) for s in inside if start - 0.01 <= s["start"] < end]


def split(segments: list[dict], surah: int, at: dict) -> None:
    """A caption split where listening found an ayah folded into it (decisions.json, "regions")."""
    i = next(k for k, c in enumerate(segments) if c["verseKey"] == at["inside"] and c["startTime"] <= at["at"] < c["endTime"])
    whole = segments[i]
    segments[i] = {**whole, "endTime": at["at"], "wordTimings": [w for w in whole["wordTimings"] if w["start"] < at["at"]]}
    segments.insert(i + 1, {"verseKey": at["ayah"], "surahNumber": surah, "verseNumber": int(at["ayah"].split(":")[1]),
                            "startTime": at["at"], "endTime": whole["endTime"], "startWordIndex": 0, "endWordIndex": at["lastWord"],
                            "confidence": 1, "wordTimings": []})


def measure(who: str, item: str) -> None:
    key, *rest = item.split("@")
    given = dict(part.split("=") for part in rest)
    surah, _ = common.by_key(key)
    passage, reading = stretch(who, key, given)
    found = tuple(map(int, given["region"].split("-"))) if "region" in given else gone_back(reading["segments"])
    if not found:
        print(key, "no going back across ayahs heard", flush=True)
        return
    segments = captions(reading, surah, *found)
    for at in common.decisions(who).get("regions", {}).get(f"{surah}:{found[0]}-{found[1]}", []):
        split(segments, surah, at)
    held = common.read_json(who, "regions.json") or {}
    region = {"ayahs": list(found), "audioUrl": common.upstream(passage), "segments": segments}
    held[str(surah)] = [r for r in held.get(str(surah), []) if r["ayahs"] != region["ayahs"]] + [region]
    common.write_json(who, "regions.json", held)
    print(key, "region", f"{surah}:{found[0]}-{found[1]}", [(c["verseKey"], c["startTime"]) for c in segments], flush=True)


if __name__ == "__main__":
    who_ = common.reciter(sys.argv[1])
    for item_ in sys.argv[2:]:
        measure(who_, item_)
