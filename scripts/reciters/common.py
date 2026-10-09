"""What the reciter-timing tools in this folder share: where things are, how to ask the studio and the sidecar, and
the phoneme model that referees every start they move.

They read the studio's own API -- a passage's text, and the recording behind its audio proxy -- and the alignment
sidecar's /align, at the addresses ./start.sh gives them (STUDIO, SIDECAR). Results go to .run/reciters/<reciter>/,
which is not in the repository; every file there is reached through the functions below, which keep it there.
README.md says in which order to run the tools.
"""
from __future__ import annotations

import functools
import glob
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "asr-service"))

STUDIO = "http://localhost:3000"
SIDECAR = "http://127.0.0.1:8000"
LIB = ROOT / "src" / "lib"
WORK = ROOT / ".run" / "reciters"
QUL = ROOT / "data" / "qul" / "recitations"
DECISIONS = Path(__file__).resolve().parent / "decisions.json"

#: The studio reciters these tools know; anything else on the command line is refused.
RECITERS = {name: name for name in ("sudais", "muaiqly", "yasser", "shuraim", "ghamdi", "basit", "shatri", "rifai", "tunaiji", "jalil")}


def reciter(name: str) -> str:
    """A reciter named on the command line, if it is one of the studio's."""
    if name not in RECITERS:
        raise SystemExit(f"Not a studio reciter: {name!r}. One of {', '.join(RECITERS)}.")
    return RECITERS[name]


# -- Results under .run/reciters/<reciter>/ -------------------------------------------------------------------------

def read_json(who: str, name: str, folder: str = "") -> object:
    path = WORK / os.path.basename(who) / os.path.basename(folder) / os.path.basename(name)
    return json.loads(path.read_text()) if path.is_file() else None


def write_json(who: str, name: str, data: object, folder: str = "") -> None:
    path = WORK / os.path.basename(who) / os.path.basename(folder) / os.path.basename(name)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False))


def read_folder(who: str, folder: str) -> list[object]:
    """Every JSON file in one of the reciter's folders, in name order."""
    base = WORK / os.path.basename(who) / os.path.basename(folder)
    return [json.loads(Path(path).read_text()) for path in sorted(glob.glob(str(base / "*.json")))]


def read_lines(who: str, name: str) -> list[str]:
    path = WORK / os.path.basename(who) / os.path.basename(name)
    return path.read_text().splitlines() if path.is_file() else []


def append_line(who: str, name: str, line: str) -> None:
    path = WORK / os.path.basename(who) / os.path.basename(name)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a") as out:
        out.write(line + "\n")


def remove(who: str, name: str) -> None:
    (WORK / os.path.basename(who) / os.path.basename(name)).unlink(missing_ok=True)


def read_records(who: str, name: str) -> list[dict]:
    return [json.loads(line) for line in read_lines(who, name)]


def add_record(who: str, name: str, record: dict) -> None:
    append_line(who, name, json.dumps(record, ensure_ascii=False))


def decisions(who: str) -> dict:
    """What was decided by ear for this reciter -- see decisions.json."""
    return json.loads(DECISIONS.read_text()).get(who, {})


# -- QUL's export ---------------------------------------------------------------------------------------------------

@functools.lru_cache(maxsize=None)
def qul(who: str) -> dict:
    """The reciter's QUL export: verse key -> {timestamp_from, timestamp_to, segments}, milliseconds."""
    found = glob.glob(str(QUL / os.path.basename(who) / "**" / "segments.json"), recursive=True)
    if not found:
        raise SystemExit(f"No QUL export for {who} under data/qul/recitations.")
    return json.loads(Path(found[0]).read_text())


def qul_audio(who: str) -> dict[str, str]:
    """The recording QUL's export names for each surah, by surah number."""
    found = glob.glob(str(QUL / os.path.basename(who) / "**" / "surah.json"), recursive=True)
    return {str(row.get("surah_number", key)): row["audio_url"] for key, row in json.loads(Path(found[0]).read_text()).items()}


def ayah_count(who: str, surah: int) -> int:
    return max(int(key.split(":")[1]) for key in qul(who) if key.startswith(f"{surah}:"))


def by_key(key: str) -> tuple[int, int]:
    surah, ayah = key.split(":")
    return int(surah), int(ayah)


def words_of(timing: dict) -> list[list]:
    """An ayah's listed words, [label, start ms, end ms], in time order."""
    return sorted((list(s[:3]) for s in timing["segments"] if len(s) >= 3), key=lambda s: s[1])


# -- The studio and the sidecar -------------------------------------------------------------------------------------

def studio(path: str) -> dict:
    """A GET of the studio's API, as JSON."""
    request = urllib.request.Request(STUDIO + urllib.parse.quote(path, safe="/?=&"))
    return json.load(urllib.request.urlopen(request, timeout=300))


def load(who: str, surah: int, start: int, end: int) -> dict:
    """The studio's load of a passage: its verses, bounds and the audio proxy address."""
    return studio(f"/api/quran/verses?surah={surah}&start={start}&end={end}&reciter={who}")


def reference(passage: dict) -> str:
    """The passage's text as /align takes it -- one ayah a line, `key<TAB>words` -- as the studio sends it."""
    return "\n".join(
        f"{verse['verseKey']}\t{' '.join(word['arabic'].replace(' ', '') for word in verse['words'])}"
        for verse in passage["verses"]
    )


def recording(passage: dict) -> str:
    """The address the sidecar and the phoneme model read the recording from: the studio's proxy."""
    return STUDIO + urllib.parse.quote(passage["audioUrl"], safe="/?=&%")


