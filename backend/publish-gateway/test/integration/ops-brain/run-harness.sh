#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../../.." && pwd)"
HOST=""
PORT=""
PORT_FILE=""
DATABASE=""
SEED=""
TOKEN_FILE=""
BRIDGE_DISABLED=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host|--port|--port-file|--database|--seed|--token-file)
      [[ $# -ge 2 ]] || { echo 'TEST_ENVIRONMENT: missing argument value' >&2; exit 2; }
      case "$1" in
        --host) HOST="$2";; --port) PORT="$2";; --port-file) PORT_FILE="$2";; --database) DATABASE="$2";; --seed) SEED="$2";; --token-file) TOKEN_FILE="$2";;
      esac
      shift 2;;
    --bridge-disabled) BRIDGE_DISABLED=true; shift;;
    *) echo "TEST_ENVIRONMENT: unknown argument $1" >&2; exit 2;;
  esac
done

[[ "$HOST" == '127.0.0.1' && -n "$PORT" && -n "$PORT_FILE" && -n "$DATABASE" && -n "$SEED" && -n "$TOKEN_FILE" ]] || {
  echo 'TEST_ENVIRONMENT: --host 127.0.0.1, --port, --port-file, --database, --seed and --token-file are required' >&2; exit 2;
}
[[ -f "$TOKEN_FILE" ]] || { echo 'TEST_ENVIRONMENT: token file is missing' >&2; exit 2; }
TOKEN="$(<"$TOKEN_FILE")"
[[ ${#TOKEN} -ge 32 ]] || { echo 'TEST_ENVIRONMENT: token is too short' >&2; exit 2; }
[[ -f "$REPO_ROOT/dist-harness/test/integration/ops-brain/server.js" ]] || npm run build:harness >/dev/null

export HARNESS_REPO_ROOT="$REPO_ROOT"
export OPS_BRAIN_BRIDGE_TOKEN="$TOKEN"
if [[ "$BRIDGE_DISABLED" == true ]]; then
  exec node "$REPO_ROOT/dist-harness/test/integration/ops-brain/server.js" --host "$HOST" --port "$PORT" --port-file "$PORT_FILE" --database "$DATABASE" --seed "$SEED" --bridge-disabled
fi
exec node "$REPO_ROOT/dist-harness/test/integration/ops-brain/server.js" --host "$HOST" --port "$PORT" --port-file "$PORT_FILE" --database "$DATABASE" --seed "$SEED"
