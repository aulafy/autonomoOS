#!/usr/bin/env bash
set -euo pipefail

: "${PYMES_API_BASE_URL:?PYMES_API_BASE_URL es obligatorio}"
: "${PYMES_API_TOKEN:?PYMES_API_TOKEN es obligatorio}"
: "${PYMES_API_TENANT:?PYMES_API_TENANT es obligatorio}"

base_url="${PYMES_API_BASE_URL%/}"
endpoint="${base_url}/v1/workspaces/${PYMES_API_TENANT}/metrics"
body="$(curl --fail --silent --show-error --max-time "${PYMES_API_TIMEOUT_SECONDS:-10}" \
  -H "Authorization: Bearer ${PYMES_API_TOKEN}" \
  -H 'Accept: application/json' "${endpoint}")"

if ! command -v jq >/dev/null 2>&1; then
  printf '%s\n' "${body}"
  exit 0
fi

failed="$(jq -r '.effects.byStatus.failed // 0' <<<"${body}")"
pending="$(jq -r '.inbox.byState.pending_review // 0' <<<"${body}")"
pending_limit="${PYMES_PENDING_REVIEW_LIMIT:-20}"
if [[ ! "${failed}" =~ ^[0-9]+$ || ! "${pending}" =~ ^[0-9]+$ || ! "${pending_limit}" =~ ^[0-9]+$ ]]; then
  echo "Respuesta de métricas no válida" >&2
  exit 2
fi
if (( failed > 0 )); then
  echo "Hay ${failed} operaciones fallidas" >&2
  exit 2
fi
if (( pending > pending_limit )); then
  echo "Hay ${pending} casos pendientes (límite ${pending_limit})" >&2
  exit 2
fi
printf 'OK: %s casos pendientes, %s operaciones fallidas\n' "${pending}" "${failed}"
