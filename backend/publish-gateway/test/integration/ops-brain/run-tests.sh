#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../../.." && pwd)"
LAB=""
while [[ $# -gt 0 ]]; do
  case "$1" in --lab) LAB="$2"; shift 2;; *) echo "TEST_ENVIRONMENT: unknown argument $1" >&2; exit 2;; esac
done
[[ -n "$LAB" ]] || { echo 'TEST_ENVIRONMENT: --lab is required' >&2; exit 2; }
LAB="$(realpath -m "$LAB")"
mkdir -p "$LAB/database" "$LAB/logs" "$LAB/run" "$LAB/secrets"
umask 077
cd "$REPO_ROOT"
npm run build:harness
"$REPO_ROOT/node_modules/.bin/vitest" run test/integration/ops-brain/harness.test.ts

failure_layer='TEST_ENVIRONMENT'
active_pid_file=''
on_exit() {
  status=$?
  if [[ -n "$active_pid_file" ]]; then "$SCRIPT_DIR/stop-harness.sh" "$active_pid_file" || true; fi
  if [[ $status -ne 0 ]]; then echo "$failure_layer" >&2; fi
  exit "$status"
}
trap on_exit EXIT INT TERM
for iteration in 1 2 3; do
  run_id="$(date -u +%Y%m%dT%H%M%SZ)-$iteration"
  run_dir="$LAB/run/$run_id"
  db="$LAB/database/$run_id.sqlite"
  port_file="$run_dir/port"
  pid_file="$run_dir/harness.pid"
  log_file="$LAB/logs/harness-$run_id.log"
  token_file="$LAB/secrets/bridge.token"
  mkdir -p "$run_dir"
  python3 -c 'import secrets; print(secrets.token_urlsafe(48))' > "$token_file"
  chmod 600 "$token_file"
  start_time="$(date +%s)"
  cleanup=false
  "$SCRIPT_DIR/run-harness.sh" --host 127.0.0.1 --port 0 --port-file "$port_file" --database "$db" --seed "$SCRIPT_DIR/fixture.json" --token-file "$token_file" >"$log_file" 2>&1 &
  harness_pid=$!
  printf '%s\n' "$harness_pid" > "$pid_file"
  active_pid_file="$pid_file"
  for _ in {1..100}; do [[ -s "$port_file" ]] && break; sleep 0.1; done
  [[ -s "$port_file" ]] || { cat "$log_file" >&2; exit 1; }
  port="$(<"$port_file")"
  node "$REPO_ROOT/dist-harness/test/integration/ops-brain/http-verification.js" --port-file "$port_file" --token-file "$token_file" >>"$log_file" 2>&1 || { failure_layer='PUBLISHOS_API'; exit 1; }
  "$SCRIPT_DIR/stop-harness.sh" "$pid_file"
  active_pid_file=''
  disabled_port_file="$run_dir/disabled-port"
  disabled_pid_file="$run_dir/disabled-harness.pid"
  disabled_db="$LAB/database/$run_id.disabled.sqlite"
  "$SCRIPT_DIR/run-harness.sh" --host 127.0.0.1 --port 0 --port-file "$disabled_port_file" --database "$disabled_db" --seed "$SCRIPT_DIR/fixture.json" --token-file "$token_file" --bridge-disabled >>"$log_file" 2>&1 &
  disabled_pid=$!
  printf '%s\n' "$disabled_pid" > "$disabled_pid_file"
  active_pid_file="$disabled_pid_file"
  for _ in {1..100}; do [[ -s "$disabled_port_file" ]] && break; sleep 0.1; done
  [[ -s "$disabled_port_file" ]] || { cat "$log_file" >&2; exit 1; }
  node "$REPO_ROOT/dist-harness/test/integration/ops-brain/http-verification.js" --port-file "$disabled_port_file" --token-file "$token_file" --disabled >>"$log_file" 2>&1 || { failure_layer='BRIDGE_AUTH'; exit 1; }
  "$SCRIPT_DIR/stop-harness.sh" "$disabled_pid_file"
  active_pid_file=''
  ! grep -q 'external_network_attempt' "$log_file" || { failure_layer='TEST_ENVIRONMENT'; exit 1; }
  duration="$(( $(date +%s) - start_time ))"
  printf '%s\n' "{\"iteration\":$iteration,\"pass\":true,\"duration_seconds\":$duration,\"database\":\"$db\",\"port\":$port,\"cleanup\":true}" >> "$LAB/logs/harness-summary.jsonl"
  rm -f "$db" "$db-journal" "$db.seed-manifest.json" "$disabled_db" "$disabled_db-journal" "$disabled_db.seed-manifest.json" "$token_file"
  rm -rf "$run_dir"
  cleanup=true
  echo "Harness run $iteration: PASS; port=$port; duration=${duration}s; cleanup=$cleanup"
done
