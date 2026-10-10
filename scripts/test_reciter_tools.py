"""Fast checks on the reciter tools in scripts/reciters that need no model and no recording.

Run from the repo root:
    asr-service/.venv/bin/python scripts/test_reciter_tools.py
"""
from __future__ import annotations

import importlib.util
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "reciters"))

import listen  # noqa: E402

# By path, as test_eval_segments.py loads eval_segments: imported by name, CI's Skylos reads `ends` as a PyPI package.
_spec = importlib.util.spec_from_file_location("ends", os.path.join(os.path.dirname(__file__), "reciters", "ends.py"))
ends = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ends)

FAILED: list[str] = []


def check(name: str, *, ok: bool, detail: str = "") -> None:
    print(f"  {'PASS' if ok else 'FAIL'}  {name}")
    if not ok:
        if detail:
            print(f"        {detail}")
        FAILED.append(name)


class FakeEar:
    """Hears one symbol, 'm', 50 frames (2.0s) into whatever it is given -- as the model does, from 0s at the earliest."""

    model = SimpleNamespace(tokens={"m": 1})

    def heard(self, who: str, surah: int, start: float, end: float) -> tuple[list[int], list[int]]:
        return [1], [50]


def marks_from_zero() -> None:
    # A span starting before the recording is read from 0s, so what is heard 2.0s in is at 2.0s, not 0.7s.
    # (Every 101:2 move was judged against marks 1.3s early.)
    out = listen.decoded(FakeEar(), "tunaiji", 101, (-1.3, 4.0))
    check("listen marks a span starting before 0s from 0s", ok=out.strip() == "[2.0] m", detail=out)
    out = listen.decoded(FakeEar(), "tunaiji", 101, (10.0, 14.0))
    check("listen marks a span from its start", ok=out.strip() == "[12.0] m", detail=out)


def openings_in_gaps() -> None:
    # Al-Shatri's 6:80: 6:79 ends at 1506.49s, QUL lists 6:80 from 1529.44s, its opening heard at 1509.36s (cost 0.214).
    record = {"q": 1529.44, "near": [[1529.9, 0.1]], "heard": [[1509.36, 0.214], [1528.5, 0.1], [1505.0, 0.1], [1510.0, 0.4]]}
    found = listen.heard_in_gap(record, 1506.49)
    check("an opening heard loosely in the gap before a published start is listed", ok=found == [(1509.36, 0.214)],
          detail=str(found))
    check("nothing is listed when the opening is heard only at the published start",
          ok=listen.heard_in_gap({"q": 30.3, "near": [[30.6, 0.1]]}, 30.1) == [])


def held_ends() -> None:
    # Al-Muaiqly's 1:5: listed to 36.43s, his نَسْتَعِينُ held to about 37.96s, a pause, 1:6 at 38.2s.
    frames = [-20.0] * int(37.96 / ends.HOP) + [-60.0] * int(1.0 / ends.HOP)
    held = ends.check(frames, -40.0, "1:5", 36.43, 38.2)
    check("an ayah whose last word is still held ends where the voice stops",
          ok=held["status"] == "held" and abs(held["voicedTo"] - 37.96) < 0.05, detail=str(held))
    quiet = ends.check([-20.0] * int(36.5 / ends.HOP) + [-60.0] * 100, -40.0, "1:5", 36.43, 38.2)
    check("an ayah followed by a pause keeps its end", ok=quiet["status"] == "kept", detail=str(quiet))
    onward = ends.check([-20.0] * int(40 / ends.HOP), -40.0, "1:5", 36.43, 38.2)
    check("voice running into the next ayah is left for listening, not moved",
          ok=onward["status"] == "review", detail=str(onward))


if __name__ == "__main__":
    marks_from_zero()
    openings_in_gaps()
    held_ends()
    if FAILED:
        print(f"\n{len(FAILED)} failed")
        sys.exit(1)
    print("\nall passed")
