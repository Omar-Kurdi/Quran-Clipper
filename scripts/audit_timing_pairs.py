"""Which recording each reciter's published timings really belong to, surah by surah.

A source's ayah timings were trusted to match the file it names, and often do
not. quran.com's Sudais Al-Ma'idah was timed on a file since replaced: from
5:41 on every caption played 12-36s ahead of its ayah. QUL's timings for it
fit the quranicaudio file and name a tarteel one 126s shorter. Nothing in the
data gives this away. Not even the files' lengths do: Ghamdi's timings run
past the end of files they fit perfectly, and quran.com's Yasser 13 is right
on a file whose length it misses by seconds.

So this listens. For each surah it samples ayahs, reads the opening of each
(up to 15s) from the recording at the time the source gives, and aligns the
words the source puts there to it. `decode_agreement` is the aligner's own
wrong-text check: 0.65-1.0 where the audio is that ayah, 0.0-0.33 where it is
not (calibrated on Sudais 3 and 5, Ghamdi 3, Yasser 13). A pairing passes when
the median of five sampled ayahs reaches 0.7 and none falls below 0.4. One
that fails is checked again on twelve: the check misreads the odd short ayah
(Yasser 104:7 scores 0.33 whichever timings and file it is given), so there it
passes when no more than a quarter fall below 0.5 and the median reaches 0.7.
Rifai 16, with seven of twelve wrong, is what failing looks like.

Pairings are tried in the studio's order -- quran.com with its file, QUL with
its file, then each source's timings with the other's file -- and the first to
pass is written to src/lib/timingPairs.json (`timingAudit.ts`): "quran.com" |
"qul" (that source, own file), [source, url] (that source, the other file), or
null (every pairing failed; no timings are used). A surah that could not be
checked is left out -- the old order applies -- and printed for review.

    asr-service/.venv/bin/python scripts/audit_timing_pairs.py run sudais basit
    asr-service/.venv/bin/python scripts/audit_timing_pairs.py table

Where a surah passed on quran.com, QUL was never tried -- the order stops at
the first pass -- so nothing said whether QUL's timings fit QUL's own file
there. `fallback` checks exactly that pairing for those surahs, so a load can
use QUL when quran.com does not answer, and only where it was found to fit:

    asr-service/.venv/bin/python scripts/audit_timing_pairs.py fallback run sudais
    asr-service/.venv/bin/python scripts/audit_timing_pairs.py fallback table

Results go to .run/timing-fallback-<reciter>.jsonl; the table to
src/lib/timingFallbacks.json, reciter -> the surahs whose QUL pairing passed.

Results go to .run/timing-audit-<reciter>.jsonl.

`run` is resumable and takes a while -- tens of seconds per long surah -- so
run a few reciters per process side by side. It needs the aligner's model,
network access and QUL's exports under data/qul/recitations. Re-run when a CDN
changes a file.
"""
from __future__ import annotations

import json
import logging
import os
import statistics
import subprocess
import sys
import time
import urllib.request

from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "asr-service"))
logging.disable(logging.CRITICAL)

QUL = os.path.join(ROOT, "data", "qul", "recitations")
RESULTS = os.path.join(ROOT, ".run")
TABLE = os.path.join(ROOT, "src", "lib", "timingPairs.json")
FALLBACKS = os.path.join(ROOT, "src", "lib", "timingFallbacks.json")
#: quran.com's reciter ids, for the reciters it has timed.
QURAN_COM = {"sudais": 3, "yasser": 97, "shuraim": 10}
#: Every reciter the studio offers with published timings; nothing else is read or written.
RECITERS = ("sudais", "yasser", "shuraim", "muaiqly", "ghamdi", "basit", "shatri", "rifai", "tunaiji", "jalil")
SAMPLES, SECOND_LOOK = 5, 12
HEAD_SEC = 15.0
MIN_MEDIAN, MIN_EACH = 0.7, 0.4
#: On the second look: an ayah under this counts as wrong, and at most this share may be.
WRONG_BELOW, MAX_WRONG_SHARE = 0.5, 0.25
#: The largest QUL export there is, with room to spare.
MAX_EXPORT_BYTES = 200 * 1024 * 1024

Span = tuple[float, float, list]
Timings = dict[int, Span]