def upstream(passage: dict) -> str:
    """The recording's own address, unwrapped from the proxy."""
    return urllib.parse.parse_qs(urllib.parse.urlparse(passage["audioUrl"]).query)["url"][0]


def align(passage: dict, start: float, end: float) -> dict:
    """The sidecar's reading of [start, end] seconds of the recording against the passage's text."""
    body = urllib.parse.urlencode({
        "audio_url": recording(passage), "window_start": max(0.0, start), "window_end": end, "reference": reference(passage),
    }).encode()
    try:
        return json.load(urllib.request.urlopen(urllib.request.Request(SIDECAR + "/align", data=body), timeout=1800))
    except urllib.error.HTTPError as error:
        return {"error": f"{error.code} {error.reason}", "segments": [], "words": []}


def first_heard(reading: dict, verse_key: str) -> list[float]:
    """Each time the reading has the ayah's first word, earliest first."""
    return sorted(word["start"] for word in reading.get("words", []) if word["verse_key"] == verse_key and word["word_index"] == 0)


def each(keys: list[str], done: set[str], check: Callable[[str], object], report: Callable[[object], None]) -> None:
    """Run `check` on every key not already done, reporting each result: what the resumable tools share."""
    for key in keys:
        if key not in done:
            report(check(key))


# -- The phoneme model ----------------------------------------------------------------------------------------------

#: Highest match cost (edit distance per symbol) at which an opening counts as heard at all.
HEARD = 0.34


class Ear:
    """Where the phoneme model hears an ayah's opening said: the referee for every start these tools move.

    The aligner and the published timings each err: on Khalid al-Jalil's 67 QUL had both of two disputed starts right
    and the aligner one wrong by 2.7s, the other by 2.6s. The phoneme model reads the audio with no text to fit, so
    where it hears an ayah's first words is evidence neither of the others can supply. Its reading depends on what is
    around it in the window -- after other speech it can garble an opening it hears plainly at a window's start -- so
    `scan` reads short overlapping windows.
    """

    def __init__(self) -> None:
        from app import phoneme
        self.phoneme = phoneme
        self.model = phoneme.load(phoneme.chosen(""))
        self.audio: dict[tuple[str, int], object] = {}

    def pcm(self, who: str, surah: int) -> object:
        """The surah's recording, decoded once (ffmpeg reads it through the studio's proxy)."""
        if (who, surah) not in self.audio:
            from app.audio import decode_url_window
            self.audio.clear()
            passage = load(who, surah, 1, 1)
            self.audio[(who, surah)] = decode_url_window(recording(passage), 0, 4 * 3600)
        return self.audio[(who, surah)]

    def symbols(self, verse_key: str, words: int) -> list[int]:
        units = self.phoneme.units_for([(verse_key, i) for i in range(words)], self.model.table) or []
        return [s for unit in units for s in self.phoneme.tokenize(unit.phonemes, self.model.tokens)]

    def opening(self, verse_key: str) -> list[int]:
        """The ayah's first words' phonemes: words added until 14 symbols or the ayah runs out, at most 18."""
        best: list[int] = []
        for words in range(1, 6):
            goal = self.symbols(verse_key, words)
            if not goal:
                break
            best = goal
            if len(goal) >= 14:
                break
        return best[:18]

    def heard(self, who: str, surah: int, start: float, end: float) -> tuple[list[int], list[int]]:
        """What the model hears in [start, end]: its symbols and the frame each began on."""
        from app import phoneme_reading
        start = max(0.0, start)
        rate = 16000
        probs = self.model.emission(self.pcm(who, surah)[int(start * rate):int(end * rate)])[0].numpy()
        return phoneme_reading._heard_with_frames(probs, self.model.blank)

    def openings(self, who: str, surah: int, verse_key: str, start: float, end: float) -> list[tuple[float, float]]:
        """Every place in [start, end] the opening is heard: (onset seconds, cost), earliest first."""
        from app import phoneme_reading
        heard, frames = self.heard(who, surah, start, end)
        goal = self.opening(verse_key)
        found: list[tuple[float, float]] = []
        while heard and goal and len(found) < 4:
            distance, first, last = phoneme_reading.best_match(goal, heard)
            if distance / len(goal) > HEARD:
                break
            found.append((round(max(0.0, start) + frames[first] * self.phoneme.FRAME_SEC, 2), round(distance / len(goal), 3)))
            heard = heard[:first] + [-1] * (last - first) + heard[last:]
        return sorted(found)

    def scan(self, who: str, surah: int, verse_key: str, start: float, end: float) -> list[tuple[float, float]]:
        """`openings` over 4.5s windows 1.5s apart; onsets within 0.4s are one, at their best cost."""
        found: dict[float, float] = {}
        at = max(0.0, start)
        while at < end:
            for onset, cost in self.openings(who, surah, verse_key, at, min(at + 4.5, end + 3)):
                same = next((o for o in found if abs(o - onset) <= 0.4), None)
                if same is None or cost < found[same]:
                    found.pop(same, None)
                    found[onset] = cost
            at += 1.5
        return sorted(found.items())


if __name__ == "__main__":
    # Where the opening of an ayah is heard near each time given:  common.py jalil 74 9 26.8 21.9
    ear = Ear()
    who_, surah_, ayah_ = reciter(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
    for t in map(float, sys.argv[4:]):
        print(f"{surah_}:{ayah_}", t, ear.scan(who_, surah_, f"{surah_}:{ayah_}", t - 0.8, t + 3.5))
