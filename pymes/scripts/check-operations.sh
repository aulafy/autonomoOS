#!/usr/bin/env bash
set -euo pipefail

: "${PYMES_API_BASE_URL:?PYMES_API_BASE_URL es obligatorio}"
: "${PYMES_API_TOKEN:?PYMES_API_TOKEN es obligatorio}"
: "${PYMES_API_TENANT:?PYMES_API_TENANT es obligatorio}"

base_url="${PYMES_API_BASE_URL%/}"
if [[ "${base_url}" =~ [[:cntrl:]] || "${#base_url}" -gt 2048 || "${base_url}" != http://* && "${base_url}" != https://* ]]; then
  echo "PYMES_API_BASE_URL no es válida" >&2
  exit 2
fi
if [[ ! "${PYMES_API_TENANT}" =~ ^[A-Za-z0-9._-]{1,200}$ ]]; then
  echo "PYMES_API_TENANT no es válido" >&2
  exit 2
fi
timeout_seconds="${PYMES_API_TIMEOUT_SECONDS:-10}"
pending_limit="${PYMES_PENDING_REVIEW_LIMIT:-20}"
if [[ ! "${timeout_seconds}" =~ ^[1-9][0-9]{0,2}$ || ! "${pending_limit}" =~ ^[0-9]{1,5}$ ]]; then
  echo "PYMES_API_TIMEOUT_SECONDS o PYMES_PENDING_REVIEW_LIMIT no son válidos" >&2
  exit 2
fi
endpoint="${base_url}/v1/workspaces/${PYMES_API_TENANT}/metrics"
body="$(curl --fail --silent --show-error --max-time "${timeout_seconds}" \
  -H "Authorization: Bearer ${PYMES_API_TOKEN}" \
  -H 'Accept: application/json' "${endpoint}")"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq es obligatorio para validar las métricas de operaciones" >&2
  exit 2
fi

failed="$(jq -r '.effects.byStatus.failed // 0' <<<"${body}")"
pending="$(jq -r '.inbox.byState.pending_review // 0' <<<"${body}")"
stale="$(jq -r '[.alerts[]? | select(.code == "STALE_CASES") | .count] | add // 0' <<<"${body}")"
uncertain="$(jq -r '[.alerts[]? | select(.code == "UNCERTAIN_CASES") | .count] | add // 0' <<<"${body}")"
if [[ ! "${failed}" =~ ^[0-9]+$ || ! "${pending}" =~ ^[0-9]+$ || ! "${stale}" =~ ^[0-9]+$ || ! "${uncertain}" =~ ^[0-9]+$ || ! "${pending_limit}" =~ ^[0-9]+$ ]]; then
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
if (( stale > 0 )); then
  echo "Hay ${stale} casos pendientes fuera de SLA" >&2
  exit 2
fi
if (( uncertain > 0 )); then
  echo "Hay ${uncertain} casos con resultado incierto" >&2
  exit 2
fi
printf 'OK: %s casos pendientes, %s operaciones fallidas, %s fuera de SLA, %s inciertos\n' "${pending}" "${failed}" "${stale}" "${uncertain}"
