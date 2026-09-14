"""Checks on the accepted-findings matcher that stands in front of the Skylos gate.

The gate is the thing that decides whether a change ships, so the rule it
applies has to be the rule it claims. The property being protected here is the
one that failed in practice: an accepted finding must keep being accepted when
the lines above it move, and a NEW occurrence must still block.

Run from the repo root:
    asr-service/.venv/bin/python scripts/test_skylos_accepted.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import importlib.util  # noqa: E402

spec = importlib.util.spec_from_file_location(
    "skylos_accepted", os.path.join(os.path.dirname(os.path.abspath(__file__)), "skylos-accepted.py")
)
matcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(matcher)

FAILED: list[str] = []


def check(name: str, *, condition: bool, detail: str = "") -> None:
    print(f"  {'PASS' if condition else 'FAIL'}  {name}")
    if not condition:
        if detail:
            print(f"        {detail}")
        FAILED.append(name)


ALLOWED = matcher.parse_allowance([
    "# a comment",
    "",
    "asr-service/app/align.py  SKY-U006  2",
    "drizzle.config.ts  SKY-E003  1",
])

check(
    "an entry parses to a file, a rule and a count",
    condition=ALLOWED == {("asr-service/app/align.py", "SKY-U006"): 2,
                          ("drizzle.config.ts", "SKY-E003"): 1},
    detail=str(ALLOWED),
)

# The fault this replaced: these two are the same findings the allowance was
# written for, at the line numbers they reach after something above them moves.
accepted, blocking = matcher.classify([
    "asr-service/app/align.py:1799  SKY-U006  unused parameter: ref_words",
    "asr-service/app/align.py:2320  SKY-U006  unused parameter: duration",
], ALLOWED)
check("moving the lines above a finding does not make it new", condition=(accepted, blocking) == (2, []),
      detail=f"accepted={accepted} blocking={blocking}")

accepted, blocking = matcher.classify([
    "asr-service/app/align.py:1759  SKY-U006  unused parameter: ref_words",
    "asr-service/app/align.py:2280  SKY-U006  unused parameter: duration",
    "asr-service/app/align.py:99  SKY-U006  unused parameter: whatever",
], ALLOWED)
check("a third occurrence blocks where two are accepted", condition=(accepted, len(blocking)) == (2, 1),
      detail=f"accepted={accepted} blocking={blocking}")

accepted, blocking = matcher.classify([
    "src/lib/forcedAligner.ts:12  SKY-E003  Unused TypeScript/JavaScript file",
], ALLOWED)
check("the same rule in another file blocks", condition=(accepted, len(blocking)) == (0, 1),
      detail=f"accepted={accepted} blocking={blocking}")

accepted, blocking = matcher.classify([
    "asr-service/app/align.py:1759  SKY-D999  something else entirely",
], ALLOWED)
check("another rule in an accepted file blocks", condition=(accepted, len(blocking)) == (0, 1),
      detail=f"accepted={accepted} blocking={blocking}")

accepted, blocking = matcher.classify([
    "package-lock.json:1  SKY-SCA-1234  some dependency advisory",
], ALLOWED)
check("dependency advisories are neither accepted nor blocking", condition=(accepted, blocking) == (0, []),
      detail=f"accepted={accepted} blocking={blocking}")

accepted, blocking = matcher.classify(["  scanning ... done", ""], ALLOWED)
check("lines that are not findings are ignored", condition=(accepted, blocking) == (0, []))

try:
    matcher.parse_allowance(["asr-service/app/align.py:1759  SKY-U006"])
    check("a line-numbered entry is refused", condition=False, detail="it was accepted")
except SystemExit as error:
    check("a line-numbered entry is refused", condition="expected" in str(error), detail=str(error))

try:
    matcher.parse_allowance(["a.ts  SKY-E003  1", "a.ts  SKY-E003  2"])
    check("the same file and rule twice is refused", condition=False, detail="it was accepted")
except SystemExit as error:
    check("the same file and rule twice is refused", condition="twice" in str(error), detail=str(error))

# The committed file has to parse, or the gate cannot run at all.
with open(matcher.ACCEPTED, encoding="utf-8") as handle:
    live = matcher.parse_allowance(handle)
check("the committed accepted.txt parses", condition=len(live) > 0, detail=str(live))

print(f"\n{'FAILED: ' + ', '.join(FAILED) if FAILED else 'all checks passed'}")
sys.exit(1 if FAILED else 0)
