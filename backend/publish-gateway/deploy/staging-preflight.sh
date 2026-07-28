#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${PUBLISHOS_STAGING_ENV_FILE:-/etc/publishos-staging/publishos-staging.env}"
fail() { echo "preflight failed: $1" >&2; exit 1; }
[[ "$(node --version)" == v22.* ]] || fail "Node 22 is required"
[[ -f "$root/dist/server.js" ]] || fail "dist/server.js is missing"
[[ -d "$root/prisma/migrations" ]] || fail "prisma/migrations is missing"
[[ -f "$env_file" ]] || fail "environment file is missing"
for key in APP_ENV HOST PORT DATABASE_URL OPS_BRAIN_BRIDGE_ENABLED OPS_BRAIN_BRIDGE_TOKEN TIKTOK_INTEGRATION_ENABLED BACKGROUND_JOBS_ENABLED; do
  grep -q "^${key}=" "$env_file" || fail "missing environment key: $key"
done
value() { sed -n "s/^$1=//p" "$env_file" | tail -n 1 | sed 's/^"//;s/"$//'; }
[[ "$(value HOST)" == 127.0.0.1 ]] || fail "HOST must be 127.0.0.1"
[[ "$(value PORT)" == 3300 ]] || fail "PORT must be 3300"
[[ "$(value TIKTOK_INTEGRATION_ENABLED)" == false ]] || fail "TikTok must be disabled"
[[ "$(value BACKGROUND_JOBS_ENABLED)" == false ]] || fail "background jobs must be disabled"
db="$(value DATABASE_URL)"; [[ "$db" == file:/var/lib/publishos-staging/* ]] || fail "DATABASE_URL must be a staging file path"
bridge_token="$(value OPS_BRAIN_BRIDGE_TOKEN)"
[[ ${#bridge_token} -ge 32 ]] || fail "Bridge token is too short"
[[ -f "$root/deploy/systemd/publishos-staging.service.example" ]] || fail "systemd template is missing"
echo "preflight passed: Node $(node --version), npm $(npm --version), commit $(git -C "$root/../.." rev-parse HEAD)"
