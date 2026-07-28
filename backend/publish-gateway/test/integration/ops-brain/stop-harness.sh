#!/usr/bin/env bash
set -euo pipefail

PID_FILE="${1:?usage: stop-harness.sh <pid-file>}"
[[ -f "$PID_FILE" ]] || exit 0
PID="$(<"$PID_FILE")"
if [[ "$PID" =~ ^[0-9]+$ ]] && kill -0 "$PID" 2>/dev/null; then
  kill -TERM "$PID"
  for _ in {1..100}; do kill -0 "$PID" 2>/dev/null || break; sleep 0.1; done
  kill -0 "$PID" 2>/dev/null && { echo 'TEST_ENVIRONMENT: harness did not stop' >&2; exit 1; }
fi
rm -f "$PID_FILE"