#: Longest a results file gets: 114 surahs of a few hundred bytes each, with room to spare.
MAX_RESULTS_BYTES = 10 * 1024 * 1024


def known(reciter: str) -> str:
    """The reciter's name as the list above spells it -- never one taken from the command line."""
    if reciter not in RECITERS:
        raise SystemExit(f"{reciter!r} is not one of {', '.join(RECITERS)}")
    return RECITERS[RECITERS.index(reciter)]


def read_export(reciter: str, name: str) -> dict:
    """One of QUL's export files for a reciter, from data/qul/recitations inside the repository."""
    path = ROOT / "data" / "qul" / "recitations" / known(reciter) / name
    real = path.resolve()
    if not real.is_relative_to(ROOT) or path.is_symlink() or not real.is_file() or real.stat().st_size > MAX_EXPORT_BYTES:
        raise SystemExit(f"{path} is not a readable export inside the repository")
    with real.open() as f:
        return json.load(f)


def read_results(path: Path) -> list[dict]:
    """One reciter's results so far; none when there is no file yet."""
    real = path.resolve()
    if not real.is_relative_to(ROOT) or path.is_symlink() or real.is_file() and real.stat().st_size > MAX_RESULTS_BYTES:
        raise SystemExit(f"{path} is not a results file inside the repository")
    if not real.is_file():
        return []
    with real.open() as f:
        return [json.loads(line) for line in f]


def append_result(path: Path, row: dict) -> None:
    real = path.resolve()
    if not real.is_relative_to(ROOT) or path.is_symlink() or real.is_file() and real.stat().st_size > MAX_RESULTS_BYTES:
        raise SystemExit(f"{path} is not a results file inside the repository")
    with real.open("a") as f:
        f.write(json.dumps(row) + "\n")


def results_file(reciter: str, *, fallback: bool = False) -> Path:
    """The audit's results, or with `fallback` the QUL check's below."""
    os.makedirs(RESULTS, exist_ok=True)
    return Path(RESULTS) / f"timing-{'fallback' if fallback else 'audit'}-{known(reciter)}.jsonl"


def quran_com(reciter: str, surah: int) -> tuple[str, Timings]:
    url = f"https://api.qurancdn.com/api/qdc/audio/reciters/{QURAN_COM[reciter]}/audio_files?chapter={surah}&segments=true"
    for _ in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=60) as res:
                file = json.load(res)["audio_files"][0]
            return file["audio_url"], {
                int(v["verse_key"].split(":")[1]): (v["timestamp_from"] / 1000, v["timestamp_to"] / 1000, v.get("segments") or [])
                for v in file["verse_timings"]
            }
        except Exception:
            time.sleep(5)
    raise RuntimeError("quran.com did not answer")


_exports: dict[str, tuple[dict, dict]] = {}


def export(reciter: str) -> tuple[dict, dict]:
    """QUL's surah list and segments for one reciter, or empty when this machine has none."""
    if reciter not in _exports:
        folder = os.path.join(QUL, known(reciter))
        _exports[reciter] = (
            (read_export(reciter, "surah.json"), read_export(reciter, "segments.json"))
            if os.path.isdir(folder) else ({}, {})
        )
    return _exports[reciter]


def ayah_span(verse: dict) -> Span | None:
    words = [w for w in verse.get("segments") or [] if len(w) >= 3]
    if verse.get("timestamp_from") is not None and verse.get("timestamp_to"):
        return verse["timestamp_from"] / 1000, verse["timestamp_to"] / 1000, words
    if words:
        return min(w[1] for w in words) / 1000, max(w[2] for w in words) / 1000, words
    return None


def qul(reciter: str, surah: int) -> tuple[str, Timings]:
    surahs, segments = export(reciter)
    prefix = f"{surah}:"
    timings = {int(key[len(prefix):]): span for key, verse in segments.items()
               if key.startswith(prefix) and (span := ayah_span(verse))}
    return surahs[str(surah)]["audio_url"], timings


def sample(count: int, samples: int) -> list[int]:
    if count <= samples:
        return list(range(1, count + 1))
    return sorted({round(1 + i * (count - 1) / (samples - 1)) for i in range(samples)})


