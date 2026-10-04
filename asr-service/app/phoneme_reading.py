"""What a phoneme model hears: the passage's words in the order said, restarts included -- and what came before it.

The aligner's own reading decodes each phrase with fastconformer and searches
the passage for it. Where a reciter keeps going back a word or two -- At-Tawbah
9:112 is read 1-3, 1-3, 3-6, 5-8, 7-11, 9-14 -- that reading comes back
garbled or empty, and the restarts are lost. Quran-Lab's v3.1 zipformer, which
transcribes phonemes with no language model to tidy them, hears each of those
restarts (FutureIdeas #58).

So here the whole recording is read once, greedily, and that reading is lined
up against the passage's phonemes with a search that may jump back to the
start of any earlier chunk. Each jump is a restart; the words between jumps are
the runs recited. The result is the aligner's `script` -- indices into the
reference words, repeats included -- and which of its words were heard again.
Everything after (placing the words in time, cutting captions) is unchanged.

A trial: `ALIGN_PHONEME_READING` or the studio's dev-only lab turns it on.
`best` reads it both ways -- this, and the aligner's own decoding -- and keeps
whichever of the two scripts the phoneme model's hearing fits better: each is
good where the other is weak (the phoneme model catches the dense restarts of
At-Tawbah, fastconformer some short ones it misses).
"""

from __future__ import annotations

import logging
from collections.abc import Callable

import numpy as np

from . import phoneme
from .audio import SAMPLE_RATE
from .phoneme import Unit, tokenize, units_for

log = logging.getLogger("asr-service")

#: What a restart costs, in symbols. Lower and a misheard stretch is "explained"
#: by jumping back; higher and a real two-word restart is not worth taking.
JUMP_COST = 3.0

#: What a symbol heard but not in the text costs, and one in the text but not heard.
EXTRA_COST = 1.0
MISSING_COST = 1.0

#: Backpointer codes for the search.
_SAME, _EXTRA, _MISSING = 0, 1, 2


def heard_symbols(log_probs: np.ndarray, blank: int) -> list[int]:
    """A greedy CTC reading: each frame's likeliest symbol, repeats and blanks dropped."""
    best = log_probs.argmax(-1)
    out: list[int] = []
    previous = blank
    for symbol in best.tolist():
        if symbol != blank and symbol != previous:
            out.append(symbol)
        previous = symbol
    return out


def runs_recited(heard: list[int], unit_symbols: list[list[int]]) -> list[tuple[int, int]] | None:
    """The units recited, as runs ``(first, last)`` in the order said; a run after the first may go back.

    An edit-distance alignment of ``heard`` against the units' symbols laid end
    to end, which may also jump, before any symbol, back to the start of an
    earlier unit at `JUMP_COST`. Starts at the first unit and ends at the last:
    every word of the passage is recited at least once.
    """
    if not heard or not any(unit_symbols):
        return None
    return _aligned(heard, unit_symbols)[0]


def _aligned(heard: list[int], unit_symbols: list[list[int]]) -> tuple[list[tuple[int, int]], list[int]]:
    """`runs_recited`, and for each heard symbol the unit it was heard as part of."""
    reference = [s for symbols in unit_symbols for s in symbols]
    unit_of = np.repeat(np.arange(len(unit_symbols)), [len(s) for s in unit_symbols])
    starts = np.cumsum([0] + [len(s) for s in unit_symbols[:-1]])
    table = _Search(np.array(reference), starts)
    for symbol in heard:
        table.take(symbol)
    positions, cells = table.trace()
    heard_units = [int(unit_of[min(max(cell - 1, 0), len(reference) - 1)]) for cell in cells]
    return _runs(positions, unit_of), heard_units


