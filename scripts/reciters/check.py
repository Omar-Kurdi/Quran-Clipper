"""The studio's captions for random reciter passages, as the studio makes them, checked against an independent reading.

    asr-service/.venv/bin/python scripts/reciters/check.py run muaiqly,jalil 15 <seed>   -> .run/reciters/checks/<seed>.jsonl
    asr-service/.venv/bin/python scripts/reciters/check.py one jalil 74:8-11

For each passage: the load (/api/quran/verses) and the match (/api/audio/match, published timing) exactly as the studio
sends them; then the sidecar's own reading of the passage with an ayah either side, its window from the ayah before.
A passage is flagged on:
  MISSING / ORDER  an ayah absent, or ayahs out of order
  SHORT            a caption under 0.3s
  BREAK            a caption ending inside an ayah where no stop sign is and the reciter did not go back
  LATE             an ayah's caption starting over 0.6s after its first word is heard
  OVERLAP          an ayah's caption starting before the previous ayah's last word is even heard starting
  NOALIGN          the studio left the aligner's reading out: no pauses, restarts or drift correction
  UNSHOWN          words of an ayah on none of its captions

The independent reading is the same aligner, so a flag is a lead, not a verdict: it mixes up Ar-Rahman's refrains and
neighbouring ayahs that open alike. Each one is to be listened to (listen.py) before anything is changed.
"""
from __future__ import annotations

import json
import random
import re
import sys
import urllib.error
import urllib.request
import uuid

import common

STOP = re.compile("[ۖۗۘۚۛ]\\s*$")
WORDS, EXCLUDED, KEY = "words", "excluded", "verseKey"
AYAHS = [7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128, 111, 110, 98, 135, 112, 78, 118, 64,
         77, 227, 93, 88, 69, 60, 34, 30, 73, 54, 45, 83, 182, 88, 75, 85, 54, 53, 89, 59, 37, 35, 38, 29, 18, 45, 60, 49,
         62, 55, 78, 96, 29, 22, 24, 13, 14, 11, 11, 18, 12, 12, 30, 52, 52, 44, 28, 28, 20, 56, 40, 31, 50, 40, 46, 42,
         29, 19, 36, 25, 22, 17, 19, 26, 30, 20, 15, 21, 11, 8, 8, 19, 5, 8, 8, 11, 11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4,
         5, 6]


