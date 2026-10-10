"""The studio's corrections to the QUL exports, built from what the other tools here heard.

    asr-service/.venv/bin/python scripts/reciters/build.py jalil basit shatri ghamdi tunaiji
        -> src/lib/qulCorrections.json (`withCorrections` in qulRecitations.ts), src/lib/measuredRegions.json

From .run/reciters/<reciter>/: where each ayah starts (starts/, gaps, second, cascade, both -- in that order, a later
step's move standing over an earlier one's, except gaps and cascade which only ever move a start earlier), what was
decided by ear (decisions.json: starts heard by ear, moves undone), the word-label fits (labels.txt) and the aligner's
own words (words/), and where each ayah's last word stops being held (ends/). An ayah is corrected when
  - its start moved: it starts there, and the ayah before ends there if it ran past;
  - its last word is held past its listed end (ends.py `held`): it ends where the voice stops;
  - a block of its words fits the recording one word on, clearly (<= FIT, better than as labelled): relabelled;
  - its start moved or a block fits neither way: it takes the aligner's words, when that reading is whole, clamped
    inside the ayah's confirmed bounds.
A start moved later drops the words listed before it -- they were the ayah before's.
"""
from __future__ import annotations

import json
import re
import sys

import common

FIT = 0.35
MOVED = ("found", "twice")
STATUS, MOVE, LOOSE = "status", "moved", "loose"


# -- Where each ayah starts -----------------------------------------------------------------------------------------

def moved_to(held: dict[str, dict], key: str, start: float) -> None:
    held[key] = {**held.get(key, {}), "key": key, STATUS: "found", "start": start}


def apply(held: dict[str, dict], records: list[dict], statuses: tuple[str, ...], *, only_earlier: bool) -> None:
    for record in (r for r in records if r[STATUS] in statuses):
        if not only_earlier or record["start"] < held.get(record["key"], {}).get("start", 1e12):
            moved_to(held, record["key"], record["start"])


def starts(who: str, *, cascade: bool = True) -> dict[str, dict]:
    """Every ayah's start as heard: starts.py's records, with the later tools' moves and the decisions by ear applied."""
    held = {record["key"]: record for surah in common.read_folder(who, "starts") for record in surah}
    apply(held, common.read_records(who, "gaps.jsonl"), (MOVE,), only_earlier=True)
    apply(held, common.read_records(who, "second.jsonl"), (MOVE, LOOSE), only_earlier=False)
    apply(held, common.read_records(who, "cascade.jsonl") if cascade else [], (MOVE,), only_earlier=True)
    apply(held, common.read_records(who, "both.jsonl"), (MOVE, LOOSE), only_earlier=False)
    decided = common.decisions(who)
    for key, (start, _why) in decided.get("confirmed", {}).items():
        moved_to(held, key, start)
    for key in decided.get("rejected", {}):
        held.pop(key, None)
    return with_aligned_openings(who, held)


def aligned_opening(who: str, key: str) -> float | None:
    """Where the aligner, reading with the ayah before as context, heard the ayah's first word -- when it read it whole."""
    reading = common.read_json(who, f"{key}.json", folder="words")
    if not reading or not reading.get("context") or (reading.get("coverage") or 0) < 0.95:
        return None
    firsts = sorted(word[1] for word in reading["words"] if word[0] == 0)
    return firsts[0] if firsts else None


def with_aligned_openings(who: str, held: dict[str, dict]) -> dict[str, dict]:
    """A moved start taken back to the aligner's first word where it heard the ayah begin earlier: the phoneme onset
    lands a syllable late on a long opening (Abdul Basit's 6:160)."""
    for key, record in list(held.items()):
        heard = aligned_opening(who, key) if record.get(STATUS) in MOVED else None
        if heard is not None and heard < record["start"]:
            held[key] = {**record, "start": heard}
    return held


def moves(who: str, *, cascade: bool = True) -> list[str]:
    """Every ayah whose start the tools moved (without cascade.py's own, for cascade.py)."""
    return [key for key, record in starts(who, cascade=cascade).items() if record.get(STATUS) in MOVED]