class _Search:
    """The alignment table, a row per heard symbol, kept with what is needed to trace it back."""

    def __init__(self, reference: np.ndarray, starts: np.ndarray):
        self.reference = reference
        self.starts = starts
        size = len(reference) + 1
        # Before anything is heard: at the start, or having skipped text unheard.
        self.row = np.arange(size, dtype=np.float64) * MISSING_COST
        self.moves: list[np.ndarray] = []  # per row, how each cell was reached
        self.jumps: list[dict[int, int]] = []  # per row, unit start -> the cell it jumped from

    def take(self, symbol: int) -> None:
        before, jumped = self._jump(self.row)
        size = len(before)
        here = np.empty(size)
        move = np.empty(size, dtype=np.int8)
        same = before[:-1] + (self.reference != symbol)
        extra = before + EXTRA_COST
        here[0], move[0] = extra[0], _EXTRA
        take_same = same <= extra[1:]
        here[1:] = np.where(take_same, same, extra[1:])
        move[1:] = np.where(take_same, _SAME, _EXTRA)
        # Text skipped unheard runs along the row: a running minimum, as in `phoneme_table`.
        steps = np.arange(size) * MISSING_COST
        settled = np.minimum.accumulate(here - steps) + steps
        move[settled < here] = _MISSING
        self.row = settled
        self.moves.append(move)
        self.jumps.append(jumped)

    def _jump(self, row: np.ndarray) -> tuple[np.ndarray, dict[int, int]]:
        """Going back to an earlier unit's start before the next symbol: from any cell at or past it."""
        suffix = np.minimum.accumulate(row[::-1])[::-1]
        where = np.minimum.accumulate(np.where(row == suffix, np.arange(len(row)), len(row))[::-1])[::-1]
        out = row.copy()
        jumped: dict[int, int] = {}
        for start in self.starts:
            source = int(where[start])
            if source > start and row[source] + JUMP_COST < out[start]:
                out[start] = row[source] + JUMP_COST
                jumped[int(start)] = source
        return out, jumped

    def trace(self) -> tuple[list[int], list[int]]:
        """The reference positions read, in the order read; and for each heard symbol, how far into the text it was."""
        cell = len(self.reference)
        read: list[int] = []
        cells: list[int] = []
        for i in range(len(self.moves) - 1, -1, -1):
            move = self.moves[i]
            while move[cell] == _MISSING and cell > 0:
                cell -= 1
                read.append(cell)
            cells.append(cell)
            if move[cell] == _SAME:
                cell -= 1
                read.append(cell)
            cell = self.jumps[i].get(cell, cell)
        read.extend(range(cell - 1, -1, -1))
        return read[::-1], cells[::-1]


def _runs(positions: list[int], unit_of: np.ndarray) -> list[tuple[int, int]]:
    """Reference positions in the order read, as runs of units: a new run wherever the reading went back."""
    runs: list[tuple[int, int]] = []
    previous = -1
    for position in positions:
        unit = int(unit_of[position])
        if runs and position > previous:
            runs[-1] = (runs[-1][0], unit)
        else:
            runs.append((unit, unit))
        previous = position
    return runs


def script_from_runs(runs: list[tuple[int, int]], units: list[Unit]) -> tuple[list[int], list[bool]]:
    """The aligner's script from runs of units, and which of its words were heard again."""
    reached = [-1] + list(np.maximum.accumulate([last for _, last in runs]))
    words = [(word, first <= reached[i]) for i, (first, last) in enumerate(runs) for unit in units[first:last + 1] for word in unit.words]
    return [word for word, _ in words], [again for _, again in words]


#: The model `best` and `mixed` read with.
BEST_READER = "v31"

#: For `mixed`: how much better the phoneme reading of an ayah has to fit what
#: was heard there, in symbols, before it replaces the aligner's -- and how
#: thick the restarts it hears there have to come, per word of the ayah.
#:
#: Set from three ayahs, so treat it as provisional: At-Tawbah 9:112 (5
#: restarts in 16 words) and 9:111 (6 in 37), where the phoneme reading is
#: right, against Ali 'Imran 3:195 (3 in 43), where it is not. 2026-10-04,
#: `./gauge.sh` with `ALIGN_PHONEME_READING=mixed`.
MIN_GAIN = 4.0
MIN_RESTARTS = 2
MIN_RESTARTS_PER_WORD = 0.1

Script = tuple[list[int], list[bool]]


def misfit(heard: list[int], symbols: list[int]) -> float:
    """How many symbols ``heard`` and a script's ``symbols`` differ by: a plain edit distance."""
    target = np.array(symbols)
    steps = np.arange(len(target) + 1, dtype=np.float64)
    row = steps.copy()
    for i, symbol in enumerate(heard, 1):
        here = np.concatenate(([float(i)], np.minimum(row[1:] + 1, row[:-1] + (target != symbol))))
        row = np.minimum.accumulate(here - steps) + steps
    return float(row[-1])


