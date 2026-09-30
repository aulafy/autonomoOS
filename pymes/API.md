# PYMES Workspace API

La API es multi-tenant y requiere `Authorization: Bearer <token>` en todas las rutas de workspace. Las operaciones externas nunca se ejecutan al crearse: pasan por confirmación y resultado.

La interfaz local puede llamar al API desde `http://127.0.0.1:5174` o
`http://localhost:5174`; el adaptador responde al preflight `OPTIONS` y limita
los orígenes a esos dos valores.
La allowlist se compara literalmente; `*` no se interpreta como comodín y no
habilita acceso de navegador. Cada entrada debe ser un origen HTTP/HTTPS sin
ruta, query, hash ni credenciales.
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
También incluye `Permissions-Policy` para desactivar cámara, micrófono y
geolocalización, y `X-DNS-Prefetch-Control: off`.
También fija `X-Permitted-Cross-Domain-Policies: none` para clientes heredados.
El cliente remoto exige una URL base HTTP/HTTPS sin credenciales, query ni
fragmento y con un máximo de 2.048 caracteres. Sus peticiones usan un timeout
de 10.000 ms por defecto; `requestTimeoutMs` permite ajustar entre 100 y 60.000
ms. Cuando se agota, el cliente expone `WORKSPACE_REQUEST_TIMEOUT`.
Cada petición del cliente genera un `X-Request-Id` para correlacionar logs y
diagnósticos; `WorkspaceClient.lastRequestId` expone el último valor enviado.
Los fallos HTTP del cliente se exponen como `WorkspaceHttpError`, con `status`,
`message`, `requestId` y `retryAfter` para decidir reautenticación, reintento,
backoff o soporte.
Las rutas `POST` requieren `Content-Type: application/json`; otros tipos
devuelven `415 UNSUPPORTED_MEDIA_TYPE`.
Un método no permitido devuelve `405` con la cabecera `Allow` correspondiente.
Una request malformada devuelve `400`; si el parser rechaza las cabeceras por
exceso de tamaño, el servidor devuelve `431` y cierra la conexión.
El cliente remoto valida además la bandeja: cada caso debe tener `tenantId`,
`id`, `state` y `summary`, y el `tenantId` debe coincidir con el workspace
solicitado. Una respuesta mezclada se rechaza completa con
`INVALID_WORKSPACE_INBOX`.
Las aprobaciones remotas siguen la misma regla de tenant y además deben
incluir identificador, recurso, operación, actor, fecha, motivo y hash del
borrador; de lo contrario el cliente responde con
`INVALID_WORKSPACE_APPROVALS`.
La respuesta de `approve()` también debe cumplir el contrato completo y
pertenecer al tenant actual; una creación malformada se rechaza con
`INVALID_WORKSPACE_APPROVAL`.
Las colecciones de efectos también deben devolver el `tenantId` del workspace;
`effectsForCase()` verifica además que el `caseId` de la envolvente coincida
con el caso solicitado y rechaza cualquier desalineación.
La auditoría aplica la misma comprobación a `tenantId` y `caseId`; una
envolvente de otro workspace o de otro caso se rechaza con
`INVALID_WORKSPACE_AUDIT`.
Cada efecto individual debe incluir como mínimo `id`, `caseId`, `kind`,
`status`, `requestedBy` y `requestedAt`; el cliente rechaza efectos incompletos
con `INVALID_WORKSPACE_EFFECT` antes de permitir confirmaciones o reintentos.
Las respuestas de `confirmEffect()`, `reportEffectResult()` y `retryEffect()`
se validan con el mismo contrato antes de devolverse al llamador; una mutación
con respuesta incompleta no se presenta como ejecutada.

## Salud

