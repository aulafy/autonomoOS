#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runtime_port="${DEMO_RUNTIME_PORT:-8799}"
web_port="${DEMO_WEB_PORT:-5173}"
database_path="${DEMO_DB_PATH:-/tmp/agent-world-company-demo.db}"

cleanup() {
  if [[ -n "${runtime_pid:-}" ]]; then
    kill "$runtime_pid" 2>/dev/null || true
    wait "$runtime_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

printf 'Demo empresarial: http://127.0.0.1:%s/demo.html?runtimePort=%s\n' "$web_port" "$runtime_port"
printf 'Diario local: %s\n' "$database_path"

(
  cd "$repo_root"
  AGENT_RUNTIME_PORT="$runtime_port" AGENT_WORLD_DB_PATH="$database_path" \
    npm run dev:runtime
) &
runtime_pid=$!

cd "$repo_root"
npm --workspace apps/world-client run dev -- --host 127.0.0.1 --port "$web_port" --strictPort
