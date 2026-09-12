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
#
# It also says whether a newer copy of The Clear Quran has been published. See
# scripts/clear-quran.mjs for what to do about it.
set -uo pipefail

cd "$(dirname "$(readlink -f "$0")")"
RUN_DIR=".run"
mkdir -p "$RUN_DIR"

MODE="dev"
[[ "${1:-}" == "--prod" ]] && MODE="prod"

DB_STATE="skipped"; ASR_STATE="skipped"; WEB_STATE="skipped"; TEXT_STATE="skipped"

alive() { [[ -f "$1" ]] && kill -0 "$(cat "$1")" 2>/dev/null; }

# --- database ---------------------------------------------------------------
printf '[1/4] database    ... '
if scripts/db.sh start >"$RUN_DIR/db.log" 2>&1; then
  DB_STATE="up on 127.0.0.1:5432"
  echo "up"
else
  DB_STATE="NOT running -- saves will fall back to memory (see $RUN_DIR/db.log)"
  echo "failed (the app still works; projects just won't persist)"
fi

# --- alignment sidecar ------------------------------------------------------
printf '[2/4] sidecar     ... '
# A sidecar already up is reused -- except when it is running code older than
# what is on disk. Python is loaded once at import, so editing the aligner and
# re-running this changed nothing: the service kept serving the old code, the
# same failure came back, and the fix looked like it had not worked. The pid
# file is written at launch, so anything under `app/` newer than it has not
# been loaded. Only ever checked against a pid this script wrote and that is
# still alive -- a leftover file from a previous run would compare against the
# wrong moment entirely.
SIDECAR_PID="$(cat "$RUN_DIR/asr.pid" 2>/dev/null || true)"
SIDECAR_STALE=""
if [[ -n "$SIDECAR_PID" ]] && kill -0 "$SIDECAR_PID" 2>/dev/null \
   && [[ -n "$(find asr-service/app -name '*.py' -newer "$RUN_DIR/asr.pid" -print -quit 2>/dev/null)" ]]; then
  SIDECAR_STALE=1
fi

if [[ -n "$SIDECAR_STALE" ]]; then
  kill "$SIDECAR_PID" 2>/dev/null || true
  for _ in $(seq 1 20); do kill -0 "$SIDECAR_PID" 2>/dev/null || break; sleep 0.5; done
fi

if [[ -z "$SIDECAR_STALE" ]] && curl -sf --max-time 2 http://127.0.0.1:8000/health >/dev/null 2>&1; then
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
    if [[ -n "$SIDECAR_STALE" ]]; then
      ASR_STATE="restarted on :8000 -- it was running code older than asr-service/app/"
      echo "restarted (app code had changed)"
    else
      ASR_STATE="up on :8000"
      echo "up"
    fi
  else
    ASR_STATE="did NOT come up -- see $RUN_DIR/asr.log"
    echo "failed (local alignment unavailable; Gemini matching still works)"
  fi
else
  ASR_STATE="no virtualenv -- see asr-service/README.md"
  echo "not installed"
fi

# --- web app ----------------------------------------------------------------
printf '[3/4] web app     ... '
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

# --- translation ------------------------------------------------------------
# One HEAD request against the source of The Clear Quran, which the studio
# serves from data/quran/ because quran.com only publishes it through an API we
# do not have live access to yet. Nothing is downloaded and nothing is changed
# here: this only says whether a newer version exists, because accepting one
# alters the words that go into published videos and that is not something a
# start script should do on its own. Three-second timeout, and being offline is
# not a failure -- the file is sitting right there either way.
printf '[4/4] translation ... '
TEXT_UPDATE=0
if [[ -f data/quran/english.json ]]; then
  TEXT_STATE="$(node scripts/clear-quran.mjs check 2>/dev/null)"
  # 10 means a newer version is waiting. Read as a code rather than by matching
  # the wording, so the two can be reworded independently.
  [[ $? -eq 10 ]] && TEXT_UPDATE=1
  [[ -z "$TEXT_STATE" ]] && TEXT_STATE="could not be checked"
else
  TEXT_STATE="not installed -- captions fall back to Saheeh International"
fi
echo "$TEXT_STATE"

cat <<SUMMARY

  database     $DB_STATE
  sidecar      $ASR_STATE
  web app      $WEB_STATE
  translation  $TEXT_STATE

  logs in $RUN_DIR/    stop with ./stop.sh
SUMMARY

# The command, on its own line, where it can be copied. Only when there is
# something to run it for: a newer translation changes the words that go into
# published videos, so it is offered rather than done.
if [[ "$TEXT_UPDATE" == 1 ]]; then
  cat <<UPDATE

  A newer copy of The Clear Quran has been published. Review it with:

      node scripts/clear-quran.mjs update

  It audits the download first and refuses one that has lost an ayah or gained
  a character this edition has never used. Nothing changes until it passes.

UPDATE
fi
