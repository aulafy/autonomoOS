# Integración con OpenClaw Enterprise

Este documento define el contrato operativo entre `openclaw-enterprise` y el
workspace PYMES. OpenClaw transporta eventos; el workspace decide la política
del tenant, persiste el caso y mantiene la trazabilidad. El ingress no envía
respuestas a clientes ni ejecuta efectos automáticamente.

## Configuración del workspace

Configura en el servidor PYMES:

```bash
PYMES_OPENCLAW_INGRESS_TOKEN="token-compartido-de-16-caracteres-o-mas"
PYMES_OPENCLAW_SIGNING_SECRET="secreto-hmac-compartido"
PYMES_OPENCLAW_CHANNELS="whatsapp,telegram,imessage,email"
PYMES_OPENCLAW_AGENT_IDS="agent-finanzas-01"
PYMES_OPENCLAW_RESOURCE_IDS="resource-inbox-pymes"
PYMES_OPENCLAW_PAIRED_SENDERS="sender:cliente-123"
PYMES_OPENCLAW_CONSENTED_CONVERSATIONS="conversation:cliente-123"
```

Las listas son allowlists. Si se configura una lista, un valor que no esté en
ella se rechaza. El token y el secreto se mantienen fuera del repositorio.

## Petición desde OpenClaw

Endpoint:

```text
POST /v1/workspaces/{tenant}/ingress/openclaw
X-PYMES-Ingress-Token: <token>
X-PYMES-Ingress-Signature: <hmac-sha256-hex>
X-Request-Id: <id-correlacionable>
Content-Type: application/json
```

El HMAC se calcula sobre el JSON exacto enviado, usando SHA-256 y el secreto
compartido. Ejemplo mínimo:

```json
{
  "agentId": "agent-finanzas-01",
  "resourceId": "resource-inbox-pymes",
  "inbound": {
    "eventId": "evt-2026-0001",
    "tenantId": "demo-agency",
    "channel": "whatsapp",
    "conversationId": "conversation:cliente-123",
    "senderId": "sender:cliente-123",
    "occurredAt": "2026-09-30T08:30:00.000Z",
    "text": "Necesito revisar el seguro de mi coche"
  }
}
```

## Respuestas

- `201`: evento aceptado y caso creado en estado `received`.
- `409 DUPLICATE_EVENT`: evento ya procesado; OpenClaw puede tratarlo como
  éxito idempotente.
- `401` o `403`: token, firma o política no válidos.
- `413`: cuerpo superior al límite del adaptador.
- `422`: envelope o evento incompleto.

Todas las respuestas incluyen `X-Request-Id`. El `eventId` y el
`sourceEventId` se conservan para poder reconstruir la cadena completa desde
el mensaje original hasta cualquier efecto confirmado por un operador.

## Prueba local

Con el servidor PYMES arrancado en `127.0.0.1:8790`:

```bash
BODY='{"agentId":"agent-finanzas-01","resourceId":"resource-inbox-pymes","inbound":{"eventId":"evt-local-1","tenantId":"demo-agency","channel":"email","conversationId":"conversation:local","senderId":"sender:local","occurredAt":"2026-09-30T08:30:00.000Z","text":"Solicito una propuesta de hogar"}}'
SIGNATURE=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$PYMES_OPENCLAW_SIGNING_SECRET" -hex | awk '{print $2}')
curl -i -X POST "http://127.0.0.1:8790/v1/workspaces/demo-agency/ingress/openclaw" \
  -H "Content-Type: application/json" \
  -H "X-PYMES-Ingress-Token: $PYMES_OPENCLAW_INGRESS_TOKEN" \
  -H "X-PYMES-Ingress-Signature: $SIGNATURE" \
  -H "X-Request-Id: local-openclaw-1" \
  --data "$BODY"
```

Después, consulta la bandeja autenticada. La interfaz PYMES mostrará el caso
en la cola de atención si requiere revisión humana; ninguna propuesta,
llamada, mensaje o cita se ejecuta sin confirmación explícita.