`GET /healthz` confirma que el proceso está vivo y devuelve la versión del
servicio. `GET /readyz` comprueba
además que el repositorio responde; devuelve `503` con `status: "not_ready"`
si el almacenamiento no está disponible.
En ese caso incluye `Retry-After: 5` para facilitar el backoff del orquestador.
`WorkspaceClient.health()` y `WorkspaceClient.ready()` exponen estos contratos
de forma tipada para la interfaz y los probes de despliegue.
La interfaz PYMES no presenta el workspace como conectado hasta que `readyz`
responde correctamente; durante el arranque aplica un backoff fijo de 5
segundos y permite reintento manual.
Cuando conecta, muestra la versión devuelta por `readyz`; esa versión identifica
el release del workspace remoto y no el bundle estático de la interfaz.
El indicador visual expone además `data-state="connected|starting|error"` para
automatización y pruebas de interfaz sin depender del texto localizado.
Cuando está conectado añade `data-last-sync` con una fecha ISO-8601; el
atributo se elimina al entrar en error o perder la sesión.
Cuando falla la conexión añade `data-failures` con el contador consecutivo
acotado; se elimina al recuperar la conexión.
Cuando conecta añade `data-connector-count` con el número devuelto por el
registro remoto de conectores; se elimina al perder la conexión.
El contador visible de fallos consecutivos se satura en `999` para mantener un
valor acotado durante sesiones largas.
El indicador usa `role="status"`, `aria-live="polite"` y `aria-atomic="true"`
para anunciar cambios completos de conexión sin interrumpir la tarea activa.
El contexto de piloto expone `data-crm-status` y `data-calendar-status` con los
estados tipados de Holded y Google Calendar.
También expone `data-crm-id` y `data-calendar-id` con los identificadores
estables de cada conector.
Los adaptadores nuevos pueden reutilizar el tipo exportado `ConnectorConfig`
junto con `ConnectorStatus` para mantener la misma semántica.
Para datos dinámicos pueden usar también `isConnectorStatus()` antes de
aceptar un estado recibido desde una API o configuración externa.
`isConnectorConfig()` valida el objeto completo antes de incorporarlo al
registro de integraciones.
Los campos `id` y `name` deben ser texto no vacío, sin caracteres de control y
con un máximo de 200 caracteres.
El cliente remoto también exige que el `tenantId` de la respuesta coincida con
el workspace solicitado y que no haya IDs de conector duplicados; si falla
cualquiera de esas invariantes rechaza el registro completo.
Los conectores del piloto usan los IDs estables `holded` y `google_calendar`;
los nombres visibles pueden cambiar sin romper esas referencias.

## Ingress OpenClaw Enterprise

### Errores HTTP no previstos

El adaptador HTTP contiene excepciones inesperadas y responde con `500` y
`{"error":"INTERNAL_SERVER_ERROR"}`. La respuesta conserva siempre
`x-request-id` para correlacionarla con los logs del proceso; los detalles
internos no se envían al cliente.

`POST /v1/workspaces/:tenant/ingress/openclaw` usa
`X-PYMES-Ingress-Token` y aplica la política de tenant, agente, recurso,
canal, remitente emparejado y consentimiento. Un evento aceptado devuelve
`201`; un evento ya procesado devuelve `409 DUPLICATE_EVENT`. El ingress
siempre crea un caso neutral en estado `received` y no envía respuestas por sí
mismo. Si no se define `PYMES_OPENCLAW_CHANNELS`, se usan WhatsApp, Telegram,
iMessage y email; los nombres desconocidos de una configuración explícita se
descartan. Si la configuración explícita no contiene ningún canal válido, el
ingress queda sin canales permitidos y bloquea esos eventos.

## Bandeja y trazabilidad

- `POST /v1/workspaces/:tenant/session/revoke` — revoca el token Bearer actual y devuelve `{ "status": "revoked" }`. Las siguientes llamadas con ese token reciben `401`.
- `GET /v1/workspaces/:tenant/inbox` — casos del tenant autenticado.
- `GET /v1/workspaces/:tenant/connectors` — IDs, nombres y estados de los
  conectores read-only del tenant autenticado.
  El cliente valida cada registro y rechaza respuestas malformadas aunque el
  HTTP status sea `200`.
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
