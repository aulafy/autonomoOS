# P06 · Asistente local de correo

Fecha: 4 de octubre de 2026. Repositorio: `/Users/mac/Downloads/agent-world-os`.
Rama: `codex/h4-http-api`. Base: `2ef97c009a05d4723679b9098a90ab50675879ee`.

## Resultado

En **Correo Gmail**, el mensaje visible ofrece «Preparar con IA local». Produce
resumen, tipo de gestión, ramo, prioridad, motivo, fragmentos literales,
información pendiente y borrador. El profesional puede aceptar o descartar la
propuesta; una descartada admite nueva generación explícita.

Aceptar guarda una revisión. Todavía no crea un trabajo, contacto, seguimiento
ni aprobación de envío. La integración de ese recorrido corresponde a P07.
No cambia C1–C12 ni introduce otro sender.

## Implementación

- `packages/inference/src/local-json.ts`: transporte JSON estructurado para
  Ollama y llama.cpp. Solo endpoint HTTP de loopback, sin redirecciones.
- `pymes/src/mail-assistance-contract.ts`: esquema estricto compartido entre
  servidor y cliente. Rechaza campos adicionales, destinatarios y herramientas.
- `mail-assistance-service.ts`: límites, evidencias literales, revisión del
  propietario/cuenta/sesión, CAS, una generación simultánea y timeout de 60 s.
- `mail-assistance-api.ts`: GET de propuesta, POST de generación y revisión.
- `mail-assistance-screen.ts` y CSS: tarjeta dentro del correo visible,
  contenido tratado como texto, selección y respuestas asíncronas comprobadas.
- `inbox-store.ts`: migración aditiva v3→v4 y tabla `inbox_assistance`.
  Las propuestas se guardan en la caché del inbox, separadas del journal.
- Cableado aditivo en runtime-source, workspace-api y workspace-client.
- Corrección de un ID duplicado en Configuración que mostraba un error de
  conexión Gmail en la pantalla equivocada.
- El refresco automático espera a que termine la petición del asistente para
  conservar su progreso; cambios explícitos de cuenta/selección lo invalidan.

API, bajo sesión de propietario:

```text
GET  /v1/workspaces/<tenant>/mail-assistance?accountRef=<ref>&gmailId=<id>
POST /v1/workspaces/<tenant>/mail-assistance/generate
POST /v1/workspaces/<tenant>/mail-assistance/review
```

Generación: `{accountRef, gmailId}`. Revisión: añade `proposalId` y
`decision: "accepted" | "rejected"`. No admite parámetros de ejecución.

## Modelo y contexto

El Mac ya tenía Ollama y `llama3.2:3b` (aproximadamente 2 GB). No se descargó
otro modelo. Configuración:

```text
PYMES_MAIL_AI_PROVIDER=ollama     # alternativa: llama.cpp
PYMES_MAIL_AI_MODEL=llama3.2:3b
PYMES_MAIL_AI_URL=http://127.0.0.1:11434
```

El servicio transmite al modelo solamente asunto (hasta 500 caracteres) y
cuerpo (hasta 10.000), más instrucciones y esquema. No añade tokens, emails de
la cuenta, historial ni información del CRM. El recorte se indica en pantalla.
La respuesta tiene límites de tamaño y solo se acepta JSON completo del esquema.

Antes de transmitir correo a Ollama, se consulta `/api/show`: un descriptor
remoto o sin información de modelo local se rechaza. Una URL local por sí sola
no acredita un modelo local. Referencias del transporte:
[Ollama chat](https://docs.ollama.com/api/chat),
[tipos oficiales](https://github.com/ollama/ollama/blob/main/api/types.go),
[servidor llama.cpp](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md).
La confianza operativa sigue incluyendo el daemon y la configuración del Mac.

La huella incluye contenido, cabeceras, etiquetas y versión del prompt. Una
propuesta antigua no se presenta para una fuente nueva. Cualquier actualización
del registro de correo elimina su propuesta derivada, incluso un cambio de
metadatos: es una invalidación conservadora. Spam/papelera, eliminación o purga
también eliminan ese texto. No se almacena otra copia del prompt bruto.
Esto es borrado lógico; no acredita borrado forense de WAL o backups.

## Pruebas ejecutadas

| Comprobación | Resultado |
| --- | --- |
| Suite completa `npm test` | 886 descubiertas: 885 pasan, 0 fallos, 1 omitida (Orca opt-in) |
| PYMES | 491 pasan |
| Nuevas pruebas de asistente y transporte | 13 pasan |
| Typecheck de todos los workspaces | Pasa |
| Build de todos los workspaces | Pasa |
| Evaluación con Ollama instalado | 8/8 casos clasifican según lo esperado |

Los tests cubren aislamiento, sesión/cuenta cambiadas durante inferencia,
purga concurrente, evidencia inventada, datos adicionales, límites, timeout,
reapertura SQLite, revisión idempotente, regeneración tras rechazo y ausencia
de efectos CRM/runtime. Un modelo remoto se rechaza antes de enviar contexto.

Evaluación reproducible con datos ficticios:

```bash
node --import tsx pymes/tests/fixtures/mail-ai-evaluate.ts
```

Casos: presupuesto de RC, coche, vida y hogar; siniestro de coche; renovación
de hogar; cita; e instrucciones maliciosas dentro del correo. En una primera
prueba RC se clasificó mal: se corrigieron instrucciones y ejemplos, se cambió
la versión del prompt y se repitió la evaluación. Latencias observadas finales:
3,3–6,0 segundos por caso. No es una medida de rendimiento general.

QA visual: tenant sintético separado y un correo ficticio de electricista.
Se generó la propuesta con el modelo real, se aceptó, se hizo SIGKILL de esa
API de QA y se reinició con el mismo SQLite. La misma propuesta y revisión
persistieron. No hubo envío, tarea ni contacto. Captura:
`/Users/mac/Downloads/AUTONOMO_OS_ASISTENTE_CORREO_P06_2026-10-04.png`.
La prueba de viewport estrecho no quedó acreditada en esta revisión.

También se actualizó el piloto real 8907, después de una copia SQLite consistente
del inbox en su directorio privado, conservando conexión y 27 mensajes. Desde
su interfaz se analizó localmente el correo controlado de M3-C: resumen correcto,
ramo desconocido, propuesta pendiente. No se aceptó ni se envió su borrador.
Esta prueba acredita caché Gmail real→modelo local; no acredita el workflow
completo de un correo entrante de cliente.

## Límites y siguiente paso

Los fragmentos literales validan procedencia textual, no verdad de la síntesis.
Los ocho casos no garantizan calidad general. En la propuesta ficticia el asunto
incluyó un marcador de destinatario y el tratamiento no fue uniforme: el
profesional debe editar el borrador antes de usarlo. El correo M3 sin acción
requerida recibió un borrador innecesario; no se aprobó ni ejecutó.

P07: correo entrante→contacto revisado→borrador editable→trabajo durable→
aprobación de destinatario y contenido exactos→Governed Runner→CRM/seguimiento.
Debe resolver respuestas en hilo, procedencia y duplicados sin saltarse C6/C11.
El producto completo sigue en desarrollo; consultar el backlog general.
