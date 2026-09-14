#!/usr/bin/env bash
#
# The fast verification tier: every check that is hermetic, needs no audio, no
# model and no GPU, and finishes in seconds.
#
# Run this before calling a change done. It is deliberately NOT the whole
# story: changes to the aligner must also pass ./gauge.sh, which needs
# recordings and a loaded model and so can run neither here nor in CI. See
# docs/ALIGNMENT.md.
#
# Every step here is required. There is no mode in which a check is passed
# over and the run still reports success -- a verification that quietly did
# less than it claims is worse than none, because it is believed. If the
# alignment rules cannot run, this fails and says exactly why.
#
# Later steps still run after an earlier one fails, so one broken check does
# not hide three others. Per-step output goes to .run/verify-*.log.
#
# Usage:  scripts/verify.sh
set -uo pipefail

cd "$(dirname "$(readlink -f "$0")")/.."

RUN_DIR=".run"; mkdir -p "$RUN_DIR"
SUMMARY=(); FAILED=0

run() {  # run <label> <slug> <command...>
  local label="$1" slug="$2"; shift 2
  local log="$RUN_DIR/verify-$slug.log"
  printf '  %-20s ... ' "$label"
  if "$@" >"$log" 2>&1; then
    echo "pass"
    SUMMARY+=("$(printf '  %-20s pass' "$label")")
  else
    echo "FAILED  (see $log)"
    SUMMARY+=("$(printf '  %-20s FAILED -- %s' "$label" "$log")")
    FAILED=1
  fi
}

# The rules test needs an interpreter that can import numpy, and nothing more:
# align.py imports torch, NeMo and transformers lazily inside functions, so
# none of the heavy stack has to be installed to check the rules. Measured --
# a bare venv holding numpy and nothing else runs all 50 checks.
#
# Prefer the sidecar's own virtualenv, so the rules are checked against the
# interpreter that actually serves alignment; fall back to $PYTHON for a
# deliberate override, then to python3 on PATH, which is what a clean checkout
# and CI will have. Every rejection is recorded, so a failure can say which
# candidates were tried and what was wrong with each rather than just "no".
PY=""
PY_DIAG=()
for candidate in "asr-service/.venv/bin/python" "${PYTHON:-}" "python3"; do
  [[ -n "$candidate" ]] || continue
  if ! command -v "$candidate" >/dev/null 2>&1; then
    PY_DIAG+=("$candidate -- not found")
    continue
  fi
  if ! "$candidate" -c 'import numpy' >/dev/null 2>&1; then
    PY_DIAG+=("$candidate -- found, but it cannot import numpy")
    continue
  fi
  PY="$candidate"
  break
done

echo
run "typecheck"  typecheck  npx tsc --noEmit
run "lint"       lint       npx eslint .
run "unit tests" unit       npx vitest run

if [[ -n "$PY" ]]; then
  run "alignment rules" alignment-rules "$PY" scripts/test_alignment_rules.py
  # The Skylos gate decides whether a change ships, so the rule it applies is
  # checked here rather than only in the gate that applies it.
  run "gate matcher" skylos-accepted "$PY" scripts/test_skylos_accepted.py
else
  printf '  %-20s ... FAILED  (no usable interpreter)\n' "alignment rules"
  SUMMARY+=("$(printf '  %-20s FAILED -- no Python with numpy' "alignment rules")")
  FAILED=1
fi

echo
printf '%s\n' "${SUMMARY[@]}"
echo

if [[ -z "$PY" ]]; then
  cat <<'MISSING'
  The alignment rules could not be checked: no Python interpreter with numpy.

  This step is required, so the run is a failure rather than a pass with a
  hole in it. It needs numpy and nothing else -- not torch, not NeMo, not a
  GPU -- because the aligner imports the heavy stack lazily.

  Any one of these fixes it:
      pip install numpy
      PYTHON=/path/to/python scripts/verify.sh
      python3.12 -m venv asr-service/.venv \
        && asr-service/.venv/bin/pip install -r asr-service/requirements.txt

  Candidates tried:
MISSING
  printf '      %s\n' "${PY_DIAG[@]}"
  echo
fi

if (( FAILED )); then
  echo "  verification FAILED -- logs in $RUN_DIR/verify-*.log"
  exit 1
fi
echo "  verification passed"
