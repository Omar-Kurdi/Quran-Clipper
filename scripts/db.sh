#!/usr/bin/env bash
#
# Start, stop and check the Postgres container the app saves projects into.
#
# The app runs perfectly well without it -- saving falls back to memory -- so
# this is deliberately a separate command rather than something `npm run dev`
# starts for you. What it is not is something you should have to remember a
# 300-character `podman run` line for.
#
# Usage:  scripts/db.sh [start|stop|status|create|logs]
set -euo pipefail

NAME="quranclipper-db"
VOLUME="quranclipper-pgdata"
IMAGE="docker.io/library/postgres:16-alpine"

if command -v podman >/dev/null 2>&1; then
  RUNTIME=podman
elif command -v docker >/dev/null 2>&1; then
  RUNTIME=docker
else
  echo "error: neither podman nor docker is on PATH." >&2
  echo "The app still runs without a database -- saved projects just live in memory." >&2
  exit 1
fi

exists() { "$RUNTIME" container exists "$NAME" 2>/dev/null || "$RUNTIME" inspect "$NAME" >/dev/null 2>&1; }

create() {
  echo "creating $NAME ($IMAGE) with volume $VOLUME"
  "$RUNTIME" run -d --name "$NAME" --restart=unless-stopped \
    -e POSTGRES_USER=quranclipper \
    -e POSTGRES_PASSWORD=quranclipper \
    -e POSTGRES_DB=quranclipper \
    -p 5432:5432 \
    -v "$VOLUME":/var/lib/postgresql/data \
    "$IMAGE"
}

case "${1:-start}" in
  start)
    if exists; then
      "$RUNTIME" start "$NAME" >/dev/null && echo "$NAME started"
    else
      create
    fi
    printf 'waiting for postgres'
    for _ in $(seq 1 30); do
      if "$RUNTIME" exec "$NAME" pg_isready -U quranclipper >/dev/null 2>&1; then
        echo " -- ready on 127.0.0.1:5432"
        echo "If this is a new database, run: npm run db:push"
        exit 0
      fi
      printf '.'
      sleep 1
    done
    echo
    echo "error: it did not become ready. Try: scripts/db.sh logs" >&2
    exit 1
    ;;
  stop)   "$RUNTIME" stop "$NAME" >/dev/null && echo "$NAME stopped" ;;
  status)
    if exists; then
      "$RUNTIME" ps -a --filter "name=$NAME" --format '{{.Names}}  {{.Status}}'
      "$RUNTIME" exec "$NAME" pg_isready -U quranclipper 2>/dev/null || echo "not accepting connections"
    else
      echo "$NAME does not exist yet -- run: npm run db:start"
    fi
    ;;
  create) create ;;
  logs)   "$RUNTIME" logs --tail 40 "$NAME" ;;
  *) echo "usage: scripts/db.sh [start|stop|status|create|logs]" >&2; exit 2 ;;
esac
