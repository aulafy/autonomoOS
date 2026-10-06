# Pyme_1 · desarrollo del producto

Actualizado: 5 de octubre de 2026. Objetivo: producto profesional instalado en
Mac para autónomos en España, con cápsulas reutilizables y plantillas de profesión.
La agencia de seguros es la primera plantilla. Equipos previstos:
Mac mini 16 GB y MacBook 24 GB. La aplicación completa todavía no está terminada.

## Base disponible

| Área | Evidencia y alcance |
| --- | --- |
| Espacio modular | Jornada real, organización durable, tres plantillas, módulos ordenables e importación/exportación de preferencias; conversión completa a cápsulas pendiente |
| Cápsulas v1 | Registro revisado, configuración durable, UI, primera lectura CRM y kit Claude/Codex; extracción de módulos pendiente |
| Telegram inbound | Bot API, Keychain, SQLite separado, recepción y cursor atómicos, historial de ediciones, UI y SIGKILL sintético; bot real y envío pendientes |
| Identidad Telegram | Verificación humana con contacto existente, journal/replay, revisión/idempotencia, retirada e historial en ficha CRM; importación de eventos como interacciones y workflow pendientes |
| Kernel C1–C12 | Contratos y runtime integrado; preservar invariantes y tests |
| M1/M2 | Planificación, aprobación exacta durable y ejecución gobernada |
| M3 Gmail | A/B/C real, autorización Keychain, reinicio y reconciliación sin reenvío |
| P03/P04 inbox | SQLite separado, full/incremental, leases, cursor, lectura y purga BORRAR |
| P05 CRM | Contactos, identidades, oportunidades, interacciones y seguimientos locales durables |
| P11 conversaciones CRM | Procedencia histórica de proveedor, recibo Gmail acreditado, agrupación por cuenta/contacto/threadId y copia de Enviados asociada solo por evidencia; 18 pruebas nuevas, incluido SIGKILL |
| P10 cancelación | Decisión durable explícita, bloqueo por claim/intento/UNKNOWN/COMMITTED, reprepare con nueva aprobación y CRM reutilizado; 28 pruebas nuevas |
| P09 revisión real | Cola local del runtime, versiones agrupadas, búsqueda/filtros y cursor paginado; UNKNOWN prioritario y acceso a trabajos fuera de los primeros 50; 10 pruebas nuevas |
| P08 versiones de respuesta | Rechazo/corrección y retirada antes de C6, sucesor durable, nueva aprobación y oportunidad CRM reutilizada; 11 pruebas nuevas |
| P07 flujo de correo | Trabajo durable, borrador editable antes de revisión, aprobación exacta, respuesta en hilo y CRM/seguimiento; QA sintético y recuperación; aceptación Gmail nueva pendiente |
| P06 IA de correo | Resumen/clasificación/borrador local, evidencia y revisión; 8 casos reales con modelo instalado |

Los menús o pantallas de ejemplo de etapas anteriores no acreditan conexiones
reales. Holded, Google Calendar y otros canales siguen pendientes de integración.

## Dirección modular

Fundamento de cápsulas v1 y organización del espacio implementados. Tres
plantillas iniciales ordenan módulos existentes; aún no aportan workflows
específicos nuevos. Siguientes pasos: extraer módulos existentes a cápsulas
y añadir conectores
compartidos (Telegram inbound implementado y pendiente de aceptación real, después WhatsApp,
Odoo y WordPress). El SDK actual solo admite el renderer de lectura del CRM.
Ampliaciones de acciones deben reutilizar los contratos y gates del runtime.
El plan de producto anterior conserva sus pendientes de aceptación real:

## Orden de trabajo

1. **Revisión y trabajo desde correo.** P07–P10 implementados;
   cancelación explícita y durable disponible. La revisión unificada ya agrupa y pagina
   versiones. Cada versión requiere aprobación nueva; un claim C6
   bloquea correcciones. P11 muestra proveedor histórico y separa
   simulación, envío acreditado y resultado incierto en CRM.
