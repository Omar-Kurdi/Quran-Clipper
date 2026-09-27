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
the median sampled ayah reaches 0.7 and none falls below 0.4.

Pairings are tried in the studio's order -- quran.com with its file, QUL with
its file, then each source's timings with the other's file -- and the first to
pass is written to src/lib/timingPairs.json (`timingAudit.ts`): "quran.com" |
"qul" (that source, own file), [source, url] (that source, the other file), or
null (none passed; no timings are used). A surah that could not be checked is
left out, and the old order applies to it.

    asr-service/.venv/bin/python scripts/audit_timing_pairs.py run out.jsonl sudais basit
    asr-service/.venv/bin/python scripts/audit_timing_pairs.py table out.jsonl [more.jsonl ...]

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

import numpy as np

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(ROOT, "asr-service"))
logging.disable(logging.CRITICAL)

QUL = os.path.join(ROOT, "data", "qul", "recitations")
TABLE = os.path.join(ROOT, "src", "lib", "timingPairs.json")
#: quran.com's reciter ids, for the reciters it has timed.
QURAN_COM = {"sudais": 3, "yasser": 97, "shuraim": 10}
SAMPLES = int(os.getenv("AUDIT_SAMPLES", "5"))
HEAD_SEC = 15.0
MIN_MEDIAN, MIN_EACH = 0.7, 0.4


def quran_com(reciter: str, surah: int):
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


def qul(reciter: str, surah: int):
    if reciter not in _exports:
        folder = os.path.join(QUL, reciter)
        _exports[reciter] = (json.load(open(os.path.join(folder, "surah.json"))), json.load(open(os.path.join(folder, "segments.json"))))
    surahs, segments = _exports[reciter]
    timings = {}
    for key, verse in segments.items():
        s, ayah = key.split(":")
        if s != str(surah):
            continue
        words = [w for w in verse.get("segments") or [] if len(w) >= 3]
        if verse.get("timestamp_from") is not None and verse.get("timestamp_to"):
            timings[int(ayah)] = (verse["timestamp_from"] / 1000, verse["timestamp_to"] / 1000, words)
        elif words:
            timings[int(ayah)] = (min(w[1] for w in words) / 1000, max(w[2] for w in words) / 1000, words)
    return surahs[str(surah)]["audio_url"], timings


def sample(count: int) -> list[int]:
    if count <= SAMPLES:
        return list(range(1, count + 1))
    return sorted({round(1 + i * (count - 1) / (SAMPLES - 1)) for i in range(SAMPLES)})


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


def opening_agreement(audio: str, surah: int, ayah: int, span) -> float | None:
    """How far the ayah's opening, where the source puts it, is really that ayah."""
    from app import align, corpus

    start, end, words = span
    reference = corpus.words_for_range(surah, ayah, ayah)
    if end - start > HEAD_SEC + 2:
        # Only the words the source says begin inside the opening stretch.
        begun = {int(w[0]) for w in words if w[1] / 1000 < start + HEAD_SEC - 1.0}
        if begun and len(begun) < len(reference):
            last = max(begun)
            reference = [w for w in reference if w[1] + 1 <= last]
            end = min(end, max(w[2] / 1000 for w in words if int(w[0]) <= last))
        else:
            end = start + HEAD_SEC
    pcm = window(audio, max(0.0, start - 0.3), end + 0.3)
    agreement = align.align_recitation(pcm, reference).decode_agreement
    return None if agreement is None else round(agreement, 3)


def verdict(scores: dict) -> str:
    values = [v for v in scores.values() if isinstance(v, (int, float))]
    if len(values) < min(2, len(scores)):
        return "unchecked"
    return "pass" if statistics.median(values) >= MIN_MEDIAN and min(values) >= MIN_EACH else "fail"


def pairings(reciter: str, surah: int, exported: dict) -> list[str]:
    """source[@other source's file], in the order the studio would try them."""
    order = ["qdc"] if reciter in QURAN_COM else []
    if str(surah) in exported:
        order.append("qul")
        if reciter in QURAN_COM:
            order += ["qul@qdc", "qdc@qul"]
    return order


def check(reciter: str, surah: int, pairing: str):
    timing_src, _, audio_src = pairing.partition("@")
    fetch = {"qdc": quran_com, "qul": qul}
    audio, timings = fetch[timing_src](reciter, surah)
    if audio_src:
        audio = fetch[audio_src](reciter, surah)[0]
    scores = {}
    for ayah in sample(max(timings)):
        if ayah not in timings or timings[ayah][1] <= timings[ayah][0]:
            continue
        for _ in range(3):
            try:
                scores[ayah] = opening_agreement(audio, surah, ayah, timings[ayah])
                break
            except Exception as e:
                scores[ayah] = "error: " + str(e)[:80]
                time.sleep(5)
    return audio, scores, verdict(scores)


def run(out: str, reciters: list[str]) -> None:
    done = {json.loads(line)["key"] for line in open(out)} if os.path.exists(out) else set()
    for reciter in reciters:
        folder = os.path.join(QUL, reciter)
        exported = json.load(open(os.path.join(folder, "surah.json"))) if os.path.isdir(folder) else {}
        for surah in range(1, 115):
            key = f"{reciter}:{surah}"
            if key in done:
                continue
            tried, chosen = {}, None
            for pairing in pairings(reciter, surah, exported):
                try:
                    audio, scores, result = check(reciter, surah, pairing)
                except Exception as e:
                    audio, scores, result = None, {"error": str(e)[:120]}, "error"
                tried[pairing] = {"verdict": result, "scores": scores}
                if result == "pass":
                    timing_src, _, audio_src = pairing.partition("@")
                    chosen = {"timings": "quran.com" if timing_src == "qdc" else "qul", "audio": audio, "own": not audio_src}
                    break
            with open(out, "a") as f:
                f.write(json.dumps({"key": key, "chosen": chosen, "tried": tried}) + "\n")
            print(key, {p: t["verdict"] for p, t in tried.items()}, flush=True)


def table(files: list[str]) -> None:
    found: dict[str, dict[str, object]] = {}
    for path in files:
        for line in open(path):
            row = json.loads(line)
            reciter, surah = row["key"].split(":")
            chosen, tried = row["chosen"], row["tried"]
            if chosen:
                entry = chosen["timings"] if chosen["own"] else [chosen["timings"], chosen["audio"]]
            elif tried and all(t["verdict"] == "fail" for t in tried.values()):
                entry = None
            else:
                continue  # not checked: the old order applies
            found.setdefault(reciter, {})[surah] = entry
    with open(TABLE, "w") as out:
        json.dump(found, out, indent=1, sort_keys=True)
        out.write("\n")
    for reciter, surahs in sorted(found.items()):
        none = sorted(int(s) for s, e in surahs.items() if e is None)
        moved = sorted(int(s) for s, e in surahs.items() if isinstance(e, list))
        print(f"{reciter}: {len(surahs)} surahs audited; none fit {none or '-'}; timings on the other file {moved or '-'}")


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "run":
        run(sys.argv[2], sys.argv[3:])
    elif len(sys.argv) >= 3 and sys.argv[1] == "table":
        table(sys.argv[2:])
    else:
        sys.exit(__doc__)
