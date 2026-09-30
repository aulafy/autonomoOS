# Changelog

## Unreleased

### Workspace operativo

- Cola autenticada `attention` para casos `pending_review` y `uncertain`.
- Métricas tenant-scoped con alertas de fallos, backlog, casos inciertos y SLA.
- Dashboard conectado al workspace remoto con estado de sincronización y fallback
  compatible con servidores anteriores.

### Operaciones gobernadas

- Preparación tipada de llamadas, mensajes, citas de calendario y tareas CRM.
- Confirmación explícita, resultado, reintentos limitados y auditoría completa.
- Correlación de auditoría mediante `X-Request-Id`.

### Seguridad y operación

- Validación tenant-scoped de respuestas y payloads, con límites de tamaño.
- Monitor de operaciones con fallo cerrado ante dependencias ausentes o alertas.
- Pruebas automatizadas, build de producción y overlay Kubernetes verificados.
