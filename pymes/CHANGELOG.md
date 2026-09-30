# Changelog

## Unreleased

### Workspace operativo

- Cola autenticada `attention` para casos `pending_review` y `uncertain`.
- Métricas tenant-scoped con alertas de fallos, backlog, casos inciertos y SLA.
- Dashboard conectado al workspace remoto con estado de sincronización y fallback
  compatible con servidores anteriores.
- Fallback de la cola `attention` limitado a respuestas `404` de workspaces
  antiguos; los errores de autenticación o disponibilidad se mantienen visibles.

### Operaciones gobernadas

- Preparación tipada de llamadas, mensajes, citas de calendario y tareas CRM.
- Confirmación explícita, resultado, reintentos limitados y auditoría completa.
- Correlación de auditoría mediante `X-Request-Id`.
- Dispatcher y worker remoto para ejecutar solo efectos confirmados.
- Procesamiento por lotes acotado que continúa tras fallos individuales.
- Handlers de Google Calendar, mensajes, CRM y llamadas con timeout e
  idempotency key derivada del efecto.
- Gateways HTTP seguros para mensajes, CRM y telefonía, con validación de
  endpoint y token durante el arranque del servidor.
- Configuración de gateways propagada a Docker Compose y Kubernetes, con
  comprobaciones de CI para evitar secretos o claves de despliegue huérfanos.

### Seguridad y operación

- Validación tenant-scoped de respuestas y payloads, con límites de tamaño.
- Monitor de operaciones con fallo cerrado ante dependencias ausentes o alertas.
- Pruebas automatizadas, build de producción y overlay Kubernetes verificados.
