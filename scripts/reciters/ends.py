"""Ayahs listed as ending while the reciter is still holding their last word.

    asr-service/.venv/bin/python scripts/reciters/ends.py muaiqly [surahs]   -> .run/reciters/muaiqly/ends/s<surah>.json

An export that ends each ayah where its last word's syllables end, and leaves the pause to no ayah, can stop an ayah
while its final madd is still being held: Al-Muaiqly's 1:5 is listed to 36.43s, and his نَسْتَعِينُ is held to 37.96s,
so its caption went out a second and a half before he finished. Where the ayah after starts over GAP later, the
recording's loudness is followed from the listed end: voice heard on, without a pause, for over HELD seconds is the word
still being held. Status
  held    the voice stops before the next ayah's listed start: build.py ends the ayah there
  review  the voice runs into the next ayah's start -- the next one may start early instead; listen (span)
Loudness only, no model: a held vowel is the loudest thing in a pause, and the threshold is set from each surah's own
speech level, not its noise floor (Al-Muaiqly's last surahs have digital silence between ayahs, and their room tail
read as voice against it).

2026-10-10, Al-Muaiqly 1:5, 36:9, 36:67, 36:73 found by ear first; the rest by this.
"""
from __future__ import annotations

import sys

import common

#: A pause shorter than this after an ayah is not looked in.
GAP = 0.6
#: Voice heard on past the listed end for longer than this is the last word still held.
HELD = 0.5
#: Loudness is read in frames of this many seconds.
HOP = 0.02
#: Below the surah's speech level (its 70th percentile frame) by more than this is not voice.
BELOW_SPEECH = 20.0
#: A dip of this many frames ends the voice.
DIP = 5


def loudness(pcm: object) -> tuple[list[float], float]:
    """Each frame's level in dB, and the level below which a frame is not voice."""
    import numpy as np
    width = int(HOP * 16000)
    frames = np.asarray(pcm)[: len(pcm) // width * width].reshape(-1, width)
    db = 20 * np.log10(np.sqrt((frames ** 2).mean(axis=1)) + 1e-9)
    return db.tolist(), max(float(np.percentile(db, 10)) + 15, float(np.percentile(db, 70)) - BELOW_SPEECH)


def voiced_until(db: list[float], threshold: float, start: float, stop: float) -> float:
    """From `start`, until when voice goes on without a pause, looking no further than `stop` (seconds)."""
    i, last, dip = int(start / HOP), int(start / HOP), 0
    while i < min(int(stop / HOP), len(db)):
        if db[i] > threshold:
            last, dip = i, 0
        else:
            dip += 1
            if dip >= DIP:
                break
        i += 1
    return round((last + 1) * HOP, 2)


def check(db: list[float], threshold: float, key: str, end: float, following: float) -> dict:
    until = voiced_until(db, threshold, end, following)
    status = "kept" if until - end <= HELD else ("review" if until >= following - 0.1 else "held")
    return {"key": key, "to": end, "next": following, "voicedTo": until, "status": status}


def surah(ear: common.Ear, who: str, number: int) -> list[dict]:
    export = common.qul(who)
    pairs = [(f"{number}:{a}", f"{number}:{a + 1}") for a in range(1, common.ayah_count(who, number))]
    pairs = [(k, n) for k, n in pairs if k in export and n in export
             and export[n]["timestamp_from"] - export[k]["timestamp_to"] >= GAP * 1000]
    if not pairs:
        return []
    db, threshold = loudness(ear.pcm(who, number))
    return [check(db, threshold, k, export[k]["timestamp_to"] / 1000, export[n]["timestamp_from"] / 1000) for k, n in pairs]


def report(who: str, records: list[dict]) -> None:
    for record in (r for r in records if r["status"] != "kept"):
        print(who, record["key"], record["status"], record["to"], "->", record["voicedTo"], "next", record["next"], flush=True)


def main(who: str, surahs: list[int]) -> None:
    ear = common.Ear()
    for number in (n for n in surahs if common.read_json(who, f"s{n}.json", folder="ends") is None):
        records = surah(ear, who, number)
        common.write_json(who, f"s{number}.json", records, folder="ends")
        report(who, records)


if __name__ == "__main__":
    main(common.reciter(sys.argv[1]), [int(s) for s in sys.argv[2:]] or list(range(1, 115)))
