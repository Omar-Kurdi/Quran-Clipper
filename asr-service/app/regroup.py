"""Recent matches, kept so the studio can cut one again at another screen-break setting.

Fewer / More only moves how much silence ends a caption (`align.BREAK_SCALES`).
Everything before that -- reading the audio, finding the passage, placing every
word -- is the slow part and does not depend on the setting, so it is kept here
and `/regroup` repeats only the grouping. That turns a change of setting from a
new match into a fraction of a second.

Kept in this process's memory and nowhere else. A restart, a second worker or
an evicted entry all look the same to the caller: the id is unknown, and the
answer is to match again.
"""

from __future__ import annotations

import os
import secrets
import threading
from collections import OrderedDict
from dataclasses import dataclass
from typing import TYPE_CHECKING

from .audio import SAMPLE_RATE

if TYPE_CHECKING:  # the type only; a held match is built by `main`, which has the aligner
    from .align import Grouping

#: Total recording kept across every held match, in seconds of audio. The audio
#: is the bulk of an entry (a float32 sample per 1/16000s, about 3.8 MB a
#: minute), so the cap is on that rather than on a count: half an hour is about
#: 115 MB, and the oldest match goes first.
MAX_KEPT_SECONDS = float(os.getenv("REGROUP_KEPT_SECONDS", "1800"))


@dataclass
class Kept:
    grouping: Grouping
    #: The `/align` response as sent, whose segments a regroup replaces.
    response: dict
    #: Where a built-in reciter's window starts in its recording; see `/align`.
    window_offset: float

    @property
    def seconds(self) -> float:
        return len(self.grouping.pcm) / SAMPLE_RATE


_kept: OrderedDict[str, Kept] = OrderedDict()
_lock = threading.Lock()


def keep(entry: Kept) -> str:
    """Hold a match and return the id that asks for it again."""
    key = secrets.token_urlsafe(16)
    with _lock:
        _kept[key] = entry
        while len(_kept) > 1 and sum(kept.seconds for kept in _kept.values()) > MAX_KEPT_SECONDS:
            _kept.popitem(last=False)
    return key


def find(key: str) -> Kept | None:
    """The match held under `key`, or None once it has gone."""
    with _lock:
        entry = _kept.get(key)
        if entry is not None:
            _kept.move_to_end(key)
        return entry
