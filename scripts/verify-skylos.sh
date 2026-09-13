#!/usr/bin/env bash
#
# The Skylos gate: block on findings this change introduced, not on the ones
# that were already here.
#
# Kept out of `npm run verify` deliberately. A scan takes about 50 seconds
# against that tier's seven, and a check slow enough to skip is a check people
# skip. Run this before calling a change done, and in CI.
#
# How the ratchet works
# ---------------------
# `.skylos/baseline.json` records what this repo already had when the gate went
# in -- 1053 findings. `--baseline` reports only what is not in it. A clean tree
# scores zero; a new problem in code you just wrote does not.
#
# `.skylos/accepted.txt` covers the handful `skylos baseline` refuses to record
# (it never captures SKY-U006, SKY-E003 or SKY-SCA-*, whatever it is told). Each
# line there is one pre-existing finding, with its reason written beside it.
#
# Neither file is a dumping ground. Adding an entry to either to get a green run
# is the one thing this gate exists to stop.
#
# Why there is no --diff / --diff-base here
# -----------------------------------------
# Both flags were measured against this repo and both are unusable. `--diff`
# does not filter at all: 388 findings with it, 388 without, silently, on any
# base ref. `--diff-base` does filter, but only on COMMITTED diffs -- so with
# uncommitted work in the tree it sees nothing changed and reports nothing. A
# probe file containing eval(), a hardcoded credential and a concatenated SQL
# string passed the gate with exit 0 while it was in use. A gate that green-
# lights that is worse than no gate, so the whole tree is scanned every run and
# the baseline does the filtering instead.
#
# Why dead code is baselined rather than blocking
# -----------------------------------------------
# Skylos does not resolve same-file call sites in TypeScript, so it reports
# helpers as unused when they are called a few lines below. Measured here:
# `nextConfig` flagged unused while next.config.ts:35 exports it; likewise
# `getDbBindings`, `probeDatabase`, `probeAligner` and `needsReview`, each with
# call sites in its own file. False positives have no honest fix, only
# suppression, so they sit in the baseline as a documented class. Python dead
# code does scan accurately -- the unused numpy import in app/main.py is real.
#
# Why dependency CVEs do not fail this gate
# -----------------------------------------
# SKY-SCA-* findings describe the dependency tree, not the code in front of you,
# and 16 are outstanding (next, python-multipart). They print as advisory every
# run so they stay visible, and never change the exit code.
#
# Nothing is ever uploaded: --no-upload is passed on every invocation, so a scan
# cannot ship this code to Skylos Cloud even if credentials are present.
#
# Usage:  scripts/verify-skylos.sh
set -uo pipefail

cd "$(dirname "$(readlink -f "$0")")/.."

RUN_DIR=".run"; mkdir -p "$RUN_DIR"
LOG="$RUN_DIR/verify-skylos.log"
BASELINE=".skylos/baseline.json"
ACCEPTED=".skylos/accepted.txt"

fail() { echo; echo "  $*"; echo; exit 1; }

# Skylos lives wherever it was installed. `.venv/` is self-ignored by the
# .gitignore the virtualenv writes into itself, so a clean checkout and CI will
# not have it -- hence a candidate list and an explicit failure, never a skip.
SKY=""
SKY_DIAG=()
for candidate in ".venv/bin/skylos" "${SKYLOS:-}" "skylos"; do
  [[ -n "$candidate" ]] || continue
  if ! command -v "$candidate" >/dev/null 2>&1; then
    SKY_DIAG+=("$candidate -- not found")
    continue
  fi
  SKY="$candidate"
  break
done

if [[ -z "$SKY" ]]; then
  echo
  echo "  Skylos is not installed, so this check did not run."
  echo
  echo "  It is required, not optional: a gate that quietly does nothing is"
  echo "  worse than no gate. Install it with either of:"
  echo "      python3 -m venv .venv && .venv/bin/pip install skylos"
  echo "      SKYLOS=/path/to/skylos scripts/verify-skylos.sh"
  echo
  echo "  Candidates tried:"
  printf '      %s\n' "${SKY_DIAG[@]}"
  echo
  exit 1
fi

# The baseline records absolute paths for the quality and danger rules, so it
# only matches on the machine that generated it. Measured: relativising those
# paths leaked 166 of 177 suppressed findings straight back. Regenerate after a
# move, a rename, or a fresh clone elsewhere.
[[ -f "$BASELINE" ]] || fail "No $BASELINE. Create it once with:
      $SKY baseline . -a --no-upload
  The paths inside are absolute, so each checkout needs its own."

echo
echo "  skylos     $("$SKY" --version 2>&1 | head -1)"
echo "  baseline   $BASELINE"
printf '  scanning   ... '

"$SKY" . -a --no-upload --baseline --format concise >"$LOG" 2>&1
echo "done"

# One scan, three verdicts: dependency findings are advisory, accepted ones are
# named in a committed file, everything else blocks.
ACCEPT_RE="$RUN_DIR/skylos-accepted.tmp"
grep -vE '^\s*#|^\s*$' "$ACCEPTED" 2>/dev/null >"$ACCEPT_RE" || : >"$ACCEPT_RE"

ALL="$(grep -E '  SKY-' "$LOG" | grep -v '  SKY-SCA-' || true)"
if [[ -s "$ACCEPT_RE" ]]; then
  NEW="$(printf '%s\n' "$ALL" | grep -vFf "$ACCEPT_RE" || true)"
else
  NEW="$ALL"
fi
SCA_COUNT="$(grep -cE '  SKY-SCA-' "$LOG" || true)"
ACCEPTED_SEEN="$(printf '%s\n' "$ALL" | grep -cFf "$ACCEPT_RE" 2>/dev/null || true)"
rm -f "$ACCEPT_RE"

echo
if [[ -n "${NEW//[[:space:]]/}" ]]; then
  echo "  BLOCKING -- $(printf '%s\n' "$NEW" | wc -l) finding(s) not in the baseline:"
  echo
  printf '%s\n' "$NEW" | sed 's/^/    /'
  echo
  echo "  These are not pre-existing. Investigate and fix them; do not add them"
  echo "  to $BASELINE or $ACCEPTED to get a green run."
  echo "  Full output: $LOG"
  echo
  exit 1
fi

echo "  no new findings outside the baseline"
(( ACCEPTED_SEEN > 0 )) && echo "  accepted: $ACCEPTED_SEEN known pre-existing finding(s) -- see $ACCEPTED"
(( SCA_COUNT > 0 ))     && echo "  advisory: $SCA_COUNT dependency CVE(s) outstanding -- see $LOG"
echo
echo "  skylos gate passed"
