#!/usr/bin/env bash
set -euo pipefail

fail() { echo "CONFIG ERROR: $1" >&2; exit 2; }
pair() {
  local first="${!1-}" second="${!2-}"
  if [[ -n "$first" && -z "$second" || -z "$first" && -n "$second" ]]; then fail "$1 y $2 deben configurarse juntos"; fi
}
pair PYMES_WHATSAPP_WEBHOOK_VERIFY_TOKEN PYMES_WHATSAPP_APP_SECRET
pair PYMES_WHATSAPP_CLOUD_ACCESS_TOKEN PYMES_WHATSAPP_CLOUD_PHONE_NUMBER_ID
pair PYMES_MESSAGE_GATEWAY_URL PYMES_MESSAGE_GATEWAY_TOKEN
pair PYMES_CRM_GATEWAY_URL PYMES_CRM_GATEWAY_TOKEN
pair PYMES_CALL_GATEWAY_URL PYMES_CALL_GATEWAY_TOKEN

for name in PYMES_WHATSAPP_WEBHOOK_VERIFY_TOKEN PYMES_WHATSAPP_APP_SECRET PYMES_WHATSAPP_CLOUD_ACCESS_TOKEN PYMES_HOLDED_API_KEY PYMES_GOOGLE_ACCESS_TOKEN; do
  value="${!name-}"
  [[ -z "$value" || ${#value} -ge 16 ]] || fail "$name es demasiado corto"
done

for name in PYMES_MESSAGE_GATEWAY_URL PYMES_CRM_GATEWAY_URL PYMES_CALL_GATEWAY_URL PYMES_LOCAL_LLM_URL; do
  value="${!name-}"
  if [[ -n "$value" && ! "$value" =~ ^https?:// ]]; then fail "$name debe ser una URL http(s)"; fi
done

echo "OK: configuración de conectores válida (secretos no mostrados)"