2. **Conversaciones e identidad.** P11 agrupa por threadId dentro de cuenta y
   contacto; relaciona la copia sincronizada con el efecto mediante un recibo
   Gmail confirmado, conservando ambos registros. No usa igualdad de contenido
   ni Message-ID para deduplicar. Revisión humana para identidad ambigua ya
   existente. Pendientes: paginación completa del historial y lectura directa
   de la conversación desde CRM.
3. **Aceptación real de M4.** Correo entrante controlado, contacto, revisión,
   edición y envío autorizado. Movimientos de etiquetas, archivado, spam,
   papelera, historial caducado y purga local consentida. Evidencias reproducibles.
4. **Google Calendar.** Lectura real, agenda y preparación de citas; escrituras
   gobernadas y aprobadas, conflictos y reconciliación tras pérdida de respuesta.
   Nuevos scopes necesitan una decisión explícita del usuario.
5. **Trabajo diario del agente.** Incidencias, renovaciones, solicitudes de
   coche/vida/hogar/RC, preparación de llamadas, prioridades y tareas. Cotización
   y documentación requieren aseguradora/conector y datos reales; no inventar
   precios, garantías ni decisiones de contratación.
6. **Canales.** Adaptadores oficiales o explícitamente autorizados para WhatsApp,
   Telegram e iMessage, aislamiento, lectura/retención y efectos gobernados.
   Reutilizar OpenClaw cuando encaje en los contratos; no introducir otro kernel.
7. **CRM externo.** Decidir alcance de Holded y sincronización bidireccional,
   propiedad de campos, conflictos, borrados y duplicados. CSV sigue fuera del
   M4 acordado; puede plantearse como incremento posterior.
8. **Producto instalable.** Instalación, primer arranque, modelos y conectores,
   diagnóstico, backups/restore completos, actualización y rollback, arranque
   automático y soporte. Verificar memoria/latencia en ambos equipos objetivo.
9. **Operación comercial.** Retención y borrado de texto derivado/backups,
   aislamiento, secretos Keychain, logs, consentimiento, permisos Google de
   producción, distribución firmada y pruebas operativas de recuperación.

## Criterio para avanzar

Cada entrega se integra en el repositorio real con tests relevantes, typecheck,
build y revisión visual cuando haya interfaz. Una integración sintética no se
presenta como aceptación de un proveedor real. Las acciones externas conservan
aprobación exacta, journal durable, estados UNKNOWN y reconciliación sin reenvío.

## Documentos de estado

- `docs/handoff/AVANCE_TELEGRAM_IDENTIDAD_CRM_2026-10-05.md`
- `docs/handoff/AVANCE_TELEGRAM_RECEPCION_2026-10-05.md`
- `docs/handoff/AVANCE_ESPACIO_MODULAR_2026-10-05.md`
- `docs/handoff/AVANCE_CAPSULAS_FUNDACION_2026-10-05.md`

- `docs/handoff/AVANCE_P04_INBOX_GMAIL_2026-10-04.md`
- `docs/handoff/AVANCE_P05_CRM_LOCAL_2026-10-04.md`
- `docs/handoff/AVANCE_P06_ASISTENTE_CORREO_2026-10-04.md`
- `docs/handoff/AVANCE_P07_FLUJO_CORREO_2026-10-04.md`
- `docs/handoff/AVANCE_P08_REVISION_RESPUESTAS_2026-10-04.md`
- `docs/handoff/AVANCE_P09_REVISION_REAL_2026-10-04.md`
- `docs/handoff/AVANCE_P10_CANCELACION_TRABAJOS_2026-10-04.md`
- `docs/handoff/AVANCE_P11_CONVERSACIONES_CRM_2026-10-05.md`

La autorización activa del usuario cubre continuar desarrollando lo pendiente.
Credenciales, alcance de permisos nuevos y aceptación de comunicaciones reales
se resuelven cuando el trabajo concreto lo requiera.