def window(url: str, start: float, end: float) -> np.ndarray:
    """One stretch of a recording, straight from its CDN: ffmpeg seeks it with range requests.

    Not through the studio's proxy, which took 36s for a seek the CDN answers
    in 3s, and not `decode_url_window`, whose host list is the sidecar's and
    leaves out QUL's.
    """
    raw = subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-user_agent", "Mozilla/5.0", "-ss", f"{start:.3f}", "-to", f"{end:.3f}",
         "-i", url, "-vn", "-f", "s16le", "-ac", "1", "-ar", "16000", "-"],
        capture_output=True, check=True, timeout=180,
    ).stdout
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


def opening(span: Span, reference: list) -> tuple[float, list]:
    """Where a long ayah's opening stretch ends, and the words the source puts inside it."""
    start, end, words = span
    if end - start <= HEAD_SEC + 2:
        return end, reference
    begun = {int(w[0]) for w in words if w[1] / 1000 < start + HEAD_SEC - 1.0}
    if not begun or len(begun) >= len(reference):
        return start + HEAD_SEC, reference
    last = max(begun)
    return min(end, max(w[2] / 1000 for w in words if int(w[0]) <= last)), [w for w in reference if w[1] + 1 <= last]


def opening_agreement(audio: str, surah: int, ayah: int, span: Span) -> float | None:
    """How far the ayah's opening, where the source puts it, is really that ayah."""
    from app import align, corpus

    end, reference = opening(span, corpus.words_for_range(surah, ayah, ayah))
    pcm = window(audio, max(0.0, span[0] - 0.3), end + 0.3)
    agreement = align.align_recitation(pcm, reference).decode_agreement
    return None if agreement is None else round(agreement, 3)


def verdict(scores: dict, *, second_look: bool = False) -> str:
    values = [v for v in scores.values() if isinstance(v, (int, float))]
    if len(values) < min(2, len(scores)):
        return "unchecked"
    if statistics.median(values) < MIN_MEDIAN:
        return "fail"
    if second_look:
        return "pass" if sum(v < WRONG_BELOW for v in values) <= MAX_WRONG_SHARE * len(values) else "fail"
    return "pass" if min(values) >= MIN_EACH else "fail"


def pairings(reciter: str, surah: int) -> list[str]:
    """source[@other source's file], in the order the studio would try them."""
    order = ["qdc"] if reciter in QURAN_COM else []
    if str(surah) in export(reciter)[0]:
        order.append("qul")
        if reciter in QURAN_COM:
            order += ["qul@qdc", "qdc@qul"]
    return order


def scored(audio: str, surah: int, ayah: int, span: Span) -> float | str | None:
    """One ayah's agreement, retried through a CDN hiccup."""
    failure = ""
    for _ in range(3):
        try:
            return opening_agreement(audio, surah, ayah, span)
        except Exception as e:
            failure = "error: " + str(e)[:80]
            time.sleep(5)
    return failure


def check(reciter: str, surah: int, pairing: str) -> tuple[str, dict, str]:
    """Five ayahs, and twelve if that fails."""
    timing_src, _, audio_src = pairing.partition("@")
    fetch = {"qdc": quran_com, "qul": qul}
    audio, timings = fetch[timing_src](reciter, surah)
    if audio_src:
        audio = fetch[audio_src](reciter, surah)[0]
    usable = [ayah for ayah in timings if timings[ayah][1] > timings[ayah][0]]
    scores = {a: scored(audio, surah, a, timings[a]) for a in sample(max(timings), SAMPLES) if a in usable}
    result = verdict(scores)
    if result == "fail":
        scores = {a: scored(audio, surah, a, timings[a]) for a in sample(max(timings), SECOND_LOOK) if a in usable}
        result = verdict(scores, second_look=True)
    return audio, scores, result


def audit_surah(reciter: str, surah: int) -> dict:
    """Every pairing tried, in order, until one passes."""
    tried: dict[str, dict] = {}
    for pairing in pairings(reciter, surah):
        try:
            audio, scores, result = check(reciter, surah, pairing)
        except Exception as e:
            audio, scores, result = "", {"error": str(e)[:120]}, "error"
        tried[pairing] = {"verdict": result, "scores": scores}
        if result == "pass":
            timing_src, _, audio_src = pairing.partition("@")
            chosen = {"timings": "quran.com" if timing_src == "qdc" else "qul", "audio": audio, "own": not audio_src}
            return {"key": f"{reciter}:{surah}", "chosen": chosen, "tried": tried}
    return {"key": f"{reciter}:{surah}", "chosen": None, "tried": tried}


