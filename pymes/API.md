# PYMES Workspace API

La API es multi-tenant y requiere `Authorization: Bearer <token>` en todas las rutas de workspace. Las operaciones externas nunca se ejecutan al crearse: pasan por confirmación y resultado.

## Salud

`GET /healthz` devuelve `{ "status": "ok", "service": "pymes-workspace", "version": "0.1.0" }`.

## Bandeja y trazabilidad

- `GET /v1/workspaces/:tenant/inbox` — casos del tenant autenticado.
- `GET /v1/workspaces/:tenant/approvals` — aprobaciones registradas.
- `GET /v1/workspaces/:tenant/cases/:caseId/audit` — transiciones con actor, versión y fecha.
- `POST /v1/workspaces/:tenant/cases/:caseId/transition` — cuerpo `{ "to": "...", "at": "ISO-8601" }`.

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

Los resultados solo se aceptan después de confirmar el efecto. Cada ruta comprueba tenant, rol y estado actual.
