# P08 · Corrección y versiones de respuestas

Fecha: 4 de octubre de 2026.
Repositorio: `/Users/mac/Downloads/agent-world-os`.
Rama: `codex/h4-http-api`.
Base: `26b9dfddbf0de6ced35c8f5a5c1fa32fc632399a` (P07).
Estado: integrado localmente; validación real del nuevo recorrido Gmail pendiente.

## Función disponible

En un trabajo preparado desde Correo Gmail, después de evaluar aparece:

- **Corregir borrador · nueva versión**, si está pendiente o rechazado.
- **Retirar aprobación y corregir**, si está aprobado y el envío aún no tiene
  ningún claim de C6.

Se cierra la versión anterior para envío y se crea otra con el mismo correo,
contacto, destinatario y próxima acción. El borrador se copia para editarlo.
Debe guardarse, evaluarse y aprobarse de nuevo. La decisión anterior conserva
su contenido y su historial; nunca se reutiliza su aprobación para la versión nueva.

La pantalla muestra el número de versión de respuesta y enlaces a la versión
anterior/siguiente. Desde el correo se abre la última versión de la cadena.
El plan técnico de cada trabajo sigue teniendo versión 1; es distinto de la
versión del borrador. Los detalles del plan se pliegan al revisar la respuesta
para dar prioridad al destinatario y al texto que se van a aprobar.

## Decisión de arquitectura

El kernel conserva los pasos fallidos de una revisión rechazada. Sustituir su
plan dentro del mismo trabajo mantendría esos pasos en sus criterios globales.
P08 usa un **trabajo sucesor**, enlazado al anterior. No altera C1–C12 ni borra
pasos/evidencias. La cancelación anterior y la creación del sucesor, vinculación,
plan y borrador quedan en una sola transacción del journal.

`MailTaskBinding` añade únicamente en sucesores `revision` y `revisesTaskId`.
Los registros originales siguen teniendo la forma anterior. `MailTaskStore`
registra `bindRevision`; conserva cada binding y devuelve el último para el
propietario/cuenta/mensaje. Los datos de fuente permanecen iguales; el store
rechaza una revisión que cambie esa procedencia.

La identidad de aprobación incluye el nuevo taskId, por lo que cambia aunque
el cuerpo copiado sea idéntico. Los registros C8/C9 antiguos se conservan como
historial: el trabajo cancelado y los guards del workflow impiden utilizarlos
para ejecutar esa versión. No se simula una revocación de registros del kernel.

El nuevo workflow CRM reutiliza la oportunidad anterior, incluso a través de
varias revisiones. Consultas sin oportunidad siguen sin crear una. No genera
un seguimiento hasta que el efecto de envío del sucesor esté confirmado.

## Controles

- Solo el propietario del workspace puede pedir la revisión.
- Se exige el bindingHash exacto de la revisión que se quiere corregir.
- Sesión, cuenta, fuente, contacto y payload se comprueban antes de publicar.
- **Cualquier claim email.send de C6 del trabajo bloquea la corrección**, no
  solo los efectos UNKNOWN. Un envío fallido o confirmado tampoco admite
  crear otra versión para reintentar automáticamente.
- Un intento activo del runtime bloquea la corrección.
- Las operaciones del mismo trabajo se excluyen mientras dura la revisión.
- Repetir la petición de revisión devuelve el mismo sucesor inmediato.
- Una cadena tiene un máximo de 100 versiones. No se crean versiones desde
  trabajos terminales ni desde los fixtures antiguos sin fuente de correo.
- Un fallo dentro de la transacción deja el journal no disponible hasta
  reabrir; al reabrir se recupera la transacción anterior completa.

API:

```text
POST /v1/workspaces/<tenant>/runtime/<task>/email/revise
{ "bindingHash": "<huella exacta>" }
```

Devuelve tenantId, taskId original y replacementTaskId. No admite payload,
permisos ni campos de ejecución. El borrador nuevo se edita por la ruta de
borrador existente. La vista incorpora `canRevise` y `replacementTaskId`,
comprobados también por el cliente.

## Evidencias ejecutadas

| Comprobación | Resultado |
| --- | --- |
| Suite completa `npm test` | 907 descubiertas, 906 pasan, 0 fallos, 1 omitida (Orca opt-in) |
| PYMES | 512 pasan |
| Nuevas pruebas P08 | 11 pasan |
| Typecheck de todos los workspaces | Pasa |
| Build de todos los workspaces | Pasa |
| Typecheck/build PYMES tras ajuste visual final | Pasa |
| `git diff --check` | Pasa |

Las pruebas cubren rechazo y corrección, retirada de aprobación, payload idéntico
con identidad nueva, aprobación vieja rechazada, bloqueo ante C6, autorización,
sesión revocada durante comprobación, cambio de cuenta/fuente, concurrencia,
reintento idempotente, cadenas, rollback y validación de respuestas del cliente.

Una prueba hace SIGKILL real después de confirmar la revisión y reabre el mismo
SQLite: la versión anterior queda cancelada, la nueva es editable y no aprobada,
y no se ha enviado nada. El test de rollback introduce un fallo dentro de la
transacción y comprueba al reabrir que ni cancelación ni sucesor se publicaron.
Las pruebas de envío utilizan providers/transporte sintéticos, no Google real.

QA visual en API aislada 8935 y bases privadas, con un correo ficticio:
modelo Ollama real → propuesta revisada → borrador inicial → rechazo → versión 2
→ texto corregido → nueva aprobación → envío al buzón simulado → CRM.
Resultado: versión 1 cancelada, versión 2 completada con 9/9 pasos, una sola
oportunidad y un seguimiento. Reiniciar la API conserva ambos trabajos y el
resultado. No se envió ningún correo real durante P08.

Capturas en Downloads:

- `AUTONOMO_OS_VERSION_ANTERIOR_P08_2026-10-04.png`
- `AUTONOMO_OS_BORRADOR_CORREGIDO_P08_2026-10-04.png`
- `AUTONOMO_OS_NUEVA_APROBACION_P08_2026-10-04.png`
- `AUTONOMO_OS_CRM_P08_2026-10-04.png`
- `AUTONOMO_OS_VERSION_COMPLETADA_P08_2026-10-04.png`

El piloto real 8907/5177 se actualizó después de una copia consistente privada
`backup-before-p08-runtime.db`. La conexión Gmail y los trabajos anteriores
se conservan. No se tocó la autorización OAuth ni se analizaron correos nuevos.

## Límites y siguiente trabajo

P08 corrige versiones de un trabajo procedente de correo, no permite volver a
enviar un mensaje ya enviado. El destinatario/contacto y la próxima acción
siguen fijados al preparar el trabajo; no se cambia de destinatario mediante
esta corrección. La política de retención de journal y backups sigue pendiente.

Los enlaces anterior/siguiente recorren la cadena inmediata. El listado del
runtime conserva su límite de 50 trabajos; falta una vista agrupada y paginada
para historiales extensos. El historial CRM usa nombres genéricos de estado;
la distinción entre envío simulado y Gmail está acreditada en el panel del
workflow y sus evidencias, no solo en el texto «Envío confirmado» del CRM.

Siguiente: revisión unificada con trabajos reales, cancelación deliberada de
pendientes y organización de versiones; aceptación real M4; Google Calendar
y el resto del backlog. El producto completo sigue en desarrollo.
