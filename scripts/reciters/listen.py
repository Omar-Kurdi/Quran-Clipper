"""What the phoneme model hears, for checking a timing by ear before it is used.

    asr-service/.venv/bin/python scripts/reciters/listen.py span jalil 82 0 26          # a stretch, marked every second
    asr-service/.venv/bin/python scripts/reciters/listen.py moves jalil                 # every start the tools moved
    asr-service/.venv/bin/python scripts/reciters/listen.py region jalil 44 43-49       # every caption of a region

`moves` and `region` print, for each, the words that should begin there and what is heard from there: they must be
the same words. Where an ayah opens with words the ayah before also says, listen on past them (`span`).
"""
from __future__ import annotations

import sys

import common
from build import starts


def decoded(ear: common.Ear, who: str, surah: int, span: tuple[float, float], *, marks: bool = True) -> str:
    symbols, frames = ear.heard(who, surah, *span)
    names = {v: k for k, v in ear.model.tokens.items()}
    out, last = "", -9.0
    for symbol, frame in zip(symbols, frames):
        at = span[0] + frame * 0.04
        if marks and at - last >= 1.0:
            out, last = out + f" [{at:.1f}] ", at
        out += names.get(symbol, "?")
    return out


def moves(ear: common.Ear, who: str) -> None:
    moved = [(k, r) for k, r in starts(who).items() if r.get("status") in ("found", "twice")]
    for key, record in sorted(moved, key=lambda kv: common.by_key(kv[0])):
        surah, ayah = common.by_key(key)
        words = " ".join(w["arabic"] for w in common.load(who, surah, ayah, ayah)["verses"][0]["words"][:3])
        heard = decoded(ear, who, surah, (record["start"] - 1, record["start"] + 3))
        print(key, f"{record.get('q', 0):.1f} -> {record['start']:.1f}", "|", words, "|", heard, flush=True)


def region(ear: common.Ear, who: str, surah: int, ayahs: str) -> None:
    held = (common.read_json(who, "regions.json") or {})[str(surah)]
    stretch = next(r for r in held if r["ayahs"] == list(map(int, ayahs.split("-"))))
    passage = common.load(who, surah, stretch["ayahs"][0], stretch["ayahs"][1])
    text = {v["verseKey"]: [w["arabic"] for w in v["words"]] for v in passage["verses"]}
    for c in stretch["segments"]:
        words = " ".join(text[c["verseKey"]][c["startWordIndex"]:c["startWordIndex"] + 3])
        heard = decoded(ear, who, surah, (c["startTime"] - 0.3, c["startTime"] + 3), marks=False)[:40]
        print(f"{c['verseKey']} {c['startTime']:.1f}-{c['endTime']:.1f} w{c['startWordIndex']}-{c['endWordIndex']} | {words} | {heard}", flush=True)


if __name__ == "__main__":
    what, who_ = sys.argv[1], common.reciter(sys.argv[2])
    ear_ = common.Ear()
    if what == "span":
        print(decoded(ear_, who_, int(sys.argv[3]), (float(sys.argv[4]), float(sys.argv[5]))))
    elif what == "moves":
        moves(ear_, who_)
    else:
        region(ear_, who_, int(sys.argv[3]), sys.argv[4])
