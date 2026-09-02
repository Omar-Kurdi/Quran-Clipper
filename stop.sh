#!/usr/bin/env bash
#
# Stop what ./start.sh started. Leaves anything you started yourself alone:
# only processes with a pid file here are stopped, so a sidecar you are
# running in your own terminal is not killed out from under you.
#
# Usage:  ./stop.sh [--keep-db]
set -uo pipefail

cd "$(dirname "$(readlink -f "$0")")"
RUN_DIR=".run"

stop_pid() {
  local name="$1" file="$RUN_DIR/$2"
  printf '%-10s ... ' "$name"
  if [[ ! -f "$file" ]]; then echo "not started by ./start.sh"; return; fi
  local pid; pid="$(cat "$file")"
  if kill -0 "$pid" 2>/dev/null; then
    # The pid is the npm/bash wrapper; its children are the real server, so
    # signal the whole process group or the port stays bound.
    kill -TERM -- "-$(ps -o pgid= "$pid" | tr -d ' ')" 2>/dev/null || kill "$pid" 2>/dev/null
    for _ in $(seq 1 10); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null
    echo "stopped"
  else
    echo "already stopped"
  fi
  rm -f "$file"
}

stop_pid "web app" web.pid
stop_pid "sidecar" asr.pid

printf '%-10s ... ' "database"
if [[ "${1:-}" == "--keep-db" ]]; then
  echo "left running (--keep-db)"
else
  scripts/db.sh stop >/dev/null 2>&1 && echo "stopped" || echo "not running"
fi
