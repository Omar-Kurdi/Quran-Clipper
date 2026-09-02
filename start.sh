#!/usr/bin/env bash
#
# Bring the whole studio up: database, alignment sidecar, web app.
#
# Each piece is optional on its own -- the app runs without a database (saving
# to memory) and without the sidecar (using the Gemini matcher, or a range you
# pick by hand) -- so this starts what it can and tells you plainly what came
# up and what did not, rather than failing everything because one thing is
# missing. That last part is the point: with three services logging into three
# places, "is the database actually up?" was not answerable at a glance.
#
# Usage:
#   ./start.sh          web app in dev mode (hot reload; use while editing)
#   ./start.sh --prod   build once, then serve the build (faster canvas/export)
#   ./stop.sh           stop everything this started
set -uo pipefail

cd "$(dirname "$(readlink -f "$0")")"
RUN_DIR=".run"
mkdir -p "$RUN_DIR"

MODE="dev"
[[ "${1:-}" == "--prod" ]] && MODE="prod"

DB_STATE="skipped"; ASR_STATE="skipped"; WEB_STATE="skipped"

alive() { [[ -f "$1" ]] && kill -0 "$(cat "$1")" 2>/dev/null; }

# --- database ---------------------------------------------------------------
printf '[1/3] database  ... '
if scripts/db.sh start >"$RUN_DIR/db.log" 2>&1; then
  DB_STATE="up on 127.0.0.1:5432"
  echo "up"
else
  DB_STATE="NOT running -- saves will fall back to memory (see $RUN_DIR/db.log)"
  echo "failed (the app still works; projects just won't persist)"
fi

# --- alignment sidecar ------------------------------------------------------
printf '[2/3] sidecar   ... '
if curl -sf --max-time 2 http://127.0.0.1:8000/health >/dev/null 2>&1; then
  ASR_STATE="already running on :8000"
  echo "already running"
elif [[ -x asr-service/.venv/bin/python ]]; then
  ( cd asr-service && exec ./run.sh ) >"$RUN_DIR/asr.log" 2>&1 &
  echo $! >"$RUN_DIR/asr.pid"
  # Loading the model is the slow part -- a cold CUDA start is 10-40s.
  for _ in $(seq 1 90); do
    curl -sf --max-time 2 http://127.0.0.1:8000/health >/dev/null 2>&1 && break
    sleep 1
  done
  if curl -sf --max-time 2 http://127.0.0.1:8000/health >/dev/null 2>&1; then
    ASR_STATE="up on :8000"
    echo "up"
  else
    ASR_STATE="did NOT come up -- see $RUN_DIR/asr.log"
    echo "failed (local alignment unavailable; Gemini matching still works)"
  fi
else
  ASR_STATE="no virtualenv -- see asr-service/README.md"
  echo "not installed"
fi

# --- web app ----------------------------------------------------------------
printf '[3/3] web app   ... '
if curl -sf --max-time 2 http://127.0.0.1:3000 >/dev/null 2>&1; then
  WEB_STATE="already running on :3000"
  echo "already running"
else
  if [[ "$MODE" == "prod" ]]; then
    echo -n "building... "
    if ! npm run build >"$RUN_DIR/build.log" 2>&1; then
      WEB_STATE="build FAILED -- see $RUN_DIR/build.log"
      echo "build failed"
      MODE="none"
    fi
  fi
  if [[ "$MODE" != "none" ]]; then
    if [[ "$MODE" == "prod" ]]; then npm run start >"$RUN_DIR/web.log" 2>&1 &
    else npm run dev >"$RUN_DIR/web.log" 2>&1 & fi
    echo $! >"$RUN_DIR/web.pid"
    for _ in $(seq 1 60); do
      curl -sf --max-time 2 http://127.0.0.1:3000 >/dev/null 2>&1 && break
      sleep 1
    done
    if curl -sf --max-time 2 http://127.0.0.1:3000 >/dev/null 2>&1; then
      WEB_STATE="up on http://localhost:3000 ($MODE)"
      echo "up"
    else
      WEB_STATE="did NOT come up -- see $RUN_DIR/web.log"
      echo "failed"
    fi
  fi
fi

cat <<SUMMARY

  database   $DB_STATE
  sidecar    $ASR_STATE
  web app    $WEB_STATE

  logs in $RUN_DIR/    stop with ./stop.sh
SUMMARY
