# P07 · Correo revisado, respuesta aprobada y seguimiento en CRM

Fecha: 4 de octubre de 2026.
Repositorio: `/Users/mac/Downloads/agent-world-os`.
Rama: `codex/h4-http-api`.
Base de esta entrega: `f5491aff64f4e101590d95c1577364aae784c8a8` (P06).
Estado: implementado y probado localmente; aceptación del nuevo flujo contra Gmail real pendiente.

## Qué puede hacer el profesional

1. Abrir un correo entrante en **Correo Gmail**.
2. Preparar con el modelo local y aceptar la propuesta tras revisarla.
3. Pulsar **Preparar trabajo de respuesta**.
4. Seleccionar un cliente activo y una dirección registrada, editar asunto y
   respuesta, elegir la próxima acción y su fecha; confirmar la revisión.
5. Guardar el trabajo. Se abre automáticamente en **Centro de agentes**.
6. Editar el borrador mientras no se haya evaluado, guardar y evaluar.
7. Aprobar el destinatario y contenido exactos, y ejecutar el envío.
8. Tras evidencia de envío confirmado, consultar la interacción en **Clientes**
   y el seguimiento en **Tareas**.

Aceptar una propuesta de IA no aprueba el envío. Guardar un trabajo tampoco
lo ejecuta. El contacto debe estar registrado; desde el editor puede abrirse
el CRM para crearlo. El correo se vincula explícitamente al contacto elegido.
Esa elección no acredita por sí sola la identidad real del remitente.

## Arquitectura integrada

- `mail-task-contract.ts`, `mail-task-api.ts` y `mail-task-screen.ts`: contratos
  estrictos, API de propietario y preparación del trabajo en la interfaz.
- `mail-task-store.ts`: proyección en el journal durable, una vinculación por
  propietario/cuenta/mensaje y deduplicación de solicitudes idénticas.
- `mail-task-service.ts`: comprueba propuesta aceptada, procedencia, sesión,
  cuenta conectada, contacto, dirección registrada y seguimiento futuro.
- `mail-source.ts`: huella compartida del correo, incluyendo cabeceras de hilo.
  La versión de identidad pasa a `2026-10-04-v3`; las propuestas antiguas deben
  regenerarse para poder preparar este flujo nuevo.
- El journal guarda en una transacción procedencia, tarea, plan y borrador.
  El plan de nueve pasos es un workflow del host seleccionado por el profesional;
  no es un plan inventado por el modelo. No depende del planner genérico en 8080.
- Los primeros pasos usan el correo y el CRM revisados. La revisión humana
  tiene su procedencia propia. Los trabajos antiguos conservan sus evidencias
  anteriores; no se reescribe su historial.
- C1–C12 se conservan. Se reutilizan EmailReviewStore, aprobación exacta,
  Governed Runner y el provider existente; no se introduce otro sender.
- Solo presupuestos y renovaciones generan oportunidad comercial. Consultas
  de servicio generan seguimiento sin inventar una oportunidad de venta.

API bajo sesión de propietario:

```text
GET  /v1/workspaces/<tenant>/mail-tasks?accountRef=<ref>&gmailId=<id>
POST /v1/workspaces/<tenant>/mail-tasks
```

POST incluye propuesta, contacto, dirección, asunto, cuerpo, confirmación de
revisión y próxima acción. No admite campos de ejecución. Una repetición
idéntica devuelve el mismo trabajo; contenido diferente para el mismo mensaje
produce conflicto en vez de crear otro trabajo silenciosamente.

## Respuestas y comprobación de procedencia

Si el asunto conserva el original y existen cabeceras válidas, se envían
`threadId`, `In-Reply-To` y `References`. Son parte del payload aprobado y de la
verificación posterior. Cabeceras inválidas requieren revisión. Un asunto
diferente prepara un correo nuevo vinculado a la solicitud.

Antes de revisar, aprobar y admitir un efecto nuevo se comprueban de nuevo
sesión, cuenta, huella local y vínculo CRM. C11 repite las comprobaciones locales
al despachar. Cambiar la cuenta, desvincular al contacto, cambiar el correo o
purgarlo bloquea el nuevo envío. No se pretende verificar en cada envío todos
los cambios remotos que aún no se han sincronizado desde Gmail.