def read_script(
    name: str,
    pcm: np.ndarray,
    ref_words: list[tuple[str, int, str]],
    by_decode: Callable[[], Script],
) -> Script | None:
    """The script heard in ``pcm`` for ``ref_words`` by model ``name``, or by `best`; None (logged) if not read.

    ``by_decode`` is the aligner's own reading, asked for only by `best`.
    """
    reader = BEST_READER if name in ("best", "mixed") else name
    if reader not in phoneme.MODELS:
        log.warning("phoneme reading skipped: no model %r", name)
        return None
    try:
        model = phoneme.load(reader)
        heard = heard_symbols(model.emission(pcm)[0].numpy(), model.blank)
        return _by_name(name, model, heard, ref_words, by_decode)
    except Exception as exc:  # noqa: BLE001 -- a trial: never fail the match for it
        log.warning("phoneme reading (%s) skipped: %s", name, exc)
        return None


def _by_name(name: str, model: phoneme.Loaded, heard: list[int], ref_words: list[tuple[str, int, str]], by_decode: Callable[[], Script]) -> Script | None:
    """The reading ``name`` asks for, from what ``model`` heard."""
    if name == "mixed":
        return mixed(model, heard, ref_words, by_decode())
    read = _read(model, heard, ref_words)
    if name != "best" or read is None:
        return read
    decoded = by_decode()
    scores = [misfit(heard, _symbols(model, script, ref_words)) for script in (read[0], decoded[0])]
    log.info("phoneme reading (best): phoneme %.0f against decoding %.0f symbols off", *scores)
    return read if scores[0] < scores[1] else decoded


def mixed(model: phoneme.Loaded, heard: list[int], ref_words: list[tuple[str, int, str]], decoded: Script) -> Script:
    """The aligner's own reading, with an ayah's taken from the phoneme model where it fits what was heard far better.

    Restart by restart, in effect: an ayah is where restarts live, and each is
    judged on the stretch of what was heard that the phoneme reading put
    there -- the reading itself decides nothing outside it.

    Only where the phoneme reading hears restarts come thick and fast. Fit
    alone cannot choose: the phoneme model misses some short restarts outright
    (the second لِمَنِ ٱلْمُلْكُ of 40:16) and starts others a word late (3:188),
    and a reading without a restart nobody heard fits what was heard better
    than the true one with it. Where it hears a reciter going back again and
    again, as through At-Tawbah 9:111-112, the aligner's phrase-by-phrase
    decoding is what loses its place, and the phoneme reading is the one to
    believe.
    """
    units = units_for([(key, index) for key, index, _ in ref_words], model.table)
    if not units:
        return decoded
    symbols = [tokenize(unit.phonemes, model.tokens) for unit in units]
    runs, heard_units = _aligned(heard, symbols)
    script, repeated = script_from_runs(runs, units)
    ayah_of_unit = [ref_words[unit.words[0]][0] for unit in units]
    replaced = []
    heard_in = _heard_by_ayah(heard, [ayah_of_unit[unit] for unit in heard_units])
    for ayah in dict.fromkeys(key for key, _, _ in ref_words):
        said = heard_in.get(ayah, [])
        ours = _ayah_block((script, repeated), ref_words, ayah)
        if _phoneme_reads_better(model, said, _ayah_block(decoded, ref_words, ayah), ours, ref_words):
            decoded = _with_block(decoded, ref_words, ayah, ours)
            replaced.append(ayah)
    log.info("phoneme reading (mixed): the phoneme reading for %s", ", ".join(replaced) or "no ayah")
    return decoded


def _heard_by_ayah(heard: list[int], ayahs: list[str]) -> dict[str, list[int]]:
    """What was heard, split by the ayah the phoneme reading put each symbol in."""
    out: dict[str, list[int]] = {}
    for symbol, ayah in zip(heard, ayahs):
        out.setdefault(ayah, []).append(symbol)
    return out


def _phoneme_reads_better(
    model: phoneme.Loaded, said: list[int], theirs: Script | None, ours: Script | None, ref_words: list[tuple[str, int, str]]
) -> bool:
    """Whether one ayah's phoneme reading should replace the aligner's: restarts thick and fast, and a better fit."""
    if theirs is None or ours is None or not said or theirs[0] == ours[0]:
        return False
    if _restarts(ours[0]) < max(MIN_RESTARTS, MIN_RESTARTS_PER_WORD * len(set(ours[0]))):
        return False
    gain = misfit(said, _symbols(model, theirs[0], ref_words)) - misfit(said, _symbols(model, ours[0], ref_words))
    log.info("phoneme reading (mixed): the phoneme reading fits %.0f symbols better of %d heard", gain, len(said))
    return gain >= MIN_GAIN


def _restarts(words: list[int]) -> int:
    return sum(1 for before, after in zip(words, words[1:]) if after <= before)


