#!/usr/bin/env python3
"""Rebuild the baseline Skylos reads from the committed portable copy.

Skylos writes absolute paths into a baseline for the quality and danger rules,
so the file it produces matches only the checkout that produced it -- measured
here, relativising those paths leaked 166 of 177 suppressed findings back. The
committed copy therefore writes the repository root as ``{ROOT}/``, and this
puts the real one back before every scan.

Usage:  skylos-baseline.py <portable.json> <baseline.json> <repo root>
"""
from __future__ import annotations

import json
import sys


def main(argv: list[str]) -> int:
    if len(argv) != 4:
        print(__doc__, file=sys.stderr)
        return 2
    portable, target, root = argv[1], argv[2], argv[3].rstrip("/")
    with open(portable, encoding="utf-8") as handle:
        data = json.load(handle)
    # Only the tokenised entries are rewritten. Some fingerprints are genuinely
    # relative -- the secrets rule records them that way -- and absolutising
    # those too would stop them matching anything.
    data.pop("_note", None)
    data["fingerprints"] = [f.replace("{ROOT}", root) for f in data["fingerprints"]]
    with open(target, "w", encoding="utf-8") as handle:
        json.dump(data, handle)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