def audit_reciter(reciter: str) -> None:
    out = results_file(reciter)
    done = {row["key"] for row in read_results(out)}
    for surah in range(1, 115):
        if f"{reciter}:{surah}" in done:
            continue
        row = audit_surah(reciter, surah)
        append_result(out, row)
        print(row["key"], {p: t["verdict"] for p, t in row["tried"].items()}, flush=True)


def run(reciters: list[str]) -> None:
    for reciter in reciters:
        audit_reciter(reciter)


def entry(row: dict) -> object:
    """What the table says for one audited surah, or ... when it should say nothing."""
    chosen, tried = row["chosen"], row["tried"]
    if chosen:
        return chosen["timings"] if chosen["own"] else [chosen["timings"], chosen["audio"]]
    return None if tried and all(t["verdict"] == "fail" for t in tried.values()) else ...


def report(found: dict[str, dict[str, object]], review: list[str]) -> None:
    for reciter, surahs in sorted(found.items()):
        none = sorted(int(s) for s, e in surahs.items() if e is None)
        moved = sorted(int(s) for s, e in surahs.items() if isinstance(e, list))
        print(f"{reciter}: {len(surahs)} surahs; no timings fit {none or '-'}; timings on the other file {moved or '-'}")
    print("left for review (old order applies):", " ".join(review) or "-")


def table() -> None:
    rows = [row for reciter in RECITERS for row in read_results(results_file(reciter))]
    found: dict[str, dict[str, object]] = {}
    review = [row["key"] for row in rows if entry(row) is ...]
    for row in rows:
        if (value := entry(row)) is not ...:
            reciter, surah = row["key"].split(":")
            found.setdefault(reciter, {})[surah] = value
    with Path(TABLE).open("w") as out:
        json.dump(found, out, indent=1, sort_keys=True)
        out.write("\n")
    report(found, review)


def audit_fallbacks(reciter: str) -> None:
    """QUL's timings on QUL's own file, for every surah the table gives to quran.com."""
    with Path(TABLE).open() as f:
        paired = json.load(f).get(known(reciter), {})
    out = results_file(reciter, fallback=True)
    done = {row["key"] for row in read_results(out)}
    for surah in range(1, 115):
        key = f"{reciter}:{surah}"
        if paired.get(str(surah)) != "quran.com" or key in done:
            continue
        if str(surah) not in export(reciter)[0]:
            row = {"key": key, "audio": "", "verdict": "no export", "scores": {}}
        else:
            try:
                audio, scores, result = check(reciter, surah, "qul")
            except Exception as e:
                audio, scores, result = "", {"error": str(e)[:120]}, "error"
            row = {"key": key, "audio": audio, "verdict": result, "scores": scores}
        append_result(out, row)
        print(key, row["verdict"], flush=True)


def fallback_table() -> None:
    found: dict[str, list[int]] = {}
    for reciter in QURAN_COM:
        rows = read_results(results_file(reciter, fallback=True))
        found[reciter] = sorted(int(row["key"].split(":")[1]) for row in rows if row["verdict"] == "pass")
        others = sorted((row["key"], row["verdict"]) for row in rows if row["verdict"] != "pass")
        print(f"{reciter}: {len(found[reciter])} of {len(rows)} pass; not: {others or '-'}")
    with Path(FALLBACKS).open("w") as out:
        json.dump(found, out, indent=1, sort_keys=True)
        out.write("\n")


if __name__ == "__main__":
    if sys.argv[1:2] == ["fallback"]:
        if sys.argv[2:3] == ["run"] and sys.argv[3:]:
            for name in sys.argv[3:]:
                audit_fallbacks(name)
        elif sys.argv[2:] == ["table"]:
            fallback_table()
        else:
            sys.exit(__doc__)
    elif len(sys.argv) >= 3 and sys.argv[1] == "run":
        run(sys.argv[2:])
    elif sys.argv[1:] == ["table"]:
        table()
    else:
        sys.exit(__doc__)
