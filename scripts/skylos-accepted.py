#!/usr/bin/env python3
"""Split a Skylos run into the findings that are accepted and the ones that block.

`.skylos/accepted.txt` covers the three rule families `skylos baseline` refuses
to record. It used to name each one by its exact ``file:line  RULE`` prefix,
which had the same fault the baseline has: the line number is part of the
match, so inserting or deleting lines above a finding makes it stop matching
and re-report as new. That is how a change which introduced nothing turned the
gate red, and it cannot be regenerated away -- `skylos baseline` never captures
these rules.

So an entry names a file, a rule, and how many of that rule that file is
allowed. No line numbers, nothing to drift. A third occurrence of a rule that
two are accepted for still blocks, and so does the first occurrence anywhere
else -- which is the property the gate exists for.

What this gives up against matching by line is that one accepted finding could
be replaced by a different finding of the same rule in the same file without
the gate noticing. That is a deliberate trade: the alternative is a file that
reds on every unrelated edit, and a check people learn to wave through is worse
than one that is slightly coarse.

Quoting the message instead would be more precise, and is not available: the
SKY-D260 entries match on prose, so writing the matched wording into the file
that accepts it makes that file a finding too.

Both files are named here rather than passed in. They are the two the gate
always uses, and a path that cannot come from outside is one nothing has to
validate.

Usage:  skylos-accepted.py

Prints ``#accepted <n>`` first, then one line per blocking finding.
"""
from __future__ import annotations

import collections
import os
import re
import sys
from collections.abc import Iterable

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG = os.path.join(ROOT, ".run", "verify-skylos.log")
ACCEPTED = os.path.join(ROOT, ".skylos", "accepted.txt")

FINDING = re.compile(r"^\s*(?P<path>\S+?):(?P<line>\d+)\s+(?P<rule>SKY-\S+)\s+(?P<msg>.*)$")
ENTRY = re.compile(r"^(?P<path>\S+)\s+(?P<rule>SKY-\S+)\s+(?P<count>\d+)$")


def parse_allowance(lines: Iterable[str], source: str = ACCEPTED) -> dict[tuple[str, str], int]:
    """Read the accepted list. Kept separate from the file so it can be tested."""
    allowed: dict[tuple[str, str], int] = {}
    for number, raw in enumerate(lines, 1):
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        match = ENTRY.match(line)
        if not match:
            raise SystemExit(
                f"{source}:{number}: expected '<file> <RULE> <count>', got {line!r}"
            )
        key = (match["path"], match["rule"])
        if key in allowed:
            raise SystemExit(f"{source}:{number}: {key[0]} {key[1]} is listed twice")
        allowed[key] = int(match["count"])
    return allowed


def classify(
    lines: Iterable[str], allowed: dict[tuple[str, str], int]
) -> tuple[int, list[str]]:
    """Count what the allowance covers, and return everything it does not.

    Occurrences are taken in the order Skylos reports them, which is why the
    allowance is a count rather than a set: the first two SKY-U006 in align.py
    are accepted wherever they have moved to, and a third one blocks.
    """
    seen: collections.Counter[tuple[str, str]] = collections.Counter()
    accepted = 0
    blocking: list[str] = []
    for raw in lines:
        match = FINDING.match(raw.rstrip("\n"))
        if not match or match["rule"].startswith("SKY-SCA-"):
            continue
        key = (match["path"], match["rule"])
        seen[key] += 1
        if seen[key] <= allowed.get(key, 0):
            accepted += 1
        else:
            blocking.append(raw.strip())
    return accepted, blocking


def main() -> int:
    with open(ACCEPTED, encoding="utf-8") as handle:
        allowed = parse_allowance(handle)
    with open(LOG, encoding="utf-8") as handle:
        accepted, blocking = classify(handle, allowed)

    print(f"#accepted {accepted}")
    for line in blocking:
        print(line)
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 1:
        print(__doc__, file=sys.stderr)
        raise SystemExit(2)
    raise SystemExit(main())
