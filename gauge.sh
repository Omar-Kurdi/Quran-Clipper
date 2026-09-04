#!/usr/bin/env bash
#
# Score the aligner against every ground-truth file in scripts/.
#
# This is the answer to "did that change make segmentation better or worse?".
# Each `scripts/expected_*.txt` says what the captions should be for one
# recording; this re-runs the aligner on each and counts how many it gets
# exactly right. One number per clip, one total at the end.
#
# Nothing to remember: the files written by the studio's "Ground truth" button
# carry their own clip name, passage and trim window, so this needs no
# arguments. Audio is not committed, so a clip whose mp3 is missing is skipped
# and named rather than failing the run.
#
# Usage:
#   ./gauge.sh              score every ground-truth file
#   ./gauge.sh test3        score only the ones matching "test3"
set -uo pipefail
cd "$(dirname "$(readlink -f "$0")")"

FILTER="${1:-}"
PY="asr-service/.venv/bin/python"
RUN_DIR=".run"; mkdir -p "$RUN_DIR"

[[ -x "$PY" ]] || { echo "No virtualenv at $PY -- see asr-service/README.md."; exit 1; }

shopt -s nullglob
FILES=(scripts/expected_*.txt)
[[ -n "$FILTER" ]] && FILES=(scripts/expected_*"$FILTER"*.txt)
(( ${#FILES[@]} )) || {
  echo "No ground truth in scripts/."
  echo "Correct a timeline in the studio, click \"Ground truth\", and drop the file there."
  exit 1
}

printf '\n  %-26s %-22s %s\n' "clip" "passage" "score"
printf '  %s\n' "------------------------------------------------------------------"

TOTAL_HIT=0; TOTAL_EXP=0; SKIPPED=()

for file in "${FILES[@]}"; do
  name="$(basename "$file")"
  log="$RUN_DIR/gauge-${name%.txt}.log"

  # Every file gets the same call: the studio writes a metadata block, and the
  # two files that predate it are read from their prose header instead.
  "$PY" scripts/eval_segments.py "$file" >"$log" 2>&1

  line="$(grep -m1 '^SCORE:' "$log" || true)"
  if [[ -z "$line" ]]; then
    reason="$(grep -m1 -iE 'not in the repo root|no ground truth|carries no|Error|Traceback' "$log" | cut -c1-58)"
    SKIPPED+=("$name -- ${reason:-see $log}")
    continue
  fi

  hits="$(sed -E 's/^SCORE: ([0-9]+)\/([0-9]+).*/\1/' <<<"$line")"
  total="$(sed -E 's/^SCORE: ([0-9]+)\/([0-9]+).*/\2/' <<<"$line")"
  clip="$(sed -nE 's/^# clip:[[:space:]]*//p;s/^# Ground truth for ([^ ]+) .*/\1/p' "$file" | head -1)"
  passage="$(sed -nE 's/^# passage:[[:space:]]*//p;s/^# Ground truth for [^(]*\(([^)]*[0-9]+:[0-9]+-[0-9]+)\).*/\1/p' "$file" | head -1)"
  trim="$(sed -nE 's/^# trim:[[:space:]]*//p' "$file" | head -1)"
  [[ "$trim" == "none" || -z "$trim" ]] || passage="$passage (trimmed)"

  TOTAL_HIT=$(( TOTAL_HIT + hits )); TOTAL_EXP=$(( TOTAL_EXP + total ))
  printf '  %-26s %-22s %s/%s\n' "${clip:-${name}}" "${passage:-33:21-23}" "$hits" "$total"
done

printf '  %s\n' "------------------------------------------------------------------"
if (( TOTAL_EXP > 0 )); then
  printf '  %-49s %s/%s\n\n' "TOTAL" "$TOTAL_HIT" "$TOTAL_EXP"
else
  printf '  %-49s %s\n\n' "TOTAL" "nothing scored"
fi

if (( ${#SKIPPED[@]} )); then
  echo "  skipped:"
  printf '    %s\n' "${SKIPPED[@]}"
  echo
fi

# Ground truth is not the whole story, and treating it as such is a trap this
# project has already fallen into: a threshold can score better on every
# scoreable clip while breaking a case reported by ear on a clip nobody has
# written ground truth for yet. `test_reported_cases.py` is those reports.
# A change is only good if BOTH of these agree.
for suite in test_reported_cases test_alignment_rules; do
  log="$RUN_DIR/gauge-$suite.log"
  "$PY" "scripts/$suite.py" >"$log" 2>&1
  pass="$(grep -c '^  PASS' "$log" || true)"
  fail="$(grep -c '^  FAIL' "$log" || true)"
  if (( fail > 0 )); then
    printf '  %-49s %s passed, %s FAILED\n' "$suite" "$pass" "$fail"
    grep '^  FAIL' "$log" | sed 's/^  FAIL/    broken:/' | cut -c1-100
  else
    printf '  %-49s %s passed\n' "$suite" "$pass"
  fi
done
echo
echo "  full output in $RUN_DIR/gauge-*.log"
