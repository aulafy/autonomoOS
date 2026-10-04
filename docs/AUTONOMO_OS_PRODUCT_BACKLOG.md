# Autónomo OS · desarrollo del producto

Actualizado: 4 de octubre de 2026. Objetivo: producto profesional instalado en
Mac para autónomos y agencias de seguros en España. Equipos previstos:
Mac mini 16 GB y MacBook 24 GB. La aplicación completa todavía no está terminada.

## Base disponible

| Área | Evidencia y alcance |
| --- | --- |
| Kernel C1–C12 | Contratos y runtime integrado; preservar invariantes y tests |
| M1/M2 | Planificación, aprobación exacta durable y ejecución gobernada |
| M3 Gmail | A/B/C real, autorización Keychain, reinicio y reconciliación sin reenvío |
| P03/P04 inbox | SQLite separado, full/incremental, leases, cursor, lectura y purga BORRAR |
| P05 CRM | Contactos, identidades, oportunidades, interacciones y seguimientos locales durables |
| P07 flujo de correo | Trabajo durable, borrador editable antes de revisión, aprobación exacta, respuesta en hilo y CRM/seguimiento; QA sintético y recuperación; aceptación Gmail nueva pendiente |
| P06 IA de correo | Resumen/clasificación/borrador local, evidencia y revisión; 8 casos reales con modelo instalado |

Los menús o pantallas de ejemplo de etapas anteriores no acreditan conexiones
reales. Holded, Google Calendar y otros canales siguen pendientes de integración.

## Orden de trabajo

1. **Revisión y trabajo desde correo.** P07 implementado. Completar edición
   versionada tras rechazo, cancelación y revisión unificada. Cada versión
   necesita nueva aprobación; nunca modificar un efecto con claim C6.
2. **Conversaciones e identidad.** Respuestas Gmail en hilo, referencia a
   Message-ID y threadId; distinguir interacción de envío y mensaje sincronizado
   sin duplicar por heurísticas. Revisión humana para identidad ambigua.
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

- `docs/handoff/AVANCE_P04_INBOX_GMAIL_2026-10-04.md`
- `docs/handoff/AVANCE_P05_CRM_LOCAL_2026-10-04.md`
- `docs/handoff/AVANCE_P06_ASISTENTE_CORREO_2026-10-04.md`
- `docs/handoff/AVANCE_P07_FLUJO_CORREO_2026-10-04.md`

La autorización activa del usuario cubre continuar desarrollando lo pendiente.
Credenciales, alcance de permisos nuevos y aceptación de comunicaciones reales
se resuelven cuando el trabajo concreto lo requiera.