def _ayah_block(read: Script, ref_words: list[tuple[str, int, str]], ayah: str) -> Script | None:
    """One ayah's stretch of a script, or None if the script leaves it and comes back (a restart across ayahs)."""
    at = [i for i, word in enumerate(read[0]) if ref_words[word][0] == ayah]
    if not at or at[-1] - at[0] + 1 != len(at):
        return None
    return read[0][at[0]:at[-1] + 1], read[1][at[0]:at[-1] + 1]


def _with_block(read: Script, ref_words: list[tuple[str, int, str]], ayah: str, block: Script) -> Script:
    """``read`` with its stretch of ``ayah`` replaced by ``block``."""
    at = [i for i, word in enumerate(read[0]) if ref_words[word][0] == ayah]
    first, last = at[0], at[-1] + 1
    return read[0][:first] + block[0] + read[0][last:], read[1][:first] + block[1] + read[1][last:]


def _read(model, heard: list[int], ref_words: list[tuple[str, int, str]]) -> Script | None:
    units = units_for([(key, index) for key, index, _ in ref_words], model.table)
    if not units:
        log.warning("phoneme reading skipped: the passage does not line up with its phoneme table")
        return None
    runs = runs_recited(heard, [tokenize(unit.phonemes, model.tokens) for unit in units])
    if not runs:
        return None
    log.info("phoneme reading: %d runs, %d restart(s)", len(runs), len(runs) - 1)
    return script_from_runs(runs, units)


def _symbols(model, script: list[int], ref_words: list[tuple[str, int, str]]) -> list[int]:
    """A script as the phoneme symbols it would be heard as."""
    units = units_for([(ref_words[w][0], ref_words[w][1]) for w in script], model.table) or []
    return [s for unit in units for s in tokenize(unit.phonemes, model.tokens)]


# ---------------------------------------------------------------------------
# Before the passage: the isti'adha and basmala
# ---------------------------------------------------------------------------
#
# The isti'adha and basmala a reciter says before the passage, heard by a phoneme model.
#
# A recitation usually opens with أَعُوذُ بِٱللَّهِ مِنَ ٱلشَّيْطَـٰنِ ٱلرَّجِيمِ, the
# basmala, or both, before the first ayah of the passage. Neither is in the
# passage's text, so the aligner gives them nothing: the studio showed an empty
# card over them (At-Tahrim's opening 4.9 seconds). Fastconformer barely hears
# them -- it read that basmala as a single ي -- but both phoneme models read it
# cleanly, so the one that already re-times every match (`phoneme.chosen`)
# listens here too: nothing more to download, and none at all where re-timing is
# turned off.
#
# Only the audio before the passage's first aligned word is read, and an opening
# is reported only when it is plainly there. Its phonemes are the model's own
# spelling: the basmala is 1:1 as its table writes it, and the isti'adha is put
# together from 113:1's أَعُوذُ and 16:98's بِٱللَّهِ مِنَ ٱلشَّيْطَـٰنِ ٱلرَّجِيمِ,
# spelled there exactly as said. A passage that starts at 1:1 has its basmala as
# its first ayah already.
#
# Reported beside the captions, never among them, so nothing that reads
# captions -- grouping, Fewer / More, the gauge -- sees them.

#: kind -> (the words shown, the same words in the model's phonemes, one per word).
OPENINGS = {
    "istiadha": (
        "أَعُوذُ بِٱللَّهِ مِنَ ٱلشَّيْطَـٰنِ ٱلرَّجِيمِ",
        "ءَعُۥۥذُ بِللَااهِ مِنَ ششَيطَاانِ ررَجِۦۦۦۦم",
    ),
    "basmala": (
        "بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ",
        "بِسمِ للَااهِ ررَحمَاانِ ررَحِۦۦۦۦم",
    ),
}

#: Less speech than this before the passage is not an opening.
MIN_LEAD_SEC = 1.5

#: How far a heard opening may differ from its spelling, as a share of its symbols.
MAX_DIFFERENCE = 0.35


def best_match(target: list[int], heard: list[int]) -> tuple[int, int, int]:
    """Where ``target`` best fits inside ``heard``: (edit distance, first heard index, end heard index).

    Free to start and end anywhere in ``heard`` -- what else was said around it costs nothing.
    """
    n = len(heard)
    row = np.zeros(n + 1, dtype=np.int64)  # target prefix of length 0 matches anywhere for free
    origin = np.arange(n + 1)
    steps = np.arange(n + 1)
    heard_array = np.array(heard, dtype=np.int64)
    for symbol in target:
        diagonal = row[:-1] + (heard_array != symbol)
        down = row + 1
        new = down.copy()
        new_origin = origin.copy()
        better = diagonal < new[1:]
        new[1:] = np.where(better, diagonal, new[1:])
        new_origin[1:] = np.where(better, origin[:-1], origin[1:])
        # A heard symbol not in the target, between two that are, costs one;
        # a cell reached that way starts where the cell before it did.
        settled = np.minimum.accumulate(new - steps) + steps
        kept = np.maximum.accumulate(np.where(settled < new, 0, steps))
        row, origin = settled, new_origin[kept]
    end = int(np.argmin(row))
    return int(row[end]), int(origin[end]), end