def match(who: str, span: tuple[int, int, int], passage: dict) -> dict:
    """The studio's match of the passage, sent as the studio sends it (its window padded as `alignWindowFor` pads)."""
    surah, start, end = span
    verses = passage["verses"]
    pad = min(90, max(10, (verses[-1]["endTime"] - verses[0]["startTime"]) * 0.15))
    fields = {"audioUrl": common.recording(passage), "windowStart": max(0.0, verses[0]["startTime"] - pad),
              "windowEnd": verses[-1]["endTime"] + pad, "timing": "published", "reciter": who, "provider": "align",
              "surah": surah, "start": start, "end": end}
    boundary = uuid.uuid4().hex
    body = "".join(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n' for k, v in fields.items())
    request = urllib.request.Request(common.STUDIO + "/api/audio/match", data=(body + f"--{boundary}--\r\n").encode(),
                                     headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    try:
        return json.load(urllib.request.urlopen(request, timeout=900))
    except urllib.error.HTTPError as error:
        return {"error": f"{error.code} {error.reason}"}


def heard(who: str, surah: int, start: int, end: int) -> tuple[dict, dict]:
    """Where the sidecar, reading the passage with an ayah either side, heard each ayah's first and last word."""
    first, last = max(1, start - 1), min(AYAHS[surah - 1], end + 1)
    around = common.load(who, surah, first, last)
    low = 0.0 if first == 1 else around["verses"][0]["startTime"] - 1.0
    words = common.align(around, low, around["verses"][-1]["endTime"] + 1.0).get(WORDS, [])
    first_word = {}
    for word in words:
        first_word.setdefault(word["verse_key"], word["start"])
    return first_word, {word["verse_key"]: word["start"] for word in words}


def shown(caption: dict) -> list[int]:
    return [i for i, w in enumerate(caption.get(WORDS) or []) if not w.get(EXCLUDED)]


def breaks(captions: list[dict], text: dict) -> list[str]:
    found = []
    for before, after in ((b, a) for b, a in zip(captions, captions[1:]) if b[KEY] == a[KEY]):
        word = text[before[KEY]][shown(before)[-1]] if shown(before) else ""
        if not STOP.search(word) and not shown(after)[:1] <= shown(before)[-1:]:
            found.append(f"BREAK {before[KEY]} after «{word}»")
    return found


def timing_flags(order: list[str], captions: list[dict], first_word: dict, last_word: dict) -> list[str]:
    found = []
    for key in order:
        start = next(c["startTime"] for c in captions if c[KEY] == key)
        surah, ayah = common.by_key(key)
        before = last_word.get(f"{surah}:{ayah - 1}")
        if key in first_word and start - first_word[key] > 0.6:
            found.append(f"LATE {key} caption {start} heard {round(first_word[key], 2)}")
        if before is not None and start < before:
            found.append(f"OVERLAP {key} caption {start} before the previous ayah's last word at {round(before, 2)}")
    return found


def ordering(order: list[str], keys: list[str]) -> list[str]:
    missing = [f"MISSING {k}" for k in keys if k not in order]
    return missing + (["ORDER"] if order != [k for k in keys if k in order] else [])


def unshown(captions: list[dict], text: dict) -> list[str]:
    on_screen: dict[str, set] = {}
    for c in captions:
        on_screen.setdefault(c[KEY], set()).update(shown(c))
    left = {k: set(range(len(text[k]))) - ws for k, ws in on_screen.items()}
    return [f"UNSHOWN {k} words {sorted(words)}" for k, words in left.items() if words]


def flags(captions: list[dict], text: dict, keys: list[str], spoken: tuple[dict, dict]) -> list[str]:
    order = list(dict.fromkeys(c[KEY] for c in captions))
    short = [f"SHORT {c[KEY]} {c['startTime']}" for c in captions if c["endTime"] - c["startTime"] < 0.3]
    return ordering(order, keys) + short + unshown(captions, text) + breaks(captions, text) + timing_flags(order, captions, *spoken)


def check(who: str, surah: int, start: int, end: int) -> dict:
    out = {"reciter": who, "passage": f"{surah}:{start}-{end}", "flags": []}
    passage = common.load(who, surah, start, end)
    result = match(who, (surah, start, end), passage)
    if not result.get("success"):
        return {**out, "error": "match: " + str(result.get("error"))[:150]}
    captions = [c for c in result["verses"] if ":" in c[KEY]]
    text = {v[KEY]: [w["arabic"] for w in v[WORDS]] for v in passage["verses"]}
    found = flags(captions, text, [f"{surah}:{v}" for v in range(start, end + 1)], heard(who, surah, start, end))
    timed_from = result.get("timedFrom")
    found += ["NOALIGN"] if result.get("pausesFromAudio") is False and timed_from != "measured" else []
    return {**out, "flags": found, "timedFrom": timed_from, "captions": [(c[KEY], c["startTime"], c["endTime"]) for c in result["verses"]]}


def passage_at(rnd: random.Random) -> tuple[int, int, int]:
    surah = rnd.choices(range(1, 115), weights=AYAHS)[0]
    length = min(AYAHS[surah - 1], rnd.randint(2, 5))
    start = rnd.randint(1, AYAHS[surah - 1] - length + 1)
    return surah, start, start + length - 1


def checked(who: str, surah: int, start: int, end: int) -> dict:
    try:
        return check(who, surah, start, end)
    except (OSError, ValueError, KeyError) as error:  # a passage that fails to check is reported, not fatal
        return {"reciter": who, "passage": f"{surah}:{start}-{end}", "error": repr(error)[:200]}


def run(reciters: list[str], count: int, seed: int) -> None:
    rnd = random.Random(seed)
    for who, (surah, start, end) in [(who, passage_at(rnd)) for who in reciters for _ in range(count)]:
        record = checked(who, surah, start, end)
        common.add_record("checks", f"{seed}.jsonl", record)
        print(record["reciter"], record["passage"], record.get("timedFrom"), record.get("flags"), record.get("error", ""), flush=True)


if __name__ == "__main__":
    if sys.argv[1] == "one":
        surah_, span_ = sys.argv[3].split(":")
        print(json.dumps(check(common.reciter(sys.argv[2]), int(surah_), *map(int, span_.split("-"))), ensure_ascii=False))
    else:
        run([common.reciter(name) for name in sys.argv[2].split(",")], int(sys.argv[3]), int(sys.argv[4]))