Si C6 ya contiene un claim y el resultado es UNKNOWN, se conserva. Incluso
tras purgar el inbox, puede reconciliarse mediante el sender y sus evidencias,
sin reenviar. El seguimiento solo se crea una vez tras confirmación.

## Pruebas realmente ejecutadas

| Comprobación | Resultado |
| --- | --- |
| Suite completa `npm test` | 896 descubiertas; 895 pasan, 0 fallos, 1 omitida (Orca opt-in) |
| PYMES | 501 pasan |
| Pruebas P07 nuevas | 10 pasan |
| Typecheck de todos los workspaces | Pasa |
| Build de todos los workspaces | Pasa |
| `git diff --check` | Pasa |

Cobertura: autorización y contratos estrictos, propuesta aceptada, contacto y
email revisados, edición previa a revisión, aprobación exacta, idempotencia,
cuenta/fuente/vínculo cambiados, sesión revocada durante creación, ambigüedad
resuelta explícitamente, consulta sin lead inventado y recuperación tras purga.

Un test hace SIGKILL real después de la aceptación durable de un provider
**simulado**. Al reabrir, conserva tarea y UNKNOWN, reconcilia y registra CRM
con un único envío. Otro test usa el adaptador Gmail y conector reales con
transporte HTTP **simulado**: verifica cabeceras/hilo, rechaza un hilo distinto
y no hace un segundo POST. No es una prueba nueva contra servidores de Google.

QA visual con datos ficticios: API aislada 8935, SQLite privado y modelo Ollama
real instalado (`llama3.2:3b`). Se generó y aceptó una propuesta de RC, se editó
la respuesta, se seleccionó cliente/dirección y una llamada de seguimiento.
Después de aprobación y envío al buzón simulado se completaron 9/9 pasos,
se vio una interacción, una oportunidad de RC y un único seguimiento.
El CRM conservó esas filas tras reiniciar la API de QA. No hubo envío Gmail real.

Capturas guardadas en Downloads:

- `AUTONOMO_OS_RESPUESTA_EDITABLE_P07_2026-10-04.png`
- `AUTONOMO_OS_APROBACION_P07_2026-10-04.png`
- `AUTONOMO_OS_SEGUIMIENTO_P07_2026-10-04.png`
- `AUTONOMO_OS_CRM_P07_2026-10-04.png`

Se actualizaron API e interfaz del piloto 8907/5177 después de backups SQLite
consistentes privados. Se conservan autorización Gmail y los 27 correos guardados.
No se analizaron ni enviaron nuevos correos personales durante esta revisión.

## Retención y límites

La vinculación de fuente guarda hashes y metadatos, no otra copia del cuerpo
entrante. El borrador saliente, payload aprobado y evidencias siguen en el
journal. Borrar el inbox no borra esa auditoría ni backups: el producto necesita
una política completa de retención y borrado de todos los datos derivados.

La edición funciona antes de evaluar. Una revisión rechazada no admite todavía
un nuevo borrador dentro del mismo trabajo: falta revisión versionada con nueva
aprobación, sin cambiar un payload con claim existente. También falta cancelar
un trabajo pendiente y gestionar varias respuestas por conversación.

La relación entre envío gobernado y mensaje de Enviados sincronizado no se
fusiona todavía: falta resolver esa deduplicación por identidad acreditada.
No se acredita diseño móvil con estas capturas de escritorio.

## Siguiente trabajo

1. Revisar y versionar borradores rechazados; cancelación y bandeja de revisión
   con trabajos reales. Mantener los límites de C6 y aprobación exacta.
2. Aceptación M4 con correo entrante controlado y respuesta real autorizada,
   hilo, CRM y seguimiento. Después validar etiquetas/historial/purga consentida.
3. Google Calendar, trabajo diario y conectores restantes según el backlog.

P07 es un avance de implementación; no cierra por sí solo M4 ni el producto.
