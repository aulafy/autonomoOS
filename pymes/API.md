# PYMES Workspace API

La API es multi-tenant y requiere `Authorization: Bearer <token>` en todas las rutas de workspace. Las operaciones externas nunca se ejecutan al crearse: pasan por confirmación y resultado.

La interfaz local puede llamar al API desde `http://127.0.0.1:5174` o
`http://localhost:5174`; el adaptador responde al preflight `OPTIONS` y limita
los orígenes a esos dos valores.
En llamadas autorizadas desde navegador, `x-request-id` y `retry-after` se
exponen mediante CORS para facilitar diagnóstico y backoff; el preflight se
puede reutilizar durante 600 segundos.

Cada respuesta incluye `x-request-id`. Si el cliente envía uno, se conserva;
si no, el API genera un UUID. Las respuestas usan `Cache-Control: no-store`,
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` y
`Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` y
`Cross-Origin-Resource-Policy: same-origin`, `Cross-Origin-Opener-Policy:
same-origin`, además de
`Referrer-Policy: no-referrer`.
Las rutas `POST` requieren `Content-Type: application/json`; otros tipos
devuelven `415 UNSUPPORTED_MEDIA_TYPE`.
Un método no permitido devuelve `405` con la cabecera `Allow` correspondiente.

## Salud

`GET /healthz` confirma que el proceso está vivo. `GET /readyz` comprueba
además que el repositorio responde; devuelve `503` con `status: "not_ready"`
si el almacenamiento no está disponible.
En ese caso incluye `Retry-After: 5` para facilitar el backoff del orquestador.

## Ingress OpenClaw Enterprise

`POST /v1/workspaces/:tenant/ingress/openclaw` usa
`X-PYMES-Ingress-Token` y aplica la política de tenant, agente, recurso,
canal, remitente emparejado y consentimiento. Un evento aceptado devuelve
`201`; un evento ya procesado devuelve `409 DUPLICATE_EVENT`. El ingress
siempre crea un caso neutral en estado `received` y no envía respuestas por sí
mismo.

## Bandeja y trazabilidad

- `GET /v1/workspaces/:tenant/inbox` — casos del tenant autenticado.
- `GET /v1/workspaces/:tenant/approvals` — aprobaciones registradas.
- `GET /v1/workspaces/:tenant/cases/:caseId/audit` — transiciones con actor, versión y fecha.
- `GET /v1/workspaces/:tenant/effects/:effectId` — estado individual de una operación.
- `GET /v1/workspaces/:tenant/cases/:caseId/effects` — operaciones de un caso.
- `POST /v1/workspaces/:tenant/cases/:caseId/transition` — cuerpo `{ "to": "...", "at": "ISO-8601" }`.
  Puede incluir `expectedVersion`; si la versión ya cambió, devuelve `409 CASE_VERSION_CONFLICT`.

## Efectos externos

Crear un efecto pendiente (`executeEffect`):

```json
POST /v1/workspaces/:tenant/effects
{
  "id": "effect-123",
  "caseId": "case-123",
  "kind": "call | calendar | message | crm_task",
  "payload": { "...": "datos preparados" },
  "requestedAt": "2026-09-29T12:00:00Z",
  "draftHash": "sha256:..."
}
```

Confirmar explícitamente:

```json
POST /v1/workspaces/:tenant/effects/:effectId/confirm
{ "confirm": true, "confirmedAt": "2026-09-29T12:05:00Z" }
```

Registrar resultado real:

```json
POST /v1/workspaces/:tenant/effects/:effectId/result
{ "result": "succeeded | failed", "executedAt": "2026-09-29T12:10:00Z", "note": "..." }
```

Un efecto fallido puede reintentarse explícitamente:

```json
POST /v1/workspaces/:tenant/effects/:effectId/retry
{ "requestedAt": "2026-09-29T12:20:00Z", "reason": "Cliente disponible para reintento" }
```

La respuesta incluye `retryCount`, que empieza en `0` y aumenta en cada
reintento gobernado. La nota anterior se conserva y se añade el motivo nuevo.
Se permiten como máximo 20 reintentos; después la API devuelve
`EFFECT_RETRY_LIMIT_REACHED` y exige revisión operativa.

Los resultados solo se aceptan después de confirmar el efecto. Cada ruta comprueba tenant, rol y estado actual.

Los tipos de efecto permitidos son `call`, `calendar`, `message` y `crm_task`.
El payload está limitado a 64 KiB; los identificadores y hashes también tienen
límites de longitud. Las notas de ejecución deben tener entre 3 y 2.000
caracteres.