def _heard_with_frames(log_probs: np.ndarray, blank: int) -> tuple[list[int], list[int]]:
    """A greedy reading and the frame each of its symbols began on."""
    symbols: list[int] = []
    frames: list[int] = []
    previous = blank
    for frame, symbol in enumerate(log_probs.argmax(-1).tolist()):
        if symbol != blank and symbol != previous:
            symbols.append(symbol)
            frames.append(frame)
        previous = symbol
    return symbols, frames


def find_openings(pcm: np.ndarray, before: float, first_verse: str, offset: float = 0.0) -> list[dict]:
    """The openings heard in the first ``before`` seconds, in order, with times against the whole recording.

    Each is ``{kind, text, start, end, words: [{text, start}]}``; ``end`` is
    where the next one, or the passage, begins. Listened for by the model that
    re-times every match (`phoneme.chosen`): nothing more to download, and
    nothing at all where re-timing is turned off.
    """
    heard = _listen(pcm, before)
    if heard is None:
        return []
    model, reading = heard
    # A passage that starts at 1:1 has its basmala as its first ayah already.
    kinds = [kind for kind in OPENINGS if not (kind == "basmala" and first_verse == "1:1")]
    found = sorted(filter(None, (_hear_opening(model, kind, reading) for kind in kinds)), key=lambda o: o["starts"][0])
    ends = [o["starts"][0] for o in found[1:]] + [before]
    out = [_as_reported(opening, end, offset) for opening, end in zip(found, ends)]
    if out:
        log.info("openings heard before the passage: %s", ", ".join(o["kind"] for o in out))
    return out


def _listen(pcm: np.ndarray, before: float) -> tuple[object, tuple[list[int], list[int]]] | None:
    """The listening model and its reading of the first ``before`` seconds, or None when there is nothing to listen for."""
    listener = phoneme.chosen("")
    if before < MIN_LEAD_SEC or listener is None:
        return None
    try:
        model = phoneme.load(listener)
        log_probs = model.emission(pcm[: int(before * SAMPLE_RATE)])[0].numpy()
    except Exception as exc:  # noqa: BLE001 -- never fail a match for an opening
        log.warning("openings not read: %s", exc)
        return None
    return model, _heard_with_frames(log_probs, model.blank)


def _hear_opening(model, kind: str, reading: tuple[list[int], list[int]]) -> dict | None:
    """One opening, if it was plainly said in ``reading`` (symbols and their frames): its words and when each starts."""
    text, spelled = OPENINGS[kind]
    heard, frames = reading
    per_word = [tokenize(word, model.tokens) for word in spelled.split()]
    target = [s for word in per_word for s in word]
    distance, first, last = best_match(target, heard) if heard else (len(target), 0, 0)
    if distance > MAX_DIFFERENCE * len(target) or last <= first:
        return None
    # Each word starts where its first symbol was heard, read off the same match.
    return {"kind": kind, "text": text, "words": text.split(), "starts": _word_starts(per_word, heard[first:last], frames[first:last])}


def _as_reported(opening: dict, end: float, offset: float) -> dict:
    return {
        "kind": opening["kind"],
        "text": opening["text"],
        "start": round(opening["starts"][0] + offset, 3),
        "end": round(end + offset, 3),
        "words": [{"text": w, "start": round(s + offset, 3)} for w, s in zip(opening["words"], opening["starts"])],
    }


def _word_starts(per_word: list[list[int]], heard: list[int], frames: list[int]) -> list[float]:
    """The time each word of an opening starts: its symbols matched in order against what was heard there."""
    starts: list[float] = []
    cursor = 0
    for word in per_word:
        _, first, _ = best_match(word, heard[cursor:]) if cursor < len(heard) else (0, 0, 0)
        at = min(cursor + first, len(frames) - 1)
        starts.append(frames[at] * phoneme.FRAME_SEC)
        cursor = min(len(heard), at + max(1, len(word) // 2))
    return starts
