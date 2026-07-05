#!/usr/bin/env bash
# run.sh — start a static server from the patron repo root and run the frontend Playwright specs.
# Panels don't need the composer catalog, so a plain static server is enough (/api/* 404 → the
# app boots with defaults). Usage:  test/frontend/run.sh   (from anywhere)
#   PORT=9099   static-server port
#   BASE_URL    override to test a running instance instead (e.g. the :8088 container) — then no
#               static server is started.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PORT="${PORT:-9099}"
SPECS=("$HERE"/*.spec.mjs)

srv=""
if [ -z "${BASE_URL:-}" ]; then
  export BASE_URL="http://127.0.0.1:${PORT}/"
  ( cd "$ROOT" && exec python3 -m http.server "$PORT" --bind 127.0.0.1 ) >/dev/null 2>&1 &
  srv=$!
  # wait for it to answer
  for _ in $(seq 1 40); do
    if curl -sf -o /dev/null "http://127.0.0.1:${PORT}/index.html"; then break; fi
    sleep 0.25
  done
fi
cleanup() { [ -n "$srv" ] && kill "$srv" 2>/dev/null; }
trap cleanup EXIT

echo "BASE_URL=$BASE_URL"
rc=0
for spec in "${SPECS[@]}"; do
  echo "=== $(basename "$spec") ==="
  node "$spec" || rc=1
done
exit $rc
