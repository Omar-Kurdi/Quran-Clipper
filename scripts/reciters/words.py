"""The aligner's own words for single ayahs, for build.py to use where the export's are wrong.

    asr-service/.venv/bin/python scripts/reciters/words.py jalil [key ...]   -> .run/reciters/jalil/words/<key>.json

Read with the ayah before as context, from its start to the ayah's end, the text of both given: alone, the aligner has
nothing to put the ayah before's tail on and can start the ayah early. Its first word then also marks where the ayah
begins when the phoneme onset lands a syllable late -- on a long first syllable (Abdul Basit's 6:160, مَنْ held into
جَآءَ) the onset matcher hears the opening from its second.

Without keys: every ayah build.py moves, and every ayah labels.txt finds fitting neither way.
"""
from __future__ import annotations

import sys

import common
from build import moves, starts, unclear_labels

WORDS = "words"


def fetch(who: str, key: str, begins: float) -> dict:
    surah, ayah = common.by_key(key)
    export = common.qul(who)
    first = ayah - 1 if f"{surah}:{ayah - 1}" in export else ayah
    passage = common.load(who, surah, first, ayah)
    start = min(export[f"{surah}:{first}"]["timestamp_from"] / 1000, begins)
    reading = common.align(passage, start - 1, export[key]["timestamp_to"] / 1000 + 1)
    heard = [[w["word_index"], w["start"], w["end"]] for w in reading.get(WORDS, []) if w["verse_key"] == key]
    return {"key": key, "coverage": reading.get("referenceCoverage"), WORDS: heard,
            "wordCount": len(passage["verses"][-1][WORDS]), "context": first != ayah}


def keep(who: str, record: dict) -> None:
    """Store the reading -- unless it lost the ayah and an earlier one is held."""
    held = common.read_json(who, f"{record['key']}.json", folder=WORDS)
    if (record["coverage"] or 0) < 0.95 and held is not None:
        print(record["key"], "coverage", record["coverage"], "kept the earlier reading", flush=True)
        return
    common.write_json(who, f"{record['key']}.json", record, folder=WORDS)
    print(record["key"], "coverage", record["coverage"], "heard", len(record[WORDS]), WORDS, flush=True)


def main(who: str, keys: list[str]) -> None:
    moved = starts(who)
    todo = keys or sorted(set(moves(who)) | set(unclear_labels(who)), key=common.by_key)
    for key in todo:
        keep(who, fetch(who, key, moved.get(key, {}).get("start", 1e12)))


if __name__ == "__main__":
    main(common.reciter(sys.argv[1]), sys.argv[2:])
