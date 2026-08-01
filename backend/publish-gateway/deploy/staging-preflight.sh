#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${PUBLISHOS_STAGING_ENV_FILE:-/etc/publishos-staging/publishos-staging.env}"
fail() { echo "preflight failed: $1" >&2; exit 1; }
[[ "$(node --version)" == v22.* ]] || fail "Node 22 is required"
[[ -f "$root/dist/server.js" ]] || fail "dist/server.js is missing"
[[ -d "$root/prisma/migrations" ]] || fail "prisma/migrations is missing"
[[ -f "$env_file" ]] || fail "environment file is missing"
for key in APP_ENV HOST PORT DATABASE_URL OPS_BRAIN_BRIDGE_ENABLED OPS_BRAIN_BRIDGE_TOKEN TIKTOK_INTEGRATION_ENABLED BACKGROUND_JOBS_ENABLED METRICS_CRON_ENABLED TIKTOK_RECONCILIATION_CRON_ENABLED; do
  grep -q "^${key}=" "$env_file" || fail "missing environment key: $key"
done
value() { sed -n "s/^$1=//p" "$env_file" | tail -n 1 | sed 's/^"//;s/"$//'; }
[[ "$(value HOST)" == 127.0.0.1 ]] || fail "HOST must be 127.0.0.1"
[[ "$(value PORT)" == 3300 ]] || fail "PORT must be 3300"
expected_tiktok="${EXPECTED_TIKTOK_INTEGRATION_ENABLED:-false}"
[[ "$expected_tiktok" == true || "$expected_tiktok" == false ]] || fail "EXPECTED_TIKTOK_INTEGRATION_ENABLED must be true or false"
[[ "$(value TIKTOK_INTEGRATION_ENABLED)" == "$expected_tiktok" ]] || fail "TikTok integration does not match the declared expectation"
[[ "$(value OPS_BRAIN_BRIDGE_ENABLED)" == false ]] || fail "Bridge must be disabled"
[[ "$(value BACKGROUND_JOBS_ENABLED)" == false ]] || fail "background jobs must be disabled"
[[ "$(value METRICS_CRON_ENABLED)" == false ]] || fail "metrics cron must be disabled"
[[ "$(value TIKTOK_RECONCILIATION_CRON_ENABLED)" == false ]] || fail "reconciliation cron must be disabled"
db="$(value DATABASE_URL)"; [[ "$db" == file:/var/lib/publishos-staging/* ]] || fail "DATABASE_URL must be a staging file path"
bridge_token="$(value OPS_BRAIN_BRIDGE_TOKEN)"
[[ ${#bridge_token} -ge 32 ]] || fail "Bridge token is too short"
[[ -f "$root/deploy/systemd/publishos-staging.service.example" ]] || fail "systemd template is missing"
release_root="$(cd "$root/../.." && pwd)"
if [[ -f "$release_root/.release-commit" ]]; then
  IFS= read -r commit < "$release_root/.release-commit" || fail "release commit marker could not be read"
else
  commit="$(git -C "$release_root" rev-parse HEAD 2>/dev/null)" || fail "git rev-parse HEAD failed"
fi
[[ -n "$commit" ]] || fail "git commit is empty"
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || fail "git commit is not a valid 40-character hex SHA: $commit"
echo "preflight passed: Node $(node --version), npm $(npm --version), commit $commit"