# -- How each ayah's words are labelled -----------------------------------------------------------------------------

def fit_of(part: str) -> tuple[float | None, float | None]:
    block = re.match(r"(\d+)\.\.(\d+)\((\d+)\): (\S+)/(\S+)", part)
    return tuple(None if value == "None" else float(value) for value in (block.group(4), block.group(5)))


def fits(who: str) -> dict[str, list[tuple[float | None, float | None]]]:
    """labels.txt: per ayah, per block, how its labels fit as labelled and one word on."""
    found = {}
    for line in common.read_lines(who, "labels.txt"):
        matched = re.match(r"(\d+:\d+) words \d+ coverage \S+ (.*)$", line.strip())
        if matched:
            found[matched.group(1)] = [fit_of(part) for part in matched.group(2).split(" | ")]
    return found


def shifted(f0: float | None, f1: float | None) -> bool:
    return f1 is not None and f1 <= FIT and (f0 is None or f1 < f0)


def unclear_labels(who: str) -> list[str]:
    """Ayahs with a block that fits neither as labelled nor one word on."""
    neither = lambda f0, f1: not shifted(f0, f1) and not (f0 is not None and f0 <= FIT)
    return [key for key, blocks in fits(who).items() if any(neither(*block) for block in blocks)]


def relabel(label: int, block: tuple[float | None, float | None], *, final_repeat: bool) -> tuple[int, bool]:
    """A word's label, one lower if its block fits one word on (an ayah's final repeated label stays), and whether so."""
    shift = shifted(*block)
    return (label - 1 if shift and not final_repeat else label), shift


def block_of_each(segments: list[list]) -> list[int]:
    """Which block -- going-back to going-back -- each listed word is in."""
    labels = [segment[0] for segment in segments]
    return [sum(1 for j in range(1, i + 1) if labels[j] < labels[j - 1]) for i in range(len(labels))]


def is_final_repeat(segments: list[list], i: int) -> bool:
    return 0 < i == len(segments) - 1 and segments[i][0] == segments[i - 1][0]


def relabelled(blocks: list | None, segments: list[list]) -> tuple[list[list], int, int]:
    """The segments with each clearly shifted block's labels one lower; and how many blocks moved, and fit neither way."""
    if not blocks:
        return segments, 0, 0
    out, moved, unclear = [], 0, 0
    for i, (block, (label, start, end)) in enumerate(zip(block_of_each(segments), segments)):
        opens = i == 0 or segments[i - 1][0] > label
        fit = blocks[block] if block < len(blocks) else (None, None)
        new, shift = relabel(label, fit, final_repeat=is_final_repeat(segments, i))
        unclear += int(opens and not shift and (fit[0] is None or fit[0] > FIT))
        moved += int(opens and shift)
        out += [[new, start, end]] if new >= 1 else []
    return out, moved, unclear


def aligner_words(reading: dict | None, start: int, end: int) -> list[list] | None:
    """The aligner's words for an ayah, when its reading is whole: clamped to start no earlier than the ayah does."""
    words = sorted(reading["words"], key=lambda word: word[1]) if reading else []
    whole = bool(words) and (reading.get("coverage") or 0) >= 0.95 and {w[0] for w in words} == set(range(reading["wordCount"]))
    if not whole or words[-1][1] * 1000 > end + 1000:
        return None
    clamped = [(w[0], max(round(w[1] * 1000), start), round(w[2] * 1000)) for w in words]
    return [[index + 1, at, max(until, at + 1)] for index, at, until in clamped]


# -- The corrections ------------------------------------------------------------------------------------------------

def ended_by_next(heard: dict[str, dict], key: str, end: int, segments: list[list]) -> tuple[int, list[list]]:
    """The ayah ended where the next one was heard to start, if that is before its listed end."""
    surah, ayah = common.by_key(key)
    following = heard.get(f"{surah}:{ayah + 1}") or {}
    if following.get(STATUS) not in MOVED or round(following["start"] * 1000) >= end:
        return end, segments
    end = round(following["start"] * 1000)
    return end, [[i, s, min(e, end)] for i, s, e in segments if s < end]


