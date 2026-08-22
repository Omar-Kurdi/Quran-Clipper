#!/usr/bin/env bash
#
# Start the alignment sidecar using this project's virtualenv, always.
#
# Running `uvicorn` off PATH is the one way this service reliably breaks: bash
# caches the first `uvicorn` it resolves, so activating the virtualenv in a
# shell that already ran the system one keeps using the system one (`hash -r`
# clears that). NeMo then fails to import against the wrong interpreter's
# protobuf/onnx, and every /align request 400s. Calling the venv's binary by
# absolute path sidesteps all of it.
#
# Usage:  ./run.sh [--host H] [--port P] [any other uvicorn flags]
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

VENV_PY=".venv/bin/python"
if [[ ! -x "$VENV_PY" ]]; then
  echo "error: $PWD/$VENV_PY not found." >&2
  echo "Create it first:" >&2
  echo "  python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt" >&2
  exit 1
fi

HOST="127.0.0.1"
PORT="8000"
EXTRA=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    *) EXTRA+=("$1"); shift ;;
  esac
done

echo "sidecar: $("$VENV_PY" --version) at $PWD/$VENV_PY"

# `python -m uvicorn` rather than the console script, so it cannot depend on a
# shebang that a directory rename would invalidate.
exec "$VENV_PY" -m uvicorn app.main:app --host "$HOST" --port "$PORT" ${EXTRA[@]+"${EXTRA[@]}"}