def held_ends(who: str) -> dict[str, float]:
    """ends.py: the ayahs whose last word is still held past their listed end, and until when (seconds)."""
    return {r["key"]: r["voicedTo"] for surah in common.read_folder(who, "ends") for r in surah if r[STATUS] == "held"}


def ended_when_held(heard: dict[str, dict], key: str, voiced: float | None, end: int,
                    segments: list[list]) -> tuple[int, list[list]]:
    """The ayah ended where its last word stops being held, never past where the next one is heard to start."""
    if voiced is None or not segments:
        return end, segments
    surah, ayah = common.by_key(key)
    following = heard.get(f"{surah}:{ayah + 1}") or {}
    limit = round(following["start"] * 1000) - 50 if following.get(STATUS) in MOVED else None
    until = min(round(voiced * 1000), limit) if limit else round(voiced * 1000)
    if until <= end:
        return end, segments
    last = max(range(len(segments)), key=lambda i: segments[i][2])
    return until, [[i, s, until if n == last else e] for n, (i, s, e) in enumerate(segments)]


def words_for(who: str, key: str, start: int, timing: dict, relabelled_words: tuple[list[list], int, int], *,
              moved: bool = False) -> tuple[list[list], int]:
    """The ayah's words: the aligner's where its start moved or a block fits neither way, else the export's, relabelled.
    A start moved later drops the words listed before it -- they were the ayah before's."""
    segments, changed, unclear = relabelled_words
    words = aligner_words(common.read_json(who, f"{key}.json", folder="words"), start, timing["timestamp_to"]) if unclear or moved else None
    segments, changed = (words, 1) if words else (segments, changed)
    return ([s for s in segments if s[1] >= start - 300] if start > timing["timestamp_from"] + 50 else segments), changed


def corrected(who: str, key: str, timing: dict, heard: dict[str, dict], blocks: list | None,
              voiced: float | None = None) -> dict | None:
    record = heard.get(key) or {}
    moved = record.get(STATUS) in MOVED
    start = round(record["start"] * 1000) if moved else timing["timestamp_from"]
    segments, changed = words_for(who, key, start, timing, relabelled(blocks, common.words_of(timing)), moved=moved)
    end, segments = ended_by_next(heard, key, timing["timestamp_to"], segments)
    if end == timing["timestamp_to"]:
        end, segments = ended_when_held(heard, key, voiced, end, segments)
    if not changed and start == timing["timestamp_from"] and end == timing["timestamp_to"]:
        return None
    return {"from": start, "to": end, "segments": segments}


def build(who: str) -> dict:
    heard = starts(who)
    blocks = fits(who)
    held = held_ends(who)
    ayahs = {}
    for key, timing in sorted(common.qul(who).items(), key=lambda kv: common.by_key(kv[0])):
        fixed = corrected(who, key, timing, heard, blocks.get(key), held.get(key))
        if fixed:
            ayahs[key] = fixed
    held = {key.split(":")[0] for key in ayahs}
    return {"audio": {s: url for s, url in common.qul_audio(who).items() if s in held}, "ayahs": ayahs}


def regions(reciters: list[str]) -> dict:
    out = {}
    for who in reciters:
        held = common.read_json(who, "regions.json")
        if held:
            out[who] = {s: [{k: v for k, v in r.items() if k != "note"} for r in rs] for s, rs in sorted(held.items(), key=lambda kv: int(kv[0]))}
    return out


def main(reciters: list[str]) -> None:
    corrections = common.LIB / "qulCorrections.json"
    store = json.loads(corrections.read_text()) if corrections.is_file() else {}
    for who in reciters:
        store[who] = build(who)
        print(who, len(store[who]["ayahs"]), "ayahs corrected", flush=True)
    corrections.write_text(json.dumps(store, ensure_ascii=False, separators=(",", ":")))
    measured = regions(reciters)
    if measured:
        (common.LIB / "measuredRegions.json").write_text(json.dumps(measured, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main([common.reciter(name) for name in sys.argv[1:]])
